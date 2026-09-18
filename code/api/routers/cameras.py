# Endpoints for managing cameras (listing, connecting, disconnecting, setting global params).

from fastapi import APIRouter, Depends, HTTPException

from goproUSB import GPcam
from api.deps import get_app_config, get_connected_cameras, get_profile_manager_dep
from api.schemas import GlobalSettings

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("")
def list_cameras(
    app_config: dict = Depends(get_app_config),
    connected_cameras: dict = Depends(get_connected_cameras),
):
    serials = app_config.get("gopro_serial_numbers", [])
    result = []
    for s in serials:
        status = "disconnected"
        batt = None
        if s in connected_cameras:
            try:
                state = connected_cameras[s].getState()
                if state.status_code == 200:
                    status = "connected"
                    batt = state.json().get("status", {}).get("70", None)  # 70 is internal battery %
                else:
                    status = "error"
            except Exception:
                status = "error"
        result.append({"serial": s, "status": status, "battery": batt})
    return {"cameras": result}


@router.post("/{serial}/connect")
def connect_camera(
    serial: str,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = GPcam(serial)
    try:
        res = cam.getCameraInfo()
        if res.status_code == 200:
            connected_cameras[serial] = cam
            cam.USBenable()

            try:
                state_res = cam.getState()
                if state_res.status_code == 200:
                    cam_info = res.json()
                    state_json = state_res.json()
                    # We might need reference to properly create profile, but we'll try without
                    model = cam_info.get('model_name', '')
                    firmware = cam_info.get('firmware_version', '')
                    reference = profile_manager.load_settings_reference(model, firmware)
                    if reference:
                        profile_manager.create_or_update_profile(cam_info, state_json, reference)
            except Exception as e:
                print(f"Warning: Failed to update camera profile for {serial}: {e}")

            return {"status": "success"}
        else:
            raise HTTPException(status_code=400, detail="Failed to connect, camera returned error")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{serial}/disconnect")
def disconnect_camera(serial: str, connected_cameras: dict = Depends(get_connected_cameras)):
    if serial in connected_cameras:
        try:
            connected_cameras[serial].USBdisable()
        except Exception:
            pass
        del connected_cameras[serial]
    return {"status": "success"}


@router.post("/settings/global")
def set_global_settings(settings: GlobalSettings, connected_cameras: dict = Depends(get_connected_cameras)):
    results = {}
    for s, cam in connected_cameras.items():
        try:
            cam.setSetting(2, settings.resolution)
            cam.setSetting(3, settings.fps)
            results[s] = "success"
        except Exception as e:
            results[s] = str(e)
    return {"status": "complete", "results": results}


@router.get("/{serial}/settings")
def get_camera_settings(serial: str, profile_manager=Depends(get_profile_manager_dep)):
    profile = profile_manager.load_camera_profile(serial)
    if profile:
        return {"status": "success", "profile": profile}
    raise HTTPException(status_code=404, detail="Camera profile not found")