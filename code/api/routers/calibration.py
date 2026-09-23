# Endpoints for intrinsic, extrinsic, and origin calibration, backed by calibration.py.

import datetime
import time
import threading
import concurrent.futures
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from project_manager import ProjectManager
from go2kin import save_app_config
from calibration.data_types import CameraArray
from calibration.charuco import Charuco
from api.deps import get_project_manager, get_app_config, get_connected_cameras, get_calibration_state
from api.schemas import CharucoConfig, CalibExtrinsicData

router = APIRouter(prefix="/api/calibration", tags=["calibration"])


def _calibration_paths(app_config: dict):
    """data_root can change at runtime via /api/config, so this is computed
    from the current app_config on every call instead of cached at import time
    (the original module-level CALIBRATION_DIR / CHARUCO_CONFIG_PATH would go
    stale after a config update)."""
    calib_dir = Path(app_config["data_root"]).parent / "config" / "calibration"
    return calib_dir, calib_dir / "charuco_config.json"


def _load_charuco(app_config: dict) -> Charuco:
    _, charuco_path = _calibration_paths(app_config)
    if not charuco_path.exists():
        raise Exception("Charuco config not found")
    with open(charuco_path, "r") as f:
        data = json.load(f)
    return Charuco(
        columns=data.get("columns", 5),
        rows=data.get("rows", 7),
        square_size=data.get("square_size_cm", 11.70) / 100.0,
        aruco_scale=data.get("aruco_scale", 0.75),
        dict_name=data.get("dict_name", "DICT_4X4_50"),
        inverted=data.get("inverted", False),
    )


@router.get("/charuco")
def get_charuco(app_config: dict = Depends(get_app_config)):
    _, charuco_path = _calibration_paths(app_config)
    if charuco_path.exists():
        with open(charuco_path, "r") as f:
            return json.load(f)
    return {}


@router.post("/charuco")
def set_charuco(config: CharucoConfig, app_config: dict = Depends(get_app_config)):
    calib_dir, charuco_path = _calibration_paths(app_config)
    calib_dir.mkdir(parents=True, exist_ok=True)
    with open(charuco_path, "w") as f:
        json.dump(config.dict(), f, indent=4)
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Intrinsic calibration
# ---------------------------------------------------------------------------

