# Calibration endpoints, mirroring the tkinter CalibrationTab: charuco board config,
# per-camera intrinsic (record -> calibrate), extrinsic and origin (record -> download
# -> sync -> calibrate), load/apply, and status. All long work runs in background
# threads; clients poll GET /status. Camera N is "GoPro N" = position in
# gopro_serial_numbers + 1, and recorded files are named {purpose}_{timestamp}_GP{N}.mp4
# because calibration.video_processor finds the camera number from that suffix.

import concurrent.futures
import datetime
import io
import shutil
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from project_manager import ProjectManager
from go2kin import save_app_config
from calibration.charuco import Charuco
from calibration.data_types import CameraArray
from api.deps import (
    get_app_config,
    get_calibration_state,
    get_connected_cameras,
    get_preview_sessions,
    get_profile_manager_dep,
    get_project_manager,
    get_recording_start_info,
    get_selection_state,
)
from api.routers.preview import stop_previews
from api.schemas import (
    CalibRecordRequest,
    CalibrationLoadRequest,
    CharucoConfig,
    IntrinsicCalibrateRequest,
)

router = APIRouter(prefix="/api/calibration", tags=["calibration"])

# Same location the tkinter tab uses (config/calibration under the repo root).
CHARUCO_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "calibration" / "charuco_config.json"

# Same defaults and options as the tkinter charuco inputs.
DEFAULT_CHARUCO = CharucoConfig(
    columns=5, rows=7, square_size_cm=11.70, aruco_scale=0.75, dict_name="DICT_4X4_50", inverted=False,
)
DICT_OPTIONS = [
    "DICT_4X4_50", "DICT_4X4_100", "DICT_4X4_250", "DICT_4X4_1000",
    "DICT_5X5_50", "DICT_5X5_100", "DICT_5X5_250", "DICT_5X5_1000",
    "DICT_6X6_50", "DICT_6X6_100", "DICT_6X6_250", "DICT_6X6_1000",
]

BUSY_STATES = ("recording", "downloading", "syncing", "processing")


