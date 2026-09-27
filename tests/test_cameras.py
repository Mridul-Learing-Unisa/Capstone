"""Tests for the cameras API endpoints (code/api/cameras.py)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

# Add code/ to path, same as test_project_manager.py
CODE_DIR = Path(__file__).resolve().parent.parent / "code"
sys.path.insert(0, str(CODE_DIR))
sys.path.insert(0, str(CODE_DIR / "goproUSB"))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from camera_profiles import CameraProfileManager
import api.routers.cameras as cameras_router
from api.deps import get_app_config, get_connected_cameras, get_profile_manager_dep


# ── Test doubles ─────────────────────────────────────────────────────────

class FakeResponse:
    """Minimal stand in for a requests.Response, only what cameras.py touches."""

    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}

    def json(self):
        return self._json_data


class FakeGPcam:
    """Test double for GPcam. Every call is driven by plain attributes set
    directly on the instance before hitting the endpoint under test, no
    network I/O, no real GPcam involved."""

    def __init__(self, serial="CAM001", model="HERO12 Black", firmware="H12.01.01.10.00"):
        self.serial = serial
        self.model = model
        self.firmware = firmware

        self.info_status = 200
        self.info_json = {"model_name": model, "firmware_version": firmware, "serial_number": serial}

        self.state_status = 200
        self.state_json = {"settings": {}, "status": {}}

        self.set_setting_status = 200
        self.set_setting_json = {}

        self.zoom_level = 0
        self.zoom_status = 200

        self.mode_status = 200
        self.sync_time_status = 200
        self.usb_enable_status = 200
        self.usb_disable_status = 200

    def getCameraInfo(self):
        return FakeResponse(self.info_status, self.info_json)

    def getState(self):
        return FakeResponse(self.state_status, self.state_json)

    def setSetting(self, setting_id, option_id):
        return FakeResponse(self.set_setting_status, self.set_setting_json)

    def setDigitalZoom(self, percent):
        if not 0 <= percent <= 100:
            raise ValueError("Zoom percent must be between 0 and 100")
        self.zoom_level = percent
        return FakeResponse(self.zoom_status)

    def getZoomLevel(self):
        return self.zoom_level

    def zoomIn(self, step=5):
        self.zoom_level = min(100, self.zoom_level + step)
        return FakeResponse(self.zoom_status)

    def zoomOut(self, step=5):
        self.zoom_level = max(0, self.zoom_level - step)
        return FakeResponse(self.zoom_status)

    def modeVideo(self):
        return FakeResponse(self.mode_status)

    def modePhoto(self):
        return FakeResponse(self.mode_status)

    def modeTimelapse(self):
        return FakeResponse(self.mode_status)

    def setDateTimeNow(self):
        return FakeResponse(self.sync_time_status)

    def USBenable(self):
        return FakeResponse(self.usb_enable_status)

    def USBdisable(self):
        return FakeResponse(self.usb_disable_status)


def _write_reference(pm, model, firmware, settings):
    """Write a settings reference JSON so profile_manager.load_settings_reference
    can find it. `settings` is {setting_id_str: {"name":, "available_options": {option_id_str: name}}}.
    """
    path = pm.get_reference_path(model, firmware)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"settings": settings, "status_names": {}}, f)


class TestCamerasAPI(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pm = CameraProfileManager(config_dir=Path(self.temp_dir.name))

        self.connected_cameras = {}
        self.app_config = {"gopro_serial_numbers": []}

        app = FastAPI()
        app.include_router(cameras_router.router)
        app.dependency_overrides[get_app_config] = lambda: self.app_config
        app.dependency_overrides[get_connected_cameras] = lambda: self.connected_cameras
        app.dependency_overrides[get_profile_manager_dep] = lambda: self.pm

        self.client = TestClient(app)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _connect_fake(self, serial="CAM001", **overrides):
        cam = FakeGPcam(serial=serial)
        for key, value in overrides.items():
            setattr(cam, key, value)
        self.connected_cameras[serial] = cam
        return cam

    # ── Not connected ────────────────────────────────────────────────────

    def test_info_not_connected_returns_404(self):
        resp = self.client.get("/api/cameras/UNKNOWN/info")
        self.assertEqual(resp.status_code, 404)

    def test_zoom_not_connected_returns_404(self):
        resp = self.client.get("/api/cameras/UNKNOWN/zoom")
        self.assertEqual(resp.status_code, 404)

    def test_resolution_not_connected_returns_404(self):
        resp = self.client.post("/api/cameras/UNKNOWN/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 404)

    # ── list_cameras ─────────────────────────────────────────────────────

    def test_list_cameras_mixed_status(self):
        self.app_config["gopro_serial_numbers"] = ["CAM001", "CAM002"]
        self._connect_fake("CAM001")
        resp = self.client.get("/api/cameras")
        self.assertEqual(resp.status_code, 200)
        statuses = {c["serial"]: c["status"] for c in resp.json()["cameras"]}
        self.assertEqual(statuses["CAM001"], "connected")
        self.assertEqual(statuses["CAM002"], "disconnected")

    # ── disconnect ───────────────────────────────────────────────────────

    def test_disconnect_removes_camera(self):
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/disconnect")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("CAM001", self.connected_cameras)

    def test_disconnect_unknown_camera_still_succeeds(self):
        resp = self.client.post("/api/cameras/UNKNOWN/disconnect")
        self.assertEqual(resp.status_code, 200)

    # ── info / state ─────────────────────────────────────────────────────

    def test_get_info_success(self):
        self._connect_fake("CAM001")
        resp = self.client.get("/api/cameras/CAM001/info")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["model_name"], "HERO12 Black")

    def test_get_info_camera_error_returns_502(self):
        self._connect_fake("CAM001", info_status=500)
        resp = self.client.get("/api/cameras/CAM001/info")
        self.assertEqual(resp.status_code, 502)

    def test_get_state_success(self):
        self._connect_fake("CAM001", state_json={"settings": {"2": 1}, "status": {"70": 80}})
        resp = self.client.get("/api/cameras/CAM001/state")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"]["70"], 80)

    def test_get_state_camera_error_returns_502(self):
        self._connect_fake("CAM001", state_status=500)
        resp = self.client.get("/api/cameras/CAM001/state")
        self.assertEqual(resp.status_code, 502)

    # ── settings reference ───────────────────────────────────────────────

    def test_settings_reference_success(self):
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K", "9": "1080"}}
        })
        resp = self.client.get("/api/cameras/CAM001/settings/reference")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("2", resp.json()["settings"])

    def test_settings_reference_missing_returns_404(self):
        self._connect_fake("CAM001")
        resp = self.client.get("/api/cameras/CAM001/settings/reference")
        self.assertEqual(resp.status_code, 404)

    # ── get_camera_settings (saved profile lookup) ──────────────────────

    def test_get_camera_settings_not_found(self):
        resp = self.client.get("/api/cameras/CAM001/settings")
        self.assertEqual(resp.status_code, 404)

    def test_get_camera_settings_found(self):
        self.pm.save_camera_profile("CAM001", {"serial_number": "CAM001", "current_settings": {}})
        resp = self.client.get("/api/cameras/CAM001/settings")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["profile"]["serial_number"], "CAM001")

    # ── resolution / fps / lens / setting (_apply_named_setting) ────────

    def test_set_resolution_success_full_refresh(self):
        cam = self._connect_fake("CAM001", state_json={"settings": {"2": 1}, "status": {}})
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K", "9": "1080"}}
        })
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["value_name"], "4K")
        profile = self.pm.load_camera_profile("CAM001")
        self.assertEqual(profile["current_settings"]["2"]["value_name"], "4K")

    def test_set_resolution_getstate_fails_preserves_other_settings(self):
        """Regression test, a getState failure right after a successful
        setSetting must not wipe settings that were already saved."""
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K", "9": "1080"}},
            "3": {"name": "Frames Per Second", "available_options": {"6": "50", "8": "30"}},
        })
        self.pm.save_camera_profile("CAM001", {
            "serial_number": "CAM001",
            "current_settings": {"3": {"value": 6, "name": "Frames Per Second", "value_name": "50"}},
        })

        cam.state_status = 500
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 200)

        profile = self.pm.load_camera_profile("CAM001")
        self.assertEqual(profile["current_settings"]["2"]["value_name"], "4K")
        self.assertEqual(profile["current_settings"]["3"]["value_name"], "50")

    def test_set_resolution_invalid_option_returns_400(self):
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K"}}
        })
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "8K"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("available_options", resp.json()["detail"])

    def test_set_resolution_no_reference_returns_409(self):
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 409)

    def test_set_resolution_reference_missing_settings_key_returns_400(self):
        """Regression test, a reference dict with no "settings" key at all
        should read as no options known, not raise a bare KeyError."""
        cam = self._connect_fake("CAM001")
        path = self.pm.get_reference_path(cam.model, cam.firmware)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump({}, f)
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 400)

    def test_set_resolution_camera_rejects_returns_409_with_options(self):
        cam = self._connect_fake(
            "CAM001", set_setting_status=403, set_setting_json={"supported_options": ["1080", "2.7K"]}
        )
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K", "9": "1080"}}
        })
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["detail"]["available_options"], ["1080", "2.7K"])

    def test_set_resolution_missing_serial_number_returns_502(self):
        """Regression test, create_or_update_profile needs camera_info['serial_number'],
        a camera whose info response lacks it must not surface as a bare 500."""
        cam = self._connect_fake("CAM001")
        cam.info_json = {"model_name": cam.model, "firmware_version": cam.firmware}
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K"}}
        })
        resp = self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 502)

    def test_set_resolution_reapplies_saved_zoom(self):
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "2": {"name": "Video Resolution", "available_options": {"1": "4K"}}
        })
        self.pm.save_camera_profile("CAM001", {"serial_number": "CAM001", "current_zoom": 40})
        self.client.post("/api/cameras/CAM001/resolution", json={"resolution": "4K"})
        self.assertEqual(cam.zoom_level, 40)

    def test_set_fps_success(self):
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "3": {"name": "Frames Per Second", "available_options": {"6": "50", "8": "30"}}
        })
        resp = self.client.post("/api/cameras/CAM001/fps", json={"fps": "50"})
        self.assertEqual(resp.status_code, 200)

    def test_set_lens_success(self):
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "121": {"name": "Lens", "available_options": {"4": "Linear", "0": "Wide"}}
        })
        resp = self.client.post("/api/cameras/CAM001/lens", json={"lens": "Linear"})
        self.assertEqual(resp.status_code, 200)

    def test_set_generic_setting_success(self):
        cam = self._connect_fake("CAM001")
        _write_reference(self.pm, cam.model, cam.firmware, {
            "83": {"name": "GPS", "available_options": {"0": "Off", "1": "On"}}
        })
        resp = self.client.post("/api/cameras/CAM001/setting", json={"setting_id": 83, "display_name": "Off"})
        self.assertEqual(resp.status_code, 200)

    # ── resolution/all, fps/all, settings/global ─────────────────────────

    def test_resolution_all_mixed_results(self):
        cam1 = self._connect_fake("CAM001")
        cam2 = self._connect_fake("CAM002", set_setting_status=403, set_setting_json={"supported_options": []})
        for cam in (cam1, cam2):
            _write_reference(self.pm, cam.model, cam.firmware, {
                "2": {"name": "Video Resolution", "available_options": {"1": "4K"}}
            })
        resp = self.client.post("/api/cameras/resolution/all", json={"resolution": "4K"})
        self.assertEqual(resp.status_code, 200)
        results = resp.json()["results"]
        self.assertEqual(results["CAM001"]["status"], "success")
        self.assertEqual(results["CAM002"]["status"], "error")

    def test_settings_global_applies_to_all_connected(self):
        self._connect_fake("CAM001")
        self._connect_fake("CAM002")
        resp = self.client.post("/api/cameras/settings/global", json={"resolution": 1, "fps": 8})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["results"]["CAM001"], "success")

    # ── zoom ─────────────────────────────────────────────────────────────

    def test_get_zoom(self):
        self._connect_fake("CAM001", zoom_level=25)
        resp = self.client.get("/api/cameras/CAM001/zoom")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["zoom"], 25)

    def test_set_zoom_success(self):
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/zoom", json={"percent": 60})
        self.assertEqual(resp.status_code, 200)
        profile = self.pm.load_camera_profile("CAM001")
        self.assertEqual(profile["current_zoom"], 60)

    def test_set_zoom_out_of_range_returns_422(self):
        """percent is bounded in ZoomRequest itself (Field(ge=0, le=100)), so an
        out of range value is rejected by Pydantic before the route body runs.
        cameras.py's own except ValueError handling in set_zoom is unreachable
        for this case, it'd only fire if GPcam.setDigitalZoom were ever called
        with something outside 0..100 despite the schema, which can't happen
        through this endpoint as written."""
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/zoom", json={"percent": 150})
        self.assertEqual(resp.status_code, 422)

    def test_zoom_in_steps_and_saves(self):
        self._connect_fake("CAM001", zoom_level=10)
        resp = self.client.post("/api/cameras/CAM001/zoom/in", json={"step": 5})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["zoom"], 15)
        self.assertEqual(self.pm.load_camera_profile("CAM001")["current_zoom"], 15)

    def test_zoom_out_steps_and_saves(self):
        self._connect_fake("CAM001", zoom_level=10)
        resp = self.client.post("/api/cameras/CAM001/zoom/out", json={"step": 5})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["zoom"], 5)

    # ── mode ─────────────────────────────────────────────────────────────

    def test_set_mode_video(self):
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/mode", json={"mode": "video"})
        self.assertEqual(resp.status_code, 200)

    def test_set_mode_invalid_returns_400(self):
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/mode", json={"mode": "bogus"})
        self.assertEqual(resp.status_code, 400)

    def test_set_mode_camera_rejects_returns_502(self):
        self._connect_fake("CAM001", mode_status=500)
        resp = self.client.post("/api/cameras/CAM001/mode", json={"mode": "photo"})
        self.assertEqual(resp.status_code, 502)

    # ── sync-time ────────────────────────────────────────────────────────

    def test_sync_time_success(self):
        self._connect_fake("CAM001")
        resp = self.client.post("/api/cameras/CAM001/sync-time")
        self.assertEqual(resp.status_code, 200)

    def test_sync_time_failure_returns_502(self):
        self._connect_fake("CAM001", sync_time_status=500)
        resp = self.client.post("/api/cameras/CAM001/sync-time")
        self.assertEqual(resp.status_code, 502)


if __name__ == "__main__":
    unittest.main()