@router.post("/intrinsic/{serial}/record/start")
def start_intrinsic_record(
    serial: str,
    pm: ProjectManager = Depends(get_project_manager),
    connected_cameras: dict = Depends(get_connected_cameras),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["status"] not in ["idle", "complete", "error"]:
        raise HTTPException(status_code=400, detail="Busy")
    if serial not in connected_cameras:
        raise HTTPException(status_code=400, detail="Camera not connected")

    video_dir = Path(pm.data_root) / "temp_calibration"
    video_dir.mkdir(exist_ok=True, parents=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    calibration_state["recording_info"] = {
        "type": "intrinsic",
        "serial": serial,
        "video_dir": str(video_dir),
        "timestamp": timestamp,
    }

    connected_cameras[serial].shutterStart()
    calibration_state["status"] = "recording"
    calibration_state["message"] = f"Recording intrinsic for {serial}"
    return {"status": "success"}


def _process_intrinsic(info: dict, connected_cameras: dict, app_config: dict, calibration_state: dict):
    try:
        serial = info["serial"]
        video_dir = Path(info["video_dir"])
        timestamp = info["timestamp"]

        calibration_state["status"] = "downloading"
        calibration_state["message"] = "Downloading intrinsic video..."

        cam = connected_cameras[serial]
        cam.shutterStop()
        while cam.camBusy() or cam.encodingActive():
            time.sleep(0.5)

        fname = video_dir / f"intrinsic_{timestamp}_{serial}.mp4"
        cam.mediaDownloadLast(str(fname))
        cam.deleteAllFiles()

        calibration_state["status"] = "processing"
        calibration_state["message"] = "Running intrinsic calibration..."

        from calibration.calibrate import run_intrinsic_calibration_from_video
        charuco = _load_charuco(app_config)

        serials = app_config.get("gopro_serial_numbers", [])
        cam_num = serials.index(serial) + 1 if serial in serials else 1

        output = run_intrinsic_calibration_from_video(str(fname), cam_num, charuco)
        calibration_state["intrinsic_results"][serial] = {
            "cam_num": cam_num,
            "camera": output.camera,
            "rmse": output.report.rmse,
        }

        calibration_state["status"] = "complete"
        calibration_state["message"] = f"Intrinsic complete. RMSE: {output.report.rmse:.3f}"
    except Exception as e:
        calibration_state["status"] = "error"
        calibration_state["message"] = str(e)


@router.post("/intrinsic/{serial}/record/stop")
def stop_intrinsic_record(
    serial: str,
    connected_cameras: dict = Depends(get_connected_cameras),
    app_config: dict = Depends(get_app_config),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["status"] != "recording" or calibration_state["recording_info"]["serial"] != serial:
        raise HTTPException(status_code=400, detail="Not recording for this camera")

    info = calibration_state["recording_info"]
    threading.Thread(
        target=_process_intrinsic,
        args=(info, connected_cameras, app_config, calibration_state),
        daemon=True,
    ).start()
    return {"status": "processing"}


# ---------------------------------------------------------------------------
# Extrinsic calibration
# ---------------------------------------------------------------------------

@router.post("/extrinsic/record/start")
def start_extrinsic_record(
    data: CalibExtrinsicData,
    pm: ProjectManager = Depends(get_project_manager),
    connected_cameras: dict = Depends(get_connected_cameras),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["status"] not in ["idle", "complete", "error"]:
        raise HTTPException(status_code=400, detail="Busy")

    video_dir = Path(pm.data_root) / "temp_calibration"
    video_dir.mkdir(exist_ok=True, parents=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    calibration_state["recording_info"] = {
        "type": "extrinsic",
        "cameras": data.cameras_used,
        "sound_pos": data.sound_source,
        "video_dir": str(video_dir),
        "timestamp": timestamp,
    }

    for serial in data.cameras_used:
        if serial in connected_cameras:
            connected_cameras[serial].shutterStart()

    calibration_state["status"] = "recording"
    calibration_state["message"] = "Recording extrinsic"
    return {"status": "success"}


def _process_extrinsic(info: dict, connected_cameras: dict, app_config: dict, calibration_state: dict):
    try:
        video_dir = Path(info["video_dir"])
        timestamp = info["timestamp"]

        calibration_state["status"] = "downloading"
        calibration_state["message"] = "Downloading extrinsic videos..."

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for serial in info["cameras"]:
                if serial in connected_cameras:
                    cam = connected_cameras[serial]
                    cam.shutterStop()

                    def dl(c, s):
                        while c.camBusy() or c.encodingActive():
                            time.sleep(0.5)
                        fname = video_dir / f"extrinsic_{timestamp}_{s}.mp4"
                        c.mediaDownloadLast(str(fname))
                        c.deleteAllFiles()

                    futures.append(executor.submit(dl, cam, serial))
            concurrent.futures.wait(futures)

        calibration_state["status"] = "processing"
        calibration_state["message"] = "Syncing and computing extrinsics..."

        from audio_sync import compute_sync_offsets, trim_and_sync_videos, evaluate_sync_acceptance
        from calibration.calibrate import run_extrinsic_calibration

        video_paths = [str(f) for f in video_dir.glob(f"extrinsic_{timestamp}_*.mp4")]
        if len(video_paths) < 2:
            raise Exception("Not enough videos downloaded")

        offsets = compute_sync_offsets(video_paths, str(video_dir), sound_source_position=info["sound_pos"])
        acceptable, _ = evaluate_sync_acceptance(offsets)
        if not acceptable:
            raise Exception("Audio sync rejected")

        trim_and_sync_videos(video_paths, offsets, str(video_dir))

        cameras = {}
        for serial, res in calibration_state["intrinsic_results"].items():
            if serial in info["cameras"]:
                cameras[res["cam_num"]] = res["camera"]

        camera_array = CameraArray(cameras=cameras)
        charuco = _load_charuco(app_config)

        bundle = run_extrinsic_calibration(video_dir, charuco, camera_array)

        calibration_state["bundle"] = bundle
        calibration_state["camera_array"] = bundle.camera_array
        calibration_state["status"] = "complete"
        calibration_state["message"] = "Extrinsic calibration complete"

    except Exception as e:
        calibration_state["status"] = "error"
        calibration_state["message"] = str(e)


@router.post("/extrinsic/record/stop")
def stop_extrinsic_record(
    connected_cameras: dict = Depends(get_connected_cameras),
    app_config: dict = Depends(get_app_config),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["status"] != "recording" or calibration_state["recording_info"]["type"] != "extrinsic":
        raise HTTPException(status_code=400, detail="Not recording extrinsic")

    info = calibration_state["recording_info"]
    threading.Thread(
        target=_process_extrinsic,
        args=(info, connected_cameras, app_config, calibration_state),
        daemon=True,
    ).start()
    return {"status": "processing"}


# ---------------------------------------------------------------------------
# Origin calibration
# ---------------------------------------------------------------------------

@router.post("/origin/record/start")
def start_origin_record(
    data: CalibExtrinsicData,
    pm: ProjectManager = Depends(get_project_manager),
    connected_cameras: dict = Depends(get_connected_cameras),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["status"] not in ["idle", "complete", "error"]:
        raise HTTPException(status_code=400, detail="Busy")

    video_dir = Path(pm.data_root) / "temp_calibration"
    video_dir.mkdir(exist_ok=True, parents=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    calibration_state["recording_info"] = {
        "type": "origin",
        "cameras": data.cameras_used,
        "sound_pos": data.sound_source,
        "video_dir": str(video_dir),
        "timestamp": timestamp,
    }

    for serial in data.cameras_used:
        if serial in connected_cameras:
            connected_cameras[serial].shutterStart()

    calibration_state["status"] = "recording"
    calibration_state["message"] = "Recording origin"
    return {"status": "success"}


def _process_origin(info: dict, connected_cameras: dict, app_config: dict, calibration_state: dict):
    try:
        video_dir = Path(info["video_dir"])
        timestamp = info["timestamp"]

        calibration_state["status"] = "downloading"
        calibration_state["message"] = "Downloading origin videos..."

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for serial in info["cameras"]:
                if serial in connected_cameras:
                    cam = connected_cameras[serial]
                    cam.shutterStop()

                    def dl(c, s):
                        while c.camBusy() or c.encodingActive():
                            time.sleep(0.5)
                        fname = video_dir / f"origin_{timestamp}_{s}.mp4"
                        c.mediaDownloadLast(str(fname))
                        c.deleteAllFiles()

                    futures.append(executor.submit(dl, cam, serial))
            concurrent.futures.wait(futures)

        calibration_state["status"] = "processing"
        calibration_state["message"] = "Syncing and computing origin..."

        from audio_sync import compute_sync_offsets, trim_and_sync_videos, evaluate_sync_acceptance
        from calibration.calibrate import set_origin, compute_origin_transform
        from calibration.alignment import apply_similarity_transform

        video_paths = [str(f) for f in video_dir.glob(f"origin_{timestamp}_*.mp4")]
        if len(video_paths) < 2:
            raise Exception("Not enough videos downloaded")

        offsets = compute_sync_offsets(video_paths, str(video_dir), sound_source_position=info["sound_pos"])
        acceptable, _ = evaluate_sync_acceptance(offsets)
        if not acceptable:
            raise Exception("Audio sync rejected")

        trim_and_sync_videos(video_paths, offsets, str(video_dir))
        charuco = _load_charuco(app_config)

        if calibration_state["bundle"] is not None:
            aligned_bundle = set_origin(
                video_dir, charuco, calibration_state["camera_array"], calibration_state["bundle"]
            )
            calibration_state["bundle"] = aligned_bundle
            calibration_state["camera_array"] = aligned_bundle.camera_array
        else:
            transform = compute_origin_transform(video_dir, charuco, calibration_state["camera_array"])
            new_camera_array, _ = apply_similarity_transform(calibration_state["camera_array"], None, transform)
            calibration_state["camera_array"] = new_camera_array

        calibration_state["status"] = "complete"
        calibration_state["message"] = "Origin set successfully"

    except Exception as e:
        calibration_state["status"] = "error"
        calibration_state["message"] = str(e)


@router.post("/origin/record/stop")
def stop_origin_record(
    connected_cameras: dict = Depends(get_connected_cameras),
    app_config: dict = Depends(get_app_config),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["status"] != "recording" or calibration_state["recording_info"]["type"] != "origin":
        raise HTTPException(status_code=400, detail="Not recording origin")

    info = calibration_state["recording_info"]
    threading.Thread(
        target=_process_origin,
        args=(info, connected_cameras, app_config, calibration_state),
        daemon=True,
    ).start()
    return {"status": "processing"}


# ---------------------------------------------------------------------------
# Status / apply
# ---------------------------------------------------------------------------

@router.get("/status")
def get_calibration_status(calibration_state: dict = Depends(get_calibration_state)):
    return {
        "status": calibration_state["status"],
        "message": calibration_state["message"],
        "intrinsic_count": len(calibration_state["intrinsic_results"]),
        "has_extrinsics": calibration_state["camera_array"] is not None,
    }


@router.post("/apply")
def apply_calibration(
    pm: ProjectManager = Depends(get_project_manager),
    app_config: dict = Depends(get_app_config),
    calibration_state: dict = Depends(get_calibration_state),
):
    if calibration_state["camera_array"] is None:
        raise HTTPException(status_code=400, detail="No extrinsic calibration to apply")

    from calibration.persistence import save_calibration
    calib_dir = Path(pm.data_root) / "calibration"
    calib_dir.mkdir(exist_ok=True)
    today = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M")
    filepath = calib_dir / f"calibration_{today}.json"

    charuco = _load_charuco(app_config)
    save_calibration(filepath, calibration_state["camera_array"], charuco)

    # app_config here is the same dict object stored on app.state (Depends
    # returns it, not a copy), so mutating it in place is enough to persist
    # the change for the rest of the running app, same as the original.
    app_config["last_calibration"] = str(filepath)
    save_app_config(app_config)

    return {"status": "success", "filepath": str(filepath)}