class _CalibrationAbort(Exception):
    """A recoverable step failure with a user-facing message."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_idle(state: dict) -> None:
    if state["status"] in BUSY_STATES:
        raise HTTPException(status_code=409, detail=f"Calibration is busy ({state['status']})")


def _ensure_not_trial_recording(recording_start_info: dict) -> None:
    if recording_start_info.get("cameras_used") or recording_start_info.get("task_id"):
        raise HTTPException(status_code=409, detail="Recording tab is active, stop it first")


def _current_project(selection_state: dict, app_config: dict) -> str:
    project = selection_state.get("project") or app_config.get("last_project")
    if not project:
        raise HTTPException(status_code=400, detail="No project selected. Select a project first.")
    return project


def _calibrations_dir(pm: ProjectManager, project: str) -> Path:
    try:
        d = pm.get_project_path(project) / "calibrations"
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _temp_video_dir(pm: ProjectManager, project: str) -> Path:
    d = _calibrations_dir(pm, project) / "temp_videos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cam_num(serial: str, app_config: dict) -> int:
    serials = app_config.get("gopro_serial_numbers", [])
    if serial not in serials:
        raise HTTPException(status_code=404, detail=f"Unknown camera {serial}")
    return serials.index(serial) + 1


def _require_connected(serial: str, connected_cameras: dict):
    cam = connected_cameras.get(serial)
    if cam is None:
        raise HTTPException(status_code=400, detail=f"Camera {serial} is not connected")
    return cam


def _has_extrinsics(state: dict) -> bool:
    ca = state["camera_array"]
    return ca is not None and bool(ca.posed_cameras)


def _make_timestamp() -> str:
    return datetime.datetime.now().strftime("%Y%m%d_%H%M")


def _apply_saved_zoom(serial: str, cam, profile_manager) -> None:
    """Resolution/FPS changes reset GoPro zoom, so re-apply the saved framing right before the shutter."""
    try:
        zoom = (profile_manager.load_camera_profile(serial) or {}).get("current_zoom", 0)
        if zoom and zoom > 0:
            cam.setDigitalZoom(zoom)
            time.sleep(0.3)
    except Exception as e:
        print(f"  Failed to apply zoom to {serial}: {e}")


def _set_state(state: dict, status: str, message: str = "", stage: str | None = None) -> None:
    state["status"] = status
    state["message"] = message
    if stage is not None:
        state["stage"] = stage


def _cleanup_temp_videos(video_dir: Path, purpose: str, timestamp: str) -> None:
    try:
        prefix = f"{purpose}_{timestamp}"
        for f in video_dir.iterdir():
            if f.is_file() and f.name.startswith(prefix):
                f.unlink()
        sync_dir = video_dir / f"{prefix}_sync"
        if sync_dir.exists():
            shutil.rmtree(sync_dir)
    except Exception as e:
        print(f"Could not clean up temp videos: {e}")


# ---------------------------------------------------------------------------
# Charuco
# ---------------------------------------------------------------------------

def _charuco_from_config(cfg: CharucoConfig) -> Charuco:
    return Charuco(
        columns=cfg.columns,
        rows=cfg.rows,
        square_size_overide_cm=cfg.square_size_cm,
        dictionary=cfg.dict_name,
        aruco_scale=cfg.aruco_scale,
        inverted=cfg.inverted,
    )


def _config_from_charuco(c: Charuco) -> dict:
    return CharucoConfig(
        columns=c.columns,
        rows=c.rows,
        square_size_cm=c.square_size_overide_cm or DEFAULT_CHARUCO.square_size_cm,
        aruco_scale=c.aruco_scale,
        dict_name=c.dictionary,
        inverted=c.inverted,
    ).model_dump()


def _active_charuco(state: dict) -> Charuco:
    """Board used for calibration: the one set by a save/load this session, else the saved file, else defaults."""
    if state["charuco"] is not None:
        return state["charuco"]
    if CHARUCO_CONFIG_PATH.exists():
        from calibration.persistence import load_charuco_config
        try:
            state["charuco"] = load_charuco_config(CHARUCO_CONFIG_PATH)
            return state["charuco"]
        except Exception as e:
            print(f"Could not load charuco config: {e}")
    return _charuco_from_config(DEFAULT_CHARUCO)


@router.get("/charuco")
def get_charuco(state: dict = Depends(get_calibration_state)):
    return _config_from_charuco(_active_charuco(state))


@router.post("/charuco")
def set_charuco(config: CharucoConfig, state: dict = Depends(get_calibration_state)):
    """Save the board config (same file the tkinter tab uses) and make it the active board."""
    from calibration.persistence import save_charuco_config
    charuco = _charuco_from_config(config)
    try:
        save_charuco_config(CHARUCO_CONFIG_PATH, charuco)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save charuco config: {e}")
    state["charuco"] = charuco
    return {"status": "success", "charuco": _config_from_charuco(charuco)}


@router.get("/charuco/dictionaries")
def get_charuco_dictionaries():
    return {"dictionaries": DICT_OPTIONS}


@router.post("/charuco/board-image")
def get_board_image(config: CharucoConfig):
    """PNG of the board for the given (possibly unsaved) config, for download/printing."""
    try:
        buf = io.BytesIO()
        _charuco_from_config(config).board_pil_image().save(buf, format="PNG")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not render board: {e}")
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="charuco_board.png"'},
    )


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

def _intrinsic_summary(state: dict, app_config: dict) -> list[dict]:
    rows = []
    for i, serial in enumerate(app_config.get("gopro_serial_numbers", [])):
        n = i + 1
        result = state["intrinsic_results"].get(n)
        rmse = frames = None
        if result is not None:
            report = result.get("report")
            rmse = report.rmse if report is not None else result["camera"].error
            frames = report.frames_used if report is not None else None
        video = state["intrinsic_videos"].get(n)
        rows.append({
            "serial": serial,
            "cam_num": n,
            "name": f"GoPro {n}",
            "calibrated": result is not None,
            "rmse": rmse,
            "frames_used": frames,
            "video": Path(video).name if video else None,
        })
    return rows


@router.get("/status")
def get_calibration_status(
    state: dict = Depends(get_calibration_state),
    app_config: dict = Depends(get_app_config),
):
    """Everything the calibration UI shows: step status, per-camera intrinsics, extrinsic/origin results, button enables."""
    intrinsics = _intrinsic_summary(state, app_config)
    n_calibrated = sum(1 for r in intrinsics if r["calibrated"])
    has_ext = _has_extrinsics(state)
    info = state["recording_info"] or {}
    return {
        "status": state["status"],
        "stage": state["stage"],
        "message": state["message"],
        "recording": {
            "type": info.get("type"),
            "serials": info.get("serials"),
        } if state["status"] == "recording" else None,
        "intrinsics": intrinsics,
        "intrinsic_count": n_calibrated,
        "extrinsic": state["extrinsic_report"],
        "has_extrinsics": has_ext,
        "origin_set": state["origin_set"],
        "loaded_file": state["loaded_file"],
        "sync_issue": state["sync_issue"],
        "can_extrinsic": n_calibrated > 0,
        "can_origin": has_ext,
        "can_apply": has_ext,
    }


# ---------------------------------------------------------------------------
# Intrinsic: record, then calibrate (two separate steps, as in the tkinter tab)
# ---------------------------------------------------------------------------

@router.get("/intrinsic")
def get_intrinsics(state: dict = Depends(get_calibration_state), app_config: dict = Depends(get_app_config)):
    return {"cameras": _intrinsic_summary(state, app_config)}


@router.post("/intrinsic/{serial}/record/start")
def start_intrinsic_record(
    serial: str,
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
    recording_start_info: dict = Depends(get_recording_start_info),
    state: dict = Depends(get_calibration_state),
    preview_sessions: dict = Depends(get_preview_sessions),
):
    _ensure_idle(state)
    _ensure_not_trial_recording(recording_start_info)
    project = _current_project(selection_state, app_config)
    cam_num = _cam_num(serial, app_config)
    cam = _require_connected(serial, connected_cameras)
    video_dir = _temp_video_dir(pm, project)
    stop_previews([serial], preview_sessions)   # restores the recording settings preview overrides

    try:
        _apply_saved_zoom(serial, cam, profile_manager)
        response = cam.shutterStart()
        response.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to start recording: {e}")

    state["recording_info"] = {
        "type": "intrinsic",
        "serials": [serial],
        "cam_nums": [cam_num],
        "video_dir": str(video_dir),
        "timestamp": _make_timestamp(),
    }
    _set_state(state, "recording", f"Recording Camera {cam_num}...", "intrinsic")
    return {"status": "recording", "serial": serial, "cam_num": cam_num}


def _download_last(cam, dest: Path) -> Path:
    """Stop the shutter, wait for the camera to finish, download the latest video, clear the card."""
    cam.shutterStop()
    while cam.camBusy() or cam.encodingActive():
        time.sleep(0.5)
    cam.mediaDownloadLast(str(dest))
    cam.deleteAllFiles()
    return dest


def _process_intrinsic_recording(info: dict, connected_cameras: dict, state: dict) -> None:
    serial, cam_num = info["serials"][0], info["cam_nums"][0]
    try:
        _set_state(state, "downloading", f"Downloading from Camera {cam_num}...")
        dest = Path(info["video_dir"]) / f"intrinsic_{info['timestamp']}_GP{cam_num}.mp4"
        _download_last(connected_cameras[serial], dest)
        state["intrinsic_videos"][cam_num] = dest
        _set_state(state, "complete", f"Camera {cam_num} recorded: {dest.name}")
    except Exception as e:
        _set_state(state, "error", f"Camera {cam_num} recording error: {e}")


@router.post("/intrinsic/{serial}/record/stop")
def stop_intrinsic_record(
    serial: str,
    connected_cameras: dict = Depends(get_connected_cameras),
    state: dict = Depends(get_calibration_state),
):
    info = state["recording_info"] or {}
    if state["status"] != "recording" or info.get("type") != "intrinsic" or serial not in info.get("serials", []):
        raise HTTPException(status_code=400, detail="Not recording intrinsic for this camera")
    _set_state(state, "downloading", "Stopping camera...")
    threading.Thread(target=_process_intrinsic_recording, args=(info, connected_cameras, state), daemon=True).start()
    return {"status": "downloading"}


def _run_intrinsic(cam_num: int, serial: str, video_path: Path, charuco: Charuco, state: dict) -> None:
    try:
        from calibration.calibrate import run_intrinsic_calibration_from_video
        output = run_intrinsic_calibration_from_video(video_path, cam_num, charuco)
        state["intrinsic_results"][cam_num] = {"camera": output.camera, "report": output.report, "serial": serial}
        _set_state(
            state, "complete",
            f"Camera {cam_num}: RMSE={output.report.rmse:.3f}px, frames={output.report.frames_used}",
        )
    except Exception as e:
        _set_state(state, "error", f"Camera {cam_num} error: {e}")


@router.post("/intrinsic/{serial}/calibrate")
def calibrate_intrinsic(
    serial: str,
    body: IntrinsicCalibrateRequest | None = None,
    app_config: dict = Depends(get_app_config),
    state: dict = Depends(get_calibration_state),
):
    """Calibrate one camera from its just-recorded video, or from body.video_path (tkinter "Browse")."""
    _ensure_idle(state)
    cam_num = _cam_num(serial, app_config)

    if body is not None and body.video_path:
        video_path = Path(body.video_path)
    else:
        video_path = state["intrinsic_videos"].get(cam_num)
    if video_path is None:
        raise HTTPException(status_code=400, detail=f"No video selected for Camera {cam_num}")
    if not Path(video_path).is_file():
        raise HTTPException(status_code=400, detail=f"Video not found: {video_path}")

    state["intrinsic_videos"][cam_num] = Path(video_path)
    _set_state(state, "processing", f"Calibrating Camera {cam_num}...", "intrinsic")
    threading.Thread(
        target=_run_intrinsic,
        args=(cam_num, serial, Path(video_path), _active_charuco(state), state),
        daemon=True,
    ).start()
    return {"status": "processing", "cam_num": cam_num}


def _save_current_calibration(calib_dir: Path, state: dict, app_config: dict) -> Path:
    """Save the current calibration as calibration_<timestamp>.json (+ Pose2Sim TOML) and make it last_calibration."""
    from calibration.persistence import save_calibration
    filepath = calib_dir / f"calibration_{datetime.datetime.now().strftime('%Y-%m-%d-%H-%M')}.json"
    save_calibration(filepath, state["camera_array"], _active_charuco(state))
    # app_config is the same dict stored on app.state, so mutating it in place persists for the running app.
    app_config["last_calibration"] = str(filepath)
    save_app_config(app_config)
    state["loaded_file"] = filepath.stem
    return filepath


# ---------------------------------------------------------------------------
# Extrinsic / origin: record all cameras -> download -> sync -> calibrate -> auto-apply
# ---------------------------------------------------------------------------

def _start_multi_record(
    kind: str,
    body: CalibRecordRequest | None,
    pm: ProjectManager,
    app_config: dict,
    selection_state: dict,
    connected_cameras: dict,
    profile_manager,
    recording_start_info: dict,
    state: dict,
    preview_sessions: dict,
) -> dict:
    _ensure_idle(state)
    _ensure_not_trial_recording(recording_start_info)
    project = _current_project(selection_state, app_config)

    serials = (body.cameras_used if body and body.cameras_used else list(connected_cameras))
    serials = list(dict.fromkeys(serials))
    for s in serials:
        _require_connected(s, connected_cameras)
    if len(serials) < 2:
        raise HTTPException(status_code=400, detail="At least 2 connected cameras are needed")
    cam_nums = [_cam_num(s, app_config) for s in serials]

    if kind == "extrinsic":
        missing = [n for n in cam_nums if n not in state["intrinsic_results"]]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Run intrinsic calibration first (missing: {', '.join(f'GoPro {n}' for n in missing)})",
            )
    elif not _has_extrinsics(state):
        raise HTTPException(status_code=400, detail="Run extrinsic calibration (or load a calibration) first")

    video_dir = _temp_video_dir(pm, project)
    stop_previews(serials, preview_sessions)   # restores the recording settings preview overrides

    def start_one(serial):
        cam = connected_cameras[serial]
        _apply_saved_zoom(serial, cam, profile_manager)
        cam.shutterStart().raise_for_status()

    started, failed = [], {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(start_one, s): s for s in serials}
        for f, s in futures.items():
            try:
                f.result(timeout=15)
                started.append(s)
            except Exception as e:
                failed[s] = str(e)

    if len(started) < 2:
        for s in started:   # don't leave a lone camera recording
            try:
                connected_cameras[s].shutterStop()
            except Exception:
                pass
        raise HTTPException(status_code=502, detail={"message": "Could not start enough cameras", "failed": failed})

    state["recording_info"] = {
        "type": kind,
        "serials": started,
        "cam_nums": [_cam_num(s, app_config) for s in started],
        "video_dir": str(video_dir),
        "timestamp": _make_timestamp(),
    }
    state["sync_issue"] = None
    _set_state(state, "recording", f"Recording ({len(started)} cameras)...", kind)
    return {"status": "recording", "cameras": started, "failed": failed}


def _download_all(info: dict, connected_cameras: dict, state: dict) -> list[str]:
    video_dir, purpose, ts = Path(info["video_dir"]), info["type"], info["timestamp"]
    _set_state(state, "downloading", "Stopping cameras and downloading...")

    def one(serial, cam_num):
        return _download_last(connected_cameras[serial], video_dir / f"{purpose}_{ts}_GP{cam_num}.mp4")

    paths, errors = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(one, s, n): n for s, n in zip(info["serials"], info["cam_nums"])}
        for f, n in futures.items():
            try:
                paths.append(str(f.result(timeout=300)))
            except Exception as e:
                errors.append(f"GoPro {n}: {e}")
    if len(paths) < 2:
        raise _CalibrationAbort("Not enough videos downloaded. " + " | ".join(errors))
    return sorted(paths)


def _sync_videos(info: dict, video_paths: list[str], state: dict, skip_sync: bool) -> Path:
    """Audio-sync (or just trim, for the static-board origin recording) and return the synced/ folder."""
    from audio_sync import (
        AudioSyncError, check_audio_track, check_ffmpeg, compute_sync_offsets,
        evaluate_sync_acceptance, format_sync_summary, trim_and_sync_videos,
    )

    video_dir, purpose, ts = Path(info["video_dir"]), info["type"], info["timestamp"]
    if not check_ffmpeg():
        raise _CalibrationAbort("ffmpeg not found")

    if skip_sync:
        _set_state(state, "syncing", f"Trimming {len(video_paths)} videos (no sync)...")
        offsets = {
            vp: {"offset_seconds": 0.0, "is_reference": (i == 0), "status": "NO-SYNC"}
            for i, vp in enumerate(video_paths)
        }
    else:
        _set_state(state, "syncing", "Running audio sync...")
        for vp in video_paths:
            if not check_audio_track(vp):
                raise AudioSyncError(f"No audio track in: {Path(vp).name}")
        offsets = compute_sync_offsets(video_paths, output_dir=str(video_dir))

        # Same gate as trial recordings: abort BEFORE the slow trim re-encode and extrinsic compute.
        acceptable, reasons = evaluate_sync_acceptance(offsets, max_offset_ms=200.0)
        if not acceptable:
            state["sync_issue"] = {
                "heading": "SYNC ISSUE — CALIBRATION ABORTED",
                "subtext": "Extrinsic calibration aborted. Please re-record.",
                "table": format_sync_summary(offsets),
                "reasons": reasons,
            }
            _cleanup_temp_videos(video_dir, purpose, ts)
            raise _CalibrationAbort("Audio sync rejected: " + "; ".join(reasons))

    sync_parent = video_dir / f"{purpose}_{ts}_sync"
    sync_parent.mkdir(parents=True, exist_ok=True)
    _set_state(state, "syncing", "Trimming videos...")
    trim_and_sync_videos(video_paths, offsets, str(sync_parent))
    return sync_parent / "synced"


def _process_extrinsic(info: dict, connected_cameras: dict, state: dict, app_config: dict) -> None:
    try:
        video_paths = _download_all(info, connected_cameras, state)
        synced_dir = _sync_videos(info, video_paths, state, skip_sync=False)

        _set_state(state, "processing", "Running extrinsic calibration...")
        from calibration.calibrate import run_extrinsic_calibration

        camera_array = CameraArray(cameras={n: state["intrinsic_results"][n]["camera"] for n in info["cam_nums"]})
        bundle = run_extrinsic_calibration(synced_dir, _active_charuco(state), camera_array)

        report = bundle.reprojection_report
        rmse = report.overall_rmse
        state["camera_array"] = camera_array
        state["bundle"] = bundle
        state["origin_set"] = False
        state["loaded_file"] = None
        state["extrinsic_report"] = {
            "rmse": rmse,
            "n_cameras": report.n_cameras,
            "n_points": report.n_points,
            "level": "green" if rmse < 1.0 else "amber" if rmse < 2.0 else "red",
        }
        _cleanup_temp_videos(Path(info["video_dir"]), "extrinsic", info["timestamp"])
        saved = _save_current_calibration(Path(info["video_dir"]).parent, state, app_config)
        _set_state(
            state, "complete",
            f"RMSE: {rmse:.3f}px | {report.n_cameras} cameras | {report.n_points} points | Applied: {saved.name}",
        )
    except Exception as e:
        _set_state(state, "error", str(e))


def _process_origin(info: dict, connected_cameras: dict, state: dict, app_config: dict) -> None:
    try:
        video_paths = _download_all(info, connected_cameras, state)
        synced_dir = _sync_videos(info, video_paths, state, skip_sync=True)   # static board: no clap sync needed

        _set_state(state, "processing", "Setting origin...")
        charuco = _active_charuco(state)

        if state["bundle"] is not None:
            from calibration.calibrate import set_origin
            aligned = set_origin(synced_dir, charuco, state["camera_array"], state["bundle"])
            state["bundle"] = aligned
            state["camera_array"] = aligned.camera_array
        else:
            from calibration.calibrate import compute_origin_transform
            from calibration.alignment import apply_similarity_transform
            transform = compute_origin_transform(synced_dir, charuco, state["camera_array"])
            state["camera_array"], _ = apply_similarity_transform(state["camera_array"], None, transform)

        state["origin_set"] = True
        _cleanup_temp_videos(Path(info["video_dir"]), "origin", info["timestamp"])
        saved = _save_current_calibration(Path(info["video_dir"]).parent, state, app_config)
        _set_state(state, "complete", f"Origin set | Applied: {saved.name}")
    except Exception as e:
        _set_state(state, "error", str(e))


def _stop_multi_record(kind: str, target, connected_cameras: dict, state: dict, app_config: dict) -> dict:
    info = state["recording_info"] or {}
    if state["status"] != "recording" or info.get("type") != kind:
        raise HTTPException(status_code=400, detail=f"Not recording {kind}")
    _set_state(state, "downloading", "Stopping cameras...")
    threading.Thread(target=target, args=(info, connected_cameras, state, app_config), daemon=True).start()
    return {"status": "downloading"}


@router.post("/extrinsic/record/start")
def start_extrinsic_record(
    body: CalibRecordRequest | None = None,
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
    recording_start_info: dict = Depends(get_recording_start_info),
    state: dict = Depends(get_calibration_state),
    preview_sessions: dict = Depends(get_preview_sessions),
):
    """Start recording on all connected cameras (or body.cameras_used). The 5s countdown before this is the client's job."""
    return _start_multi_record(
        "extrinsic", body, pm, app_config, selection_state, connected_cameras,
        profile_manager, recording_start_info, state, preview_sessions,
    )


