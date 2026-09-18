# Shared app state and FastAPI dependencies. Loads the app config and creates
# the ProjectManager once at startup, then exposes them to routers via
# get_project_manager() / get_app_config() so nothing relies on module globals.

from pathlib import Path
from fastapi import FastAPI, Request

from go2kin import load_app_config, save_app_config
from project_manager import ProjectManager


def init_app_state(app: FastAPI) -> None:
    """Call once at startup, from server.py. Loads config and creates the
    ProjectManager, storing both on app.state instead of module globals so
    every router can reach them through a dependency."""
    config = load_app_config()
    if not config.get("data_root") or not Path(config["data_root"]).is_dir():
        config["data_root"] = str(Path(__file__).resolve().parent.parent.parent / "output")
        Path(config["data_root"]).mkdir(parents=True, exist_ok=True)
        save_app_config(config)

    app.state.app_config = config
    app.state.pm = ProjectManager(config["data_root"])


def get_project_manager(request: Request) -> ProjectManager:
    return request.app.state.pm


def get_app_config(request: Request) -> dict:
    return request.app.state.app_config