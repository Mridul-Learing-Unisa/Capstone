# Endpoints for reading and updating the app level config (data root, GoPro
# serials, last opened project/session/calibration).

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from go2kin import save_app_config
from project_manager import ProjectManager
from api.schemas import ConfigUpdate

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
def get_config(request: Request):
    return request.app.state.app_config


@router.post("")
def update_config(config_update: ConfigUpdate, request: Request):
    # Update the live dict in place: other code (calibration threads) holds a reference to it.
    current_config = request.app.state.app_config

    if config_update.data_root is not None and config_update.data_root != current_config.get("data_root"):
        if not Path(config_update.data_root).is_dir():
            raise HTTPException(status_code=400, detail=f"Data folder not found: {config_update.data_root}")
        current_config["data_root"] = config_update.data_root
        request.app.state.pm = ProjectManager(config_update.data_root)
        # The old selection points into the previous data folder.
        request.app.state.selection_state.update(project=None, session=None, subject_id=None)
        current_config.update(last_project="", last_session="", last_participant="")
    if config_update.gopro_serial_numbers is not None:
        current_config["gopro_serial_numbers"] = config_update.gopro_serial_numbers
    if config_update.last_project is not None:
        current_config["last_project"] = config_update.last_project
    if config_update.last_session is not None:
        current_config["last_session"] = config_update.last_session
    if config_update.last_calibration is not None:
        current_config["last_calibration"] = config_update.last_calibration

    save_app_config(current_config)
    return {"status": "success", "config": current_config}
