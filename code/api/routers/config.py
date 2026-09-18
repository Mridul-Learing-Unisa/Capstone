# Endpoints for reading and updating the app level config (data root, GoPro
# serials, last opened project/session/calibration).

from fastapi import APIRouter, Request

from go2kin import load_app_config, save_app_config
from project_manager import ProjectManager
from api.schemas import ConfigUpdate

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
def get_config():
    return load_app_config()


@router.post("")
def update_config(config_update: ConfigUpdate, request: Request):
    current_config = load_app_config()

    if config_update.data_root is not None:
        current_config["data_root"] = config_update.data_root
        request.app.state.pm = ProjectManager(config_update.data_root)
    if config_update.gopro_serial_numbers is not None:
        current_config["gopro_serial_numbers"] = config_update.gopro_serial_numbers
    if config_update.last_project is not None:
        current_config["last_project"] = config_update.last_project
    if config_update.last_session is not None:
        current_config["last_session"] = config_update.last_session
    if config_update.last_calibration is not None:
        current_config["last_calibration"] = config_update.last_calibration

    save_app_config(current_config)
    request.app.state.app_config = current_config
    return {"status": "success", "config": current_config}