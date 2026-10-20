# Shared app state and FastAPI dependencies. Loads the app config and creates
# the ProjectManager once at startup, then exposes them to routers via
# get_project_manager() / get_app_config() so nothing relies on module globals.

from pathlib import Path
from fastapi import FastAPI, Request, Depends

from go2kin import load_app_config, save_app_config
from project_manager import ProjectManager
from camera_profiles import get_profile_manager
from api.processing_job import ProcessingJob


def init_app_state(app: FastAPI) -> None:
    """Call once at startup, from server.py. Creates every piece of shared,
    cross-request state and stores it on app.state instead of module globals,
    so every router (and, for calibration's background threads, an explicit
    argument) can reach it."""
    config = load_app_config()
    if not config.get("data_root") or not Path(config["data_root"]).is_dir():
        config["data_root"] = str(Path(__file__).resolve().parent.parent.parent / "output")
        Path(config["data_root"]).mkdir(parents=True, exist_ok=True)
        save_app_config(config)

    app.state.app_config = config
    app.state.pm = ProjectManager(config["data_root"])
    app.state.connected_cameras = {}   # serial -> GPcam instance, shared by cameras.py and calibration.py
    app.state.profile_manager = get_profile_manager()
    app.state.calibration_state = {
        "status": "idle",   # idle, recording, downloading, syncing, processing, complete, error
        "stage": None,      # which step status/message refer to: intrinsic, extrinsic, origin
        "message": "",
        "intrinsic_results": {},   # cam_num -> {"camera", "report", "serial"}
        "intrinsic_videos": {},    # cam_num -> Path of the video to calibrate from
        "bundle": None,
        "camera_array": None,
        "extrinsic_report": None,  # {"rmse", "n_cameras", "n_points", "level"}
        "origin_set": False,
        "loaded_file": None,       # name of the calibration file last loaded/applied
        "sync_issue": None,        # populated when audio sync rejects an extrinsic recording
        "recording_info": None,
        "charuco": None,           # active Charuco (saved config, or the one from a loaded calibration)
    }
    
    # Recording start information, used by the recording tab to track the current recording session.
    app.state.recording_start_info = {
        "cameras_used": [],
        "trial_name": None,
        "sound_source_position": []
    }
    
    app.state.recording_background_tasks = {}

    app.state.preview_sessions = {}   # serial -> PreviewSession, owned by preview.py

    app.state.processing_job = ProcessingJob()   # Pose2Sim run state, owned by processing.py

    app.state.selection_state = restore_selection(app.state.pm, config)


def restore_selection(pm: ProjectManager, config: dict) -> dict:
    """Last project/session/participant from the config, as the tkinter TopBar restores them.
    Each is kept only if it still exists (and the session/participant only if the project does)."""
    selection = {"project": None, "session": None, "subject_id": None}
    project = config.get("last_project", "")
    if not project or project not in pm.list_projects():
        return selection
    selection["project"] = project
    try:
        if config.get("last_session", "") in pm.list_sessions(project):
            selection["session"] = config["last_session"]
        participant = config.get("last_participant", "")
        if participant and any(s["subject_id"] == participant for s in pm.list_subjects(project)):
            selection["subject_id"] = participant
    except Exception as e:
        print(f"Could not fully restore last selection: {e}")
    return selection


def get_selection_state(request: Request) -> dict:
    return request.app.state.selection_state


def get_project_manager(request: Request) -> ProjectManager:
    return request.app.state.pm


def get_app_config(request: Request) -> dict:
    return request.app.state.app_config


def get_connected_cameras(request: Request) -> dict:
    return request.app.state.connected_cameras


def get_profile_manager_dep(request: Request):
    return request.app.state.profile_manager


def get_calibration_state(request: Request) -> dict:
    return request.app.state.calibration_state


def get_preview_sessions(request: Request) -> dict:
    return request.app.state.preview_sessions


def get_processing_job(request: Request) -> ProcessingJob:
    return request.app.state.processing_job


# Recording Tab dependencies
def get_recording_start_info(request: Request) -> dict:
    return request.app.state.recording_start_info


def get_recording_background_tasks(request: Request) -> dict:
    return request.app.state.recording_background_tasks


# Register the dependencies for use in recording_router.
connected_cameras = Depends(get_connected_cameras)
recording_start_info = Depends(get_recording_start_info)
recording_background_tasks = Depends(get_recording_background_tasks)
selection_state = Depends(get_selection_state)