from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.deps import (
    connected_cameras,
    recording_background_tasks,
    recording_start_info,
    get_app_config,
    get_project_manager,
)
from api.schemas import RecordingStartRequest


router = APIRouter(prefix="/api/recording", tags=["recording"])


@router.post("/start")
def start_recording(
    data: RecordingStartRequest,
    connected_cameras=connected_cameras,
    recording_start_info=recording_start_info,
    app_config=Depends(get_app_config),
    project_manager=Depends(get_project_manager),
):
    # Prevent two recordings from using the cameras at the same time.
    if recording_start_info["cameras_used"] or recording_start_info.get("task_id"):
        raise HTTPException(status_code=409, detail="A recording is already active.")

    # Remove duplicate serial numbers and confirm each camera is connected.
    cameras_used = list(dict.fromkeys(data.cameras_used))

    for serial in cameras_used:
        if serial not in connected_cameras:
            raise HTTPException(status_code=400, detail=f"Camera {serial} is not connected.")

    project = app_config.get("last_project")
    session = app_config.get("last_session")

    if not project or not session:
        raise HTTPException(status_code=400, detail="Select a project and session first.")

    # Create the trial folder where the downloaded videos will be stored.
    try:
        trial_path = project_manager.create_trial(
            project,
            session,
            data.trial_name,
            subject_id="",
            calibration_file=app_config.get("last_calibration") or "none",
            cameras_used=cameras_used,
        )
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error))

    # Remember these details because /stop is a separate HTTP request.
    recording_start_info.update({
        "cameras_used": cameras_used,
        "trial_name": data.trial_name,
        "sound_source_position": data.sound_source_position,
        "project": project,
        "session": session,
        "video_dir": str(trial_path / "video"),
        "task_id": None,
    })

    # Send the shutter-start command to every selected camera.
    try:
        for serial in cameras_used:
            response = connected_cameras[serial].shutterStart()
            response.raise_for_status()
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Failed to start recording: {error}")

    return {"message": "Recording started", "cameras_used": cameras_used}


def process_recording(task_id, cameras, recording_info, tasks, project_manager):
    job = tasks[task_id]

    try:
        video_dir = Path(recording_info["video_dir"])
        video_paths = []

        # Download the latest video from each stopped camera.
        job["status"] = "downloading"

        for number, camera in enumerate(cameras.values(), start=1):
            output_path = video_dir / f'{recording_info["trial_name"]}_GP{number}.mp4'
            camera.mediaDownloadLast(str(output_path))
            video_paths.append(str(output_path))

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
            recording_info["trial_name"],
            synced=True,
        )
        job["status"] = "complete"

    except Exception as error:
        job["status"] = "failed"
        job["error"] = str(error)

    finally:
        recording_info.clear()
        recording_info.update({
            "cameras_used": [],
            "trial_name": None,
            "sound_source_position": [],
        })


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

    # Try to stop every camera and collect any failures.
    cameras = {}
    errors = {}

    for serial in recording_start_info["cameras_used"]:
        camera = connected_cameras.get(serial)

        if camera is None:
            errors[serial] = "Camera not found."
            continue

        cameras[serial] = camera

        try:
            response = camera.shutterStop()
            response.raise_for_status()
        except Exception as error:
            errors[serial] = str(error)

    if errors:
        raise HTTPException(
            status_code=502,
            detail={"message": "Some cameras could not stop.", "errors": errors},
        )

    # Create a small status record that the frontend can poll.
    task_id = str(uuid4())
    recording_start_info["task_id"] = task_id
    recording_background_tasks[task_id] = {
        "status": "pending",
        "results": None,
    }

    # Return quickly while downloading and syncing continue afterward.
    background_tasks.add_task(
        process_recording,
        task_id,
        cameras,
        recording_start_info,
        recording_background_tasks,
        project_manager,
    )

    return {"task_id": task_id, "status": "pending"}


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
