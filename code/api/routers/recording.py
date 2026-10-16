# Trial recording endpoints, mirroring the tkinter RecordingTab: start all selected cameras,
# then on stop: wait for each camera to finish encoding, download, clear its card, and
# audio-sync the trial in the background (clients poll GET /jobs/{task_id}).
# Files are named {trial}_GP{N}.mp4 with N = the camera's GoPro number (its position in
# gopro_serial_numbers + 1), because calibration and Pose2Sim match videos to cameras by it.
# A failure never leaves a recording stuck "active": the state is reset on every exit path.

import concurrent.futures
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.deps import (
    connected_cameras,
    recording_background_tasks,
    recording_start_info,
    selection_state,
    get_app_config,
    get_calibration_state,
    get_preview_sessions,
    get_profile_manager_dep,
    get_project_manager,
)
from api.routers.preview import stop_previews
from api.schemas import RecordingStartRequest


router = APIRouter(prefix="/api/recording", tags=["recording"])

CALIBRATION_BUSY = ("recording", "downloading", "syncing", "processing")
ENCODING_WAIT_S = 120   # cap on waiting for a camera to finish writing the file after stop


def _reset(recording_info: dict) -> None:
    recording_info.clear()
    recording_info.update({"cameras_used": [], "trial_name": None, "sound_source_position": []})


def _start_camera(serial: str, camera, profile_manager) -> None:
    """Re-apply the saved zoom (resolution/FPS changes reset it), then start the shutter."""
    try:
        zoom = (profile_manager.load_camera_profile(serial) or {}).get("current_zoom", 0)
        if zoom and zoom > 0:
            camera.setDigitalZoom(zoom)
            time.sleep(0.3)
    except Exception as e:
        print(f"  Failed to apply zoom to {serial}: {e}")
    camera.shutterStart().raise_for_status()


@router.post("/start")
def start_recording(
    data: RecordingStartRequest,
    connected_cameras=connected_cameras,
    recording_start_info=recording_start_info,
    selection_state=selection_state,
    app_config=Depends(get_app_config),
    project_manager=Depends(get_project_manager),
    calibration_state=Depends(get_calibration_state),
    profile_manager=Depends(get_profile_manager_dep),
    preview_sessions=Depends(get_preview_sessions),
):
    # Prevent two recordings (or a calibration recording) from using the cameras at the same time.
    if recording_start_info["cameras_used"] or recording_start_info.get("task_id"):
        raise HTTPException(status_code=409, detail="A recording is already active.")
    if calibration_state["status"] in CALIBRATION_BUSY:
        raise HTTPException(status_code=409, detail=f"Calibration is busy ({calibration_state['status']}).")

    # Remove duplicate serial numbers and confirm each camera is configured and connected.
    serials = app_config.get("gopro_serial_numbers", [])
    cameras_used = list(dict.fromkeys(data.cameras_used))
    for serial in cameras_used:
        if serial not in serials:
            raise HTTPException(status_code=404, detail=f"Unknown camera {serial}.")
        if serial not in connected_cameras:
            raise HTTPException(status_code=400, detail=f"Camera {serial} is not connected.")

    # Same source as the tkinter top bar: the current project / session / participant.
    project = selection_state.get("project")
    session = selection_state.get("session")
    if not project or not session:
        raise HTTPException(status_code=400, detail="Select a project and session first.")
    subject_id = selection_state.get("subject_id") or ""
    # Name (not path) of the project's latest calibration, as tkinter stores it; Pose2Sim resolves it by name.
    calibration_name = project_manager.get_latest_calibration(project) or "none"

    # Create the trial folder where the downloaded videos will be stored.
    try:
        trial_path = project_manager.create_trial(
            project, session, data.trial_name,
            subject_id=subject_id,
            calibration_file=calibration_name,
            cameras_used=cameras_used,
        )
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error))

    # A running preview holds the camera at 1080p/30fps; stopping it restores the recording settings.
    stop_previews(cameras_used, preview_sessions)

    # Start every camera at once (sequential HTTP calls would add inter-camera offset).
    started, failed = [], {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(_start_camera, s, connected_cameras[s], profile_manager): s for s in cameras_used}
        for future, serial in futures.items():
            try:
                future.result(timeout=15)
                started.append(serial)
            except Exception as error:
                failed[serial] = str(error)

    if not started:
        # Nothing is recording: remove the empty trial so the name can be reused.
        project_manager.delete_trial(project, session, data.trial_name)
        raise HTTPException(status_code=502, detail={"message": "No camera started recording.", "failed": failed})
    if failed:
        # Carry on with the cameras that did start (one camera's failure must not affect the others).
        project_manager.update_trial(project, session, data.trial_name, cameras_used=started)

    # Remember these details because /stop is a separate HTTP request.
    recording_start_info.update({
        "cameras_used": started,
        "cam_nums": {s: serials.index(s) + 1 for s in started},
        "trial_name": data.trial_name,
        "sound_source_position": data.sound_source_position,
        "project": project,
        "session": session,
        "video_dir": str(trial_path / "video"),
        "task_id": None,
        "started_at": time.time(),
    })
    return {"message": "Recording started", "cameras_used": started, "failed": failed}


def _download_one(camera, video_path: Path) -> None:
    """Same steps as tkinter stop_and_download: wait until the camera has finished writing the
    new file (otherwise the media list still ends with the previous one), download, clear the card."""
    deadline = time.time() + ENCODING_WAIT_S
    while (camera.camBusy() or camera.encodingActive()) and time.time() < deadline:
        time.sleep(0.5)
    camera.mediaDownloadLast(str(video_path))
    camera.deleteAllFiles()


