# Endpoints for managing cameras (listing, connecting, disconnecting,
# and applying resolution / fps / lens / zoom / mode settings).
# Cameras stay connected until the server shuts down: a keep-alive thread
# (start_keep_alive, run from main.py's lifespan) pings them every 30s, as the
# tkinter status monitor does, and disconnect_all() releases them on shutdown.

import concurrent.futures
import threading
import time

from fastapi import APIRouter, Depends, HTTPException

from goproUSB import GPcam
from api.deps import get_app_config, get_connected_cameras, get_preview_sessions, get_profile_manager_dep
from api.routers.preview import stop_session
from api.schemas import (
    GlobalSettings,
    ResolutionRequest,
    FPSRequest,
    LensRequest,
    SettingRequest,
    ZoomRequest,
    ZoomStepRequest,
    ModeRequest,
)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

# GoPro Open GoPro setting IDs used by the dedicated endpoints below.
SETTING_RESOLUTION = 2
SETTING_FPS = 3
SETTING_VIDEO_LENS = 121

KEEP_ALIVE_INTERVAL_S = 30

# Applied on every connect so all cameras record with the same research configuration
# (same list as the tkinter connect_camera). (setting_id, option_id, name, value)
SETTINGS_ON_CONNECT = [
    (175, 1, "Control Mode", "Pro"),
    (121, 4, "Lens", "Linear"),
    (83, 0, "GPS", "Off"),
    (167, 4, "Hindsight", "Off"),
    (135, 0, "Hypersmooth", "Off"),
    (88, 30, "LCD Brightness", "30%"),
    (134, 3, "Anti-Flicker", "50Hz"),   # Australia; the Res/FPS options assume 50Hz
    (182, 1, "Bit Rate", "High"),
    (183, 0, "Bit Depth", "8-Bit"),
    (184, 0, "Profiles", "Standard"),
    (236, 0, "Auto WiFi AP", "Off"),
]

# Restored from the saved profile so recording settings survive camera power-cycles.
CRITICAL_SETTINGS = [("2", "Video Resolution"), ("3", "Frames Per Second"), ("121", "Video Lens")]

