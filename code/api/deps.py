# Shared app state and FastAPI dependencies. Loads the app config and creates
# the ProjectManager once at startup, then exposes them to routers via
# get_project_manager() / get_app_config() so nothing relies on module globals.

from pathlib import Path
from fastapi import FastAPI, Request

from go2kin import load_app_config, save_app_config
from project_manager import ProjectManager
from camera_profiles import get_profile_manager


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
        "status": "idle",   # idle, recording, downloading, processing, complete, error
        "message": "",
        "intrinsic_results": {},
        "bundle": None,
        "camera_array": None,
        "recording_info": None,
        "charuco": None,
    }


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