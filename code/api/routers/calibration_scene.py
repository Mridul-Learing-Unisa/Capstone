# Read-only endpoint feeding the React Three Fiber 3D camera-position preview.
# Mirrors CalibrationTab._update_3d_viewer: positions/look directions are computed
# here in Python so the frontend only has to draw them. Like the tkinter viewer, it
# shows only the *current* calibration (no browsing of older files).
#
# Coordinate frame: calibration world frame (OpenCV camera convention, Z up in world).
# The frontend is responsible for any axis swap to three.js (Y up).

from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from calibration.data_types import CameraArray
from calibration.persistence import load_calibration
from api.deps import get_app_config, get_calibration_state

router = APIRouter(prefix="/api/calibration/scene", tags=["calibration-scene"])


def _camera_array_to_scene(camera_array: CameraArray) -> list[dict]:
    cameras = []
    for cam_id, cam in sorted(camera_array.posed_cameras.items()):
        if cam.rotation is None or cam.translation is None:
            continue
        R = np.asarray(cam.rotation, dtype=float)
        t = np.asarray(cam.translation, dtype=float).reshape(3)

        entry = {
            "id": int(cam_id),
            "position": (-R.T @ t).tolist(),
            "look_direction": (R.T @ np.array([0.0, 0.0, 1.0])).tolist(),
            "up_direction": (R.T @ np.array([0.0, -1.0, 0.0])).tolist(),
            "rotation": R.tolist(),
            "translation": t.tolist(),
            "size": list(cam.size) if cam.size is not None else None,
            "fov_y_deg": None,
        }
        if cam.matrix is not None and cam.size is not None:
            fy = float(np.asarray(cam.matrix)[1, 1])
            entry["fov_y_deg"] = float(np.degrees(2 * np.arctan(cam.size[1] / (2 * fy))))
        cameras.append(entry)
    return cameras


def _scene_response(camera_array: CameraArray, source: str) -> dict:
    return {
        "source": source,
        "frame": "world, Z up; OpenCV camera convention (x right, y down, z forward)",
        "cameras": _camera_array_to_scene(camera_array),
    }


@router.get("")
def get_scene(
    app_config: dict = Depends(get_app_config),
    calibration_state: dict = Depends(get_calibration_state),
):
    """Camera poses of the current calibration.

    Uses the in-memory extrinsic result if one exists, otherwise the calibration
    file in app_config["last_calibration"] (set when a calibration is applied or loaded).
    """
    camera_array = calibration_state.get("camera_array")
    if camera_array is not None and camera_array.posed_cameras:
        return _scene_response(camera_array, "live")

    last = app_config.get("last_calibration", "")
    path = Path(last) if last else None
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="No current calibration")

    try:
        camera_array, _, _ = load_calibration(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not load calibration: {e}")
    if not camera_array.posed_cameras:
        raise HTTPException(status_code=404, detail="Calibration has no posed cameras")
    return _scene_response(camera_array, "saved")