_MODE_FUNCS = {
    "video": "modeVideo",
    "photo": "modePhoto",
    "timelapse": "modeTimelapse",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_connected_camera(serial: str, connected_cameras: dict) -> GPcam:
    cam = connected_cameras.get(serial)
    if cam is None:
        raise HTTPException(status_code=404, detail=f"Camera {serial} is not connected")
    return cam


def _apply_named_setting(serial: str, cam: GPcam, setting_id: int, display_name: str, profile_manager) -> dict:
    """
    Apply a setting by its human-readable option name (e.g. resolution "4K",
    fps "50"), using the camera's settings reference for the reverse lookup
    from display name -> option_id. Mirrors the old Tkinter app's
    apply_setting_to_camera logic, but stateless: it re-fetches camera info
    and the reference on every call instead of relying on a cached dict.
    """
    info_res = cam.getCameraInfo()
    if info_res.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to read camera info")
    cam_info = info_res.json()
    model = cam_info.get("model_name", "")
    firmware = cam_info.get("firmware_version", "")

    reference = profile_manager.load_settings_reference(model, firmware)
    if reference is None:
        raise HTTPException(
            status_code=409,
            detail=f"No settings reference found for {model} {firmware}. "
                   f"Run tools/discover_camera_settings.py {serial} first.",
        )
    
    ref_settings = reference.get("settings", {})

    setting_id_str = str(setting_id)
    if setting_id_str not in ref_settings:
        raise HTTPException(status_code=400, detail=f"Setting {setting_id} not found in reference")

    options = ref_settings[setting_id_str].get("available_options", {})
    option_id = next((int(opt_id) for opt_id, name in options.items() if name == display_name), None)
    if option_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Option '{display_name}' not valid for setting {setting_id}",
                "available_options": list(options.values()),
            },
        )

    response = cam.setSetting(setting_id, option_id)

    if response.status_code == 200:
        state_res = cam.getState()
 
        if state_res.status_code == 200:
            # Full, accurate refresh straight from the camera's current state.
            try:
                profile = profile_manager.create_or_update_profile(cam_info, state_res.json(), reference)
            except KeyError as e:
                # create_or_update_profile needs camera_info['serial_number'],
                # and parse_camera_state needs 'name'/'available_options' on
                # each reference entry. Missing either shouldn't surface as a
                # bare unhandled 500.
                raise HTTPException(status_code=502, detail=f"Camera profile update failed, missing {e}")
        else:
            # getState failed. create_or_update_profile REPLACES current_settings
            # and current_status wholesale from whatever state it's given, so
            # calling it with no state here would wipe everything the profile
            # already knew, not just leave this one setting stale.
            profile = profile_manager.load_camera_profile(serial) or {}
            setting_name = ref_settings[setting_id_str].get("name", f"Setting {setting_id}")
            profile.setdefault("current_settings", {})[setting_id_str] = {
                "value": option_id,
                "name": setting_name,
                "value_name": display_name,
            }
 
        profile.setdefault("current_settings", {}).setdefault(setting_id_str, {})
        profile["current_settings"][setting_id_str]["value"] = option_id
        profile["current_settings"][setting_id_str]["value_name"] = display_name
 
        # Resolution/fps changes can reset digital zoom on the camera, reapply
        # whatever the last saved zoom level was, same as the desktop app did.
        saved_zoom = profile.get("current_zoom", 0)
        if saved_zoom:
            try:
                cam.setDigitalZoom(saved_zoom)
            except Exception:
                pass  # non-critical, zoom just won't be restored this time
 
        profile_manager.save_camera_profile(serial, profile)
        return {"status": "success", "setting_id": setting_id, "value": option_id, "value_name": display_name}
 
    if response.status_code == 403:
        try:
            error_data = response.json()
        except Exception:
            error_data = {}
        available = error_data.get("supported_options", error_data.get("available_options", []))
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Camera rejected '{display_name}' for setting {setting_id} in its current state",
                "available_options": available,
            },
        )
 
    raise HTTPException(status_code=502, detail=f"Unexpected camera response: {response.status_code}")


# ---------------------------------------------------------------------------
# Listing / connection
# ---------------------------------------------------------------------------

@router.get("")
def list_cameras(
    app_config: dict = Depends(get_app_config),
    connected_cameras: dict = Depends(get_connected_cameras),
):
    serials = app_config.get("gopro_serial_numbers", [])
    result = []
    for i, s in enumerate(serials):
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
        result.append({"serial": s, "name": f"GoPro {i + 1}", "status": status, "battery": batt})
    return {"cameras": result}