@router.post("/extrinsic/record/stop")
def stop_extrinsic_record(
    connected_cameras: dict = Depends(get_connected_cameras),
    app_config: dict = Depends(get_app_config),
    state: dict = Depends(get_calibration_state),
):
    """Stop, then download -> sync -> calibrate -> save in the background (auto-apply, no separate /apply call)."""
    return _stop_multi_record("extrinsic", _process_extrinsic, connected_cameras, state, app_config)


@router.post("/origin/record/start")
def start_origin_record(
    body: CalibRecordRequest | None = None,
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
    recording_start_info: dict = Depends(get_recording_start_info),
    state: dict = Depends(get_calibration_state),
    preview_sessions: dict = Depends(get_preview_sessions),
):
    return _start_multi_record(
        "origin", body, pm, app_config, selection_state, connected_cameras,
        profile_manager, recording_start_info, state, preview_sessions,
    )


@router.post("/origin/record/stop")
def stop_origin_record(
    connected_cameras: dict = Depends(get_connected_cameras),
    app_config: dict = Depends(get_app_config),
    state: dict = Depends(get_calibration_state),
):
    """Stop, then download -> sync -> calibrate -> save in the background (auto-apply, no separate /apply call)."""
    return _stop_multi_record("origin", _process_origin, connected_cameras, state, app_config)