def process_recording(task_id, cameras, recording_info, tasks, project_manager):
    """cameras: {serial: (camera, gopro_number)} for every camera that was stopped."""
    job = tasks[task_id]

    try:
        video_dir = Path(recording_info["video_dir"])
        trial_name = recording_info["trial_name"]

        # Download the new video from each stopped camera in parallel; one failure doesn't stop the rest.
        job["status"] = "downloading"
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(_download_one, camera, video_dir / f"{trial_name}_GP{number}.mp4"): serial
                for serial, (camera, number) in cameras.items()
            }
            for future, serial in futures.items():
                try:
                    future.result(timeout=ENCODING_WAIT_S + 300)
                except Exception as error:
                    job["errors"][serial] = f"Download failed: {error}"

        # The camera's own extension is kept (e.g. .MP4), so list what actually arrived.
        video_paths = sorted(str(f) for f in video_dir.iterdir() if f.is_file() and f.suffix.lower() == ".mp4")
        if len(video_paths) < 2:
            job["status"] = "failed"
            job["error"] = f"Only {len(video_paths)} video(s) downloaded; at least 2 are needed to sync."
            return

        # Calculate the time offset between the downloaded videos.
        job["status"] = "syncing"

        from audio_sync import (
            compute_sync_offsets,
            evaluate_sync_acceptance,
            trim_and_sync_videos,
        )

        offsets = compute_sync_offsets(
            video_paths,
            output_dir=str(video_dir),
            sound_source_position=recording_info["sound_source_position"],
        )
        passed, reasons = evaluate_sync_acceptance(offsets)

        result_offsets = {
            Path(path).name: {
                "offset_seconds": float(result["offset_seconds"]),
                "status": result["status"],
            }
            for path, result in offsets.items()
        }

        job["results"] = {
            "passed": passed,
            "reasons": reasons,
            "offsets": result_offsets,
        }

        # Only create aligned videos when the sync checks pass.
        if not passed:
            job["status"] = "failed"
            return

        trim_and_sync_videos(video_paths, offsets, str(video_dir))
        project_manager.update_trial(
            recording_info["project"],
            recording_info["session"],
            trial_name,
            synced=True,
        )
        job["status"] = "complete"

    except Exception as error:
        job["status"] = "failed"
        job["error"] = str(error)

    finally:
        _reset(recording_info)


@router.post("/stop", status_code=202)
def stop_recording(
    background_tasks: BackgroundTasks,
    connected_cameras=connected_cameras,
    recording_start_info=recording_start_info,
    recording_background_tasks=recording_background_tasks,
    project_manager=Depends(get_project_manager),
):
    # A repeated /stop request returns the job that is already running.
    if recording_start_info.get("task_id"):
        task_id = recording_start_info["task_id"]
        return {"task_id": task_id, "status": recording_background_tasks[task_id]["status"]}

    if not recording_start_info["cameras_used"]:
        raise HTTPException(status_code=409, detail="No active recording to stop.")

    # Stop every camera that is still reachable. A camera that dropped out or fails to stop is
    # reported but doesn't block the others, so the recording always ends here.
    cameras = {}
    errors = {}
    for serial in recording_start_info["cameras_used"]:
        camera = connected_cameras.get(serial)
        if camera is None:
            errors[serial] = "Camera not connected."
            continue
        try:
            camera.shutterStop().raise_for_status()
            cameras[serial] = (camera, recording_start_info["cam_nums"][serial])
        except Exception as error:
            errors[serial] = f"Stop failed: {error}"

    # Create a small status record that the frontend can poll.
    task_id = str(uuid4())
    recording_background_tasks[task_id] = {"status": "pending", "results": None, "errors": errors}

    if not cameras:
        recording_background_tasks[task_id].update(status="failed", error="No camera could be stopped.")
        _reset(recording_start_info)
        return {"task_id": task_id, "status": "failed", "errors": errors}

    recording_start_info["task_id"] = task_id

    # Return quickly while downloading and syncing continue afterward.
    background_tasks.add_task(
        process_recording,
        task_id,
        cameras,
        recording_start_info,
        recording_background_tasks,
        project_manager,
    )

    return {"task_id": task_id, "status": "pending", "errors": errors}


@router.get("/status")
def get_recording_status(
    recording_start_info=recording_start_info,
    recording_background_tasks=recording_background_tasks,
):
    """What the server is doing now, so a reloaded page can pick up a running take.
    state: idle / recording / processing (download + sync job running, see task_id)."""
    if not recording_start_info.get("cameras_used"):
        return {"state": "idle"}
    task_id = recording_start_info.get("task_id")
    return {
        "state": "processing" if task_id else "recording",
        "trial_name": recording_start_info.get("trial_name"),
        "cameras_used": recording_start_info.get("cameras_used"),
        "sound_source_position": recording_start_info.get("sound_source_position"),
        "started_at": recording_start_info.get("started_at"),   # unix seconds
        "task_id": task_id,
        "job_status": recording_background_tasks[task_id]["status"] if task_id else None,
    }


@router.get("/jobs/{task_id}")
def get_recording_job(
    task_id: str,
    recording_background_tasks=recording_background_tasks,
):
    # The task ID works like a tracking number for the frontend.
    job = recording_background_tasks.get(task_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Recording task not found.")

    return {"task_id": task_id, **job}