def _connect_one(serial: str, profile_manager) -> tuple[GPcam, list[str]]:
    """Connect and configure one camera, mirroring the tkinter connect_camera.
    Returns the camera and any non-fatal warnings; raises on failure."""
    warnings = []
    cam = GPcam(serial)

    if cam.USBenable().status_code != 200:
        raise RuntimeError("Failed to enable USB control")
    time.sleep(1)
    if cam.keepAlive().status_code != 200:
        raise RuntimeError("Camera not responding to keep-alive")

    info_res = cam.getCameraInfo()
    if info_res.status_code != 200:
        raise RuntimeError("Failed to get camera info")
    cam_info = info_res.json()
    model, firmware = cam_info.get("model_name", ""), cam_info.get("firmware_version", "")

    existing = profile_manager.load_camera_profile(serial) or {}
    saved_zoom = existing.get("current_zoom", 0) or 0
    reference = profile_manager.load_settings_reference(model, firmware)
    if reference is None:
        warnings.append(f"No settings reference for {model} {firmware}; "
                        f"run tools/discover_camera_settings.py {serial}")

    # Video mode first so the video settings below are available.
    cam.modeVideo()
    time.sleep(1)

    current = {}
    state_res = cam.getState()
    if state_res.status_code == 200:
        current = state_res.json().get("settings", {})
        for setting_id, option_id, name, value in SETTINGS_ON_CONNECT:
            if current.get(str(setting_id)) != option_id:
                if cam.setSetting(setting_id, option_id).status_code != 200:
                    warnings.append(f"Could not set {name} to {value}")
                time.sleep(0.3)
    else:
        warnings.append("Could not read state; research settings not applied")

    try:
        if cam.setDateTimeNow().status_code != 200:
            warnings.append("Failed to sync date/time")
    except Exception as e:
        warnings.append(f"Failed to sync date/time: {e}")

    for setting_id, name in CRITICAL_SETTINGS:
        saved = existing.get("current_settings", {}).get(setting_id)
        if saved and current.get(setting_id) != saved.get("value"):
            if cam.setSetting(int(setting_id), saved["value"]).status_code != 200:
                warnings.append(f"Could not restore {name} to {saved.get('value_name')}")
            time.sleep(0.3)

    state_res = cam.getState()
    if state_res.status_code != 200:
        raise RuntimeError("Failed to get camera state")
    state = state_res.json()

    current_zoom = state.get("status", {}).get("75", 0)
    if saved_zoom > 0 and saved_zoom != current_zoom:
        try:
            if cam.setDigitalZoom(saved_zoom).status_code == 200:
                current_zoom = saved_zoom
            else:
                warnings.append("Failed to restore zoom")
        except Exception as e:
            warnings.append(f"Failed to restore zoom: {e}")

    if reference is not None:
        try:
            profile = profile_manager.create_or_update_profile(cam_info, state, reference)
            profile["current_zoom"] = current_zoom
            profile_manager.save_camera_profile(serial, profile)
        except Exception as e:
            warnings.append(f"Profile update failed: {e}")

    return cam, warnings


@router.post("/connect-all")
def connect_all(
    app_config: dict = Depends(get_app_config),
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    """Connect and configure every configured camera that isn't already connected, in parallel.
    One camera failing doesn't affect the others."""
    serials = app_config.get("gopro_serial_numbers", [])
    results = {s: {"status": "already_connected"} for s in serials if s in connected_cameras}
    todo = [s for s in serials if s not in connected_cameras]

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(_connect_one, s, profile_manager): s for s in todo}
        for future, serial in futures.items():
            try:
                cam, warnings = future.result()
                connected_cameras[serial] = cam
                results[serial] = {"status": "success", "warnings": warnings}
                print(f"Connected {serial}" + (f" (warnings: {warnings})" if warnings else ""))
            except Exception as e:
                results[serial] = {"status": "error", "detail": str(e)}
                print(f"Failed to connect {serial}: {e}")
    return {"status": "complete", "results": results}