# ---------------------------------------------------------------------------
# Apply / list / load
# ---------------------------------------------------------------------------

@router.post("/apply")
def apply_calibration(
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    state: dict = Depends(get_calibration_state),
):
    """Manually re-save the current calibration. Extrinsic and origin already save automatically on success."""
    _ensure_idle(state)
    if not _has_extrinsics(state):
        raise HTTPException(status_code=400, detail="No extrinsic calibration to apply")
    calib_dir = _calibrations_dir(pm, _current_project(selection_state, app_config))
    try:
        filepath = _save_current_calibration(calib_dir, state, app_config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save: {e}")
    return {"status": "success", "filename": filepath.name, "filepath": str(filepath)}


@router.get("/files")
def list_calibration_files(
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
):
    """Saved calibrations in the current project, newest first. Replaces the tkinter file dialog."""
    calib_dir = _calibrations_dir(pm, _current_project(selection_state, app_config))
    files = sorted(calib_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {"files": [{"name": f.stem, "modified": f.stat().st_mtime} for f in files]}


def _calibration_path(name: str, pm, app_config: dict, selection_state: dict) -> Path:
    if Path(name).name != name:   # bare file stem only, never a path
        raise HTTPException(status_code=400, detail="Invalid calibration name")
    path = _calibrations_dir(pm, _current_project(selection_state, app_config)) / f"{name}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Calibration not found: {name}")
    return path


def _load_into_state(path: Path, state: dict, app_config: dict, intrinsics_only: bool) -> dict:
    from calibration.persistence import load_calibration
    camera_array, charuco, _ = load_calibration(path)
    state["charuco"] = charuco   # becomes the active board, as the tkinter tab does

    configured = len(app_config.get("gopro_serial_numbers", []))
    serials = app_config.get("gopro_serial_numbers", [])

    if intrinsics_only:
        from dataclasses import replace
        state["intrinsic_results"].clear()
        for cam_id, cam in camera_array.cameras.items():
            if 1 <= cam_id <= configured and cam.matrix is not None and cam.distortions is not None:
                state["intrinsic_results"][cam_id] = {
                    "camera": replace(cam, rotation=None, translation=None),
                    "report": None,
                    "serial": serials[cam_id - 1],
                }
        # Extrinsics must be re-run
        state["camera_array"] = None
        state["extrinsic_report"] = None
    else:
        state["camera_array"] = camera_array
        for cam_id, cam in camera_array.cameras.items():
            if 1 <= cam_id <= configured and cam.error is not None:
                state["intrinsic_results"][cam_id] = {"camera": cam, "report": None, "serial": serials[cam_id - 1]}
        n_posed = len(camera_array.posed_cameras)
        state["extrinsic_report"] = {"rmse": None, "n_cameras": n_posed, "n_points": None, "level": "green"} if n_posed else None

    state["bundle"] = None   # a loaded file has no bundle; a stale one would corrupt set-origin
    state["origin_set"] = False
    state["sync_issue"] = None
    state["loaded_file"] = None if intrinsics_only else path.stem
    state["stage"] = None
    _set_state(
        state, "idle",
        f"Intrinsics loaded: {path.name}" if intrinsics_only else f"Loaded: {path.name}",
    )
    if not intrinsics_only:
        app_config["last_calibration"] = str(path)
        save_app_config(app_config)
    return {
        "status": "success",
        "file": path.stem,
        "charuco": _config_from_charuco(charuco),
        "n_cameras": len(camera_array.cameras),
        "n_posed": len(camera_array.posed_cameras),
        "n_intrinsics": len(state["intrinsic_results"]),
    }


@router.post("/load")
def load_calibration_file(
    body: CalibrationLoadRequest,
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    state: dict = Depends(get_calibration_state),
):
    """Load a full calibration (intrinsics + extrinsics + board) and make it current."""
    _ensure_idle(state)
    path = _calibration_path(body.name, pm, app_config, selection_state)
    try:
        return _load_into_state(path, state, app_config, intrinsics_only=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load: {e}")


@router.post("/load-intrinsics")
def load_intrinsics_only(
    body: CalibrationLoadRequest,
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    state: dict = Depends(get_calibration_state),
):
    """Load only the intrinsics from a saved calibration; extrinsics are cleared so they must be re-run."""
    _ensure_idle(state)
    path = _calibration_path(body.name, pm, app_config, selection_state)
    try:
        return _load_into_state(path, state, app_config, intrinsics_only=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load intrinsics: {e}")


@router.post("/auto-load")
def auto_load_calibration(
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    state: dict = Depends(get_calibration_state),
):
    """Startup behaviour of the tkinter tab: load last_calibration, else the project's latest. Call once on page load."""
    _ensure_idle(state)
    last = app_config.get("last_calibration", "")
    if last and Path(last).is_file():
        path = Path(last)
    else:
        project = selection_state.get("project") or app_config.get("last_project")
        latest = pm.get_latest_calibration(project) if project else None
        path = pm.get_calibration_path(project, latest, "json") if latest else None
    if path is None or not path.is_file():
        return {"status": "none"}
    try:
        return _load_into_state(path, state, app_config, intrinsics_only=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to auto-load {path.name}: {e}")


# ---------------------------------------------------------------------------
# Temp video cleanup
# ---------------------------------------------------------------------------

@router.delete("/temp-videos")
def delete_calibration_videos(
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    selection_state: dict = Depends(get_selection_state),
    state: dict = Depends(get_calibration_state),
):
    """Delete all calibration temp videos for the current project (the "Delete Videos" button; confirm client-side)."""
    _ensure_idle(state)
    temp_dir = _calibrations_dir(pm, _current_project(selection_state, app_config)) / "temp_videos"
    if not temp_dir.exists():
        return {"status": "none"}
    shutil.rmtree(temp_dir)
    state["intrinsic_videos"].clear()
    return {"status": "deleted"}