@router.post("/{serial}/connect")
def connect_camera(
    serial: str,
    app_config: dict = Depends(get_app_config),
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    """Connect one camera (same setup as connect-all). The UI uses connect-all; kept for scripting/testing."""
    if serial not in app_config.get("gopro_serial_numbers", []):
        raise HTTPException(status_code=404, detail=f"Unknown camera {serial}")
    try:
        cam, warnings = _connect_one(serial, profile_manager)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to connect: {e}")
    connected_cameras[serial] = cam
    return {"status": "success", "warnings": warnings}


@router.post("/{serial}/disconnect")
def disconnect_camera(
    serial: str,
    connected_cameras: dict = Depends(get_connected_cameras),
    preview_sessions: dict = Depends(get_preview_sessions),
):
    stop_session(serial, preview_sessions)   # a running preview would otherwise outlive the connection
    if serial in connected_cameras:
        try:
            connected_cameras[serial].USBdisable()
        except Exception:
            pass
        del connected_cameras[serial]
    return {"status": "success"}


def disconnect_all(connected_cameras: dict, preview_sessions: dict) -> None:
    """Stop previews and release USB control on every camera. Called on server shutdown."""
    for serial in list(connected_cameras):
        stop_session(serial, preview_sessions)
        try:
            connected_cameras[serial].USBdisable()
        except Exception:
            pass
        connected_cameras.pop(serial, None)
        print(f"Disconnected {serial}")


def start_keep_alive(connected_cameras: dict, stop_event: threading.Event) -> threading.Thread:
    """Ping every connected camera every 30s so it stays connected and awake, preview or not.
    On a failed ping, re-assert USB control; the camera stays in the list and the next round retries."""
    def loop():
        while not stop_event.wait(KEEP_ALIVE_INTERVAL_S):
            for serial, cam in list(connected_cameras.items()):
                try:
                    if cam.keepAlive().status_code == 200:
                        continue
                except Exception:
                    pass
                print(f"Keep-alive failed for {serial}, re-enabling USB control")
                try:
                    cam.USBenable()
                except Exception:
                    pass

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()
    return thread


# ---------------------------------------------------------------------------
# Info / state / settings reference
# ---------------------------------------------------------------------------

@router.get("/{serial}/info")
def get_camera_info(serial: str, connected_cameras: dict = Depends(get_connected_cameras)):
    cam = _get_connected_camera(serial, connected_cameras)
    res = cam.getCameraInfo()
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to read camera info")
    return res.json()


@router.get("/{serial}/state")
def get_camera_state(serial: str, connected_cameras: dict = Depends(get_connected_cameras)):
    cam = _get_connected_camera(serial, connected_cameras)
    res = cam.getState()
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to read camera state")
    return res.json()


@router.get("/{serial}/settings/reference")
def get_settings_reference(
    serial: str,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    """Available options per setting for this camera's model/firmware — lets the
    React UI build dropdowns with real display names instead of raw option IDs."""
    cam = _get_connected_camera(serial, connected_cameras)
    info_res = cam.getCameraInfo()
    if info_res.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to read camera info")
    cam_info = info_res.json()
    reference = profile_manager.load_settings_reference(
        cam_info.get("model_name", ""), cam_info.get("firmware_version", "")
    )
    if reference is None:
        raise HTTPException(
            status_code=404,
            detail=f"No settings reference found for {cam_info.get('model_name')} "
                   f"{cam_info.get('firmware_version')}",
        )
    return reference


@router.get("/{serial}/settings")
def get_camera_settings(serial: str, profile_manager=Depends(get_profile_manager_dep)):
    profile = profile_manager.load_camera_profile(serial)
    if profile:
        return {"status": "success", "profile": profile}
    raise HTTPException(status_code=404, detail="Camera profile not found")


# ---------------------------------------------------------------------------
# Resolution / FPS / lens — single camera
# ---------------------------------------------------------------------------

@router.post("/{serial}/resolution")
def set_resolution(
    serial: str,
    body: ResolutionRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = _get_connected_camera(serial, connected_cameras)
    return _apply_named_setting(serial, cam, SETTING_RESOLUTION, body.resolution, profile_manager)


@router.post("/{serial}/fps")
def set_fps(
    serial: str,
    body: FPSRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = _get_connected_camera(serial, connected_cameras)
    return _apply_named_setting(serial, cam, SETTING_FPS, body.fps, profile_manager)


@router.post("/{serial}/lens")
def set_lens(
    serial: str,
    body: LensRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = _get_connected_camera(serial, connected_cameras)
    return _apply_named_setting(serial, cam, SETTING_VIDEO_LENS, body.lens, profile_manager)


@router.post("/{serial}/setting")
def set_generic_setting(
    serial: str,
    body: SettingRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    """Apply any setting by ID + display name — covers the settings that don't
    have a dedicated endpoint (GPS, Hypersmooth, Anti-Flicker, Bit Rate, etc.)."""
    cam = _get_connected_camera(serial, connected_cameras)
    return _apply_named_setting(serial, cam, body.setting_id, body.display_name, profile_manager)


# ---------------------------------------------------------------------------
# Resolution / FPS — applied to every connected camera at once
# ---------------------------------------------------------------------------

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


@router.post("/resolution/all")
def set_resolution_all(
    body: ResolutionRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    """Same as /{serial}/resolution but applied to every connected camera,
    with validation and profile updates (unlike the raw /settings/global)."""
    results = {}
    for serial, cam in connected_cameras.items():
        try:
            results[serial] = _apply_named_setting(serial, cam, SETTING_RESOLUTION, body.resolution, profile_manager)
        except HTTPException as e:
            results[serial] = {"status": "error", "detail": e.detail}
    return {"status": "complete", "results": results}


@router.post("/fps/all")
def set_fps_all(
    body: FPSRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    results = {}
    for serial, cam in connected_cameras.items():
        try:
            results[serial] = _apply_named_setting(serial, cam, SETTING_FPS, body.fps, profile_manager)
        except HTTPException as e:
            results[serial] = {"status": "error", "detail": e.detail}
    return {"status": "complete", "results": results}


# ---------------------------------------------------------------------------
# Zoom
# ---------------------------------------------------------------------------

@router.get("/{serial}/zoom")
def get_zoom(serial: str, connected_cameras: dict = Depends(get_connected_cameras)):
    cam = _get_connected_camera(serial, connected_cameras)
    level = cam.getZoomLevel()
    if level is None:
        raise HTTPException(status_code=502, detail="Failed to read zoom level")
    return {"serial": serial, "zoom": level}


@router.post("/{serial}/zoom")
def set_zoom(
    serial: str,
    body: ZoomRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = _get_connected_camera(serial, connected_cameras)
    try:
        response = cam.setDigitalZoom(body.percent)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Camera rejected zoom level")

    profile = profile_manager.load_camera_profile(serial) or {}
    profile["current_zoom"] = body.percent
    profile_manager.save_camera_profile(serial, profile)
    return {"serial": serial, "zoom": body.percent}


@router.post("/{serial}/zoom/in")
def zoom_in(
    serial: str,
    body: ZoomStepRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = _get_connected_camera(serial, connected_cameras)
    response = cam.zoomIn(step=body.step)
    if response is None or response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to zoom in")
    level = cam.getZoomLevel()
    profile = profile_manager.load_camera_profile(serial) or {}
    profile["current_zoom"] = level
    profile_manager.save_camera_profile(serial, profile)
    return {"serial": serial, "zoom": level}


@router.post("/{serial}/zoom/out")
def zoom_out(
    serial: str,
    body: ZoomStepRequest,
    connected_cameras: dict = Depends(get_connected_cameras),
    profile_manager=Depends(get_profile_manager_dep),
):
    cam = _get_connected_camera(serial, connected_cameras)
    response = cam.zoomOut(step=body.step)
    if response is None or response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to zoom out")
    level = cam.getZoomLevel()
    profile = profile_manager.load_camera_profile(serial) or {}
    profile["current_zoom"] = level
    profile_manager.save_camera_profile(serial, profile)
    return {"serial": serial, "zoom": level}


# ---------------------------------------------------------------------------
# Mode / presets
# ---------------------------------------------------------------------------

@router.post("/{serial}/mode")
def set_mode(serial: str, body: ModeRequest, connected_cameras: dict = Depends(get_connected_cameras)):
    """Switch the camera's preset group — {mode: "video", "photo", "timelapse"}"""
    cam = _get_connected_camera(serial, connected_cameras)
    func_name = _MODE_FUNCS.get(body.mode)
    if func_name is None:
        raise HTTPException(status_code=400, detail=f"Unknown mode '{body.mode}'. Use one of {list(_MODE_FUNCS)}")
    response = getattr(cam, func_name)()
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Camera rejected mode change to '{body.mode}'")
    return {"serial": serial, "mode": body.mode}


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

@router.post("/{serial}/sync-time")
def sync_time(serial: str, connected_cameras: dict = Depends(get_connected_cameras)):
    """Push the server's current time to the camera clock, via setDateTimeNow()
    — keeps video timestamps consistent across cameras"""
    cam = _get_connected_camera(serial, connected_cameras)
    response = cam.setDateTimeNow()
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to sync camera time")
    return {"serial": serial, "status": "synced"}
