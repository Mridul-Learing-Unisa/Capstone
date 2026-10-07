"""Tests for the projects API endpoints (code/api/routers/projects.py)."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "code"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "code" / "goproUSB"))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from project_manager import ProjectManager
import api.routers.projects as projects_router
from api.deps import get_project_manager, get_selection_state


class TestProjectsAPI(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pm = ProjectManager(self.temp_dir.name)
        self.selection = {"project": None, "session": None, "subject_id": None}

        app = FastAPI()
        app.include_router(projects_router.router)
        app.dependency_overrides[get_project_manager] = lambda: self.pm
        app.dependency_overrides[get_selection_state] = lambda: self.selection

        self.client = TestClient(app)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _subject_payload(self, subject_id="P01", **overrides):
        payload = {
            "subject_id": subject_id, "initials": "JD", "age": 25,
            "sex": "M", "height_m": 1.78, "mass_kg": 75.0, "notes": "",
        }
        payload.update(overrides)
        return payload

    def _full_calib(self):
        return {
            "cameras": {
                "1": {
                    "size": [3840, 2160], "rotation_count": 0, "error": 1.0,
                    "fisheye": False, "matrix": [[2000, 0, 1920], [0, 2000, 1080], [0, 0, 1]],
                    "distortions": [0.01, -0.05, 0, 0, 0.05],
                    "rotation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                    "translation": [0, 0, 5], "grid_count": 20,
                },
            },
        }

    # ── Projects ─────────────────────────────────────────────────────────

    def test_list_projects_empty(self):
        resp = self.client.get("/api/projects")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["projects"], [])

    def test_create_and_list_project(self):
        resp = self.client.post("/api/projects", json={"name": "demo"})
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get("/api/projects")
        self.assertEqual(resp.json()["projects"], ["demo"])

    def test_create_duplicate_project_returns_400(self):
        self.client.post("/api/projects", json={"name": "demo"})
        resp = self.client.post("/api/projects", json={"name": "demo"})
        self.assertEqual(resp.status_code, 400)

    def test_create_project_invalid_name_returns_400(self):
        resp = self.client.post("/api/projects", json={"name": "bad/name"})
        self.assertEqual(resp.status_code, 400)

    # ── Sessions ─────────────────────────────────────────────────────────

    def test_list_sessions_missing_project_returns_404(self):
        """Regression test for the 500 -> 404 fix."""
        resp = self.client.get("/api/projects/ghost/sessions")
        self.assertEqual(resp.status_code, 404)

    def test_create_and_list_sessions(self):
        self.pm.create_project("demo")
        resp = self.client.post("/api/projects/demo/sessions", json={"name": "sess_a"})
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get("/api/projects/demo/sessions")
        self.assertEqual(resp.json()["sessions"], ["sess_a"])

    def test_create_session_missing_project_returns_404(self):
        """Regression test, was 400 before the fix, a missing project is a
        different failure than a bad or duplicate session name."""
        resp = self.client.post("/api/projects/ghost/sessions", json={"name": "sess_a"})
        self.assertEqual(resp.status_code, 404)

    def test_create_duplicate_session_returns_400(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        resp = self.client.post("/api/projects/demo/sessions", json={"name": "sess_a"})
        self.assertEqual(resp.status_code, 400)

    # ── Trials (list, update, delete) ──────────────────────────────────

    def test_list_trials_missing_project_returns_404(self):
        resp = self.client.get("/api/projects/ghost/sessions/sess_a/trials")
        self.assertEqual(resp.status_code, 404)

    def test_list_trials_missing_session_returns_404(self):
        self.pm.create_project("demo")
        resp = self.client.get("/api/projects/demo/sessions/ghost/trials")
        self.assertEqual(resp.status_code, 404)

    def test_list_trials_returns_full_detail(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        self.pm.create_trial("demo", "sess_a", "t1", "P01", "none", ["cam1"])
        resp = self.client.get("/api/projects/demo/sessions/sess_a/trials")
        self.assertEqual(resp.status_code, 200)
        trials = resp.json()["trials"]
        self.assertEqual(len(trials), 1)
        self.assertEqual(trials[0]["trial_name"], "t1")
        self.assertEqual(trials[0]["subject_id"], "P01")

    def test_update_trial_partial_update_preserves_other_fields(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        self.pm.create_trial("demo", "sess_a", "t1", "P01", "cal1", ["cam1"])

        resp = self.client.patch("/api/projects/demo/sessions/sess_a/trials/t1", json={"synced": True})
        self.assertEqual(resp.status_code, 200)
        trial = resp.json()["trial"]
        self.assertTrue(trial["synced"])
        self.assertFalse(trial["processed"])  # untouched
        self.assertEqual(trial["subject_id"], "P01")  # untouched

    def test_update_trial_missing_returns_404(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        resp = self.client.patch("/api/projects/demo/sessions/sess_a/trials/ghost", json={"synced": True})
        self.assertEqual(resp.status_code, 404)

    def test_delete_trial_removes_it(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        self.pm.create_trial("demo", "sess_a", "t1", "P01", "none", ["cam1"])
        resp = self.client.delete("/api/projects/demo/sessions/sess_a/trials/t1")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.pm.list_trials("demo", "sess_a"), [])

    def test_delete_trial_missing_returns_404(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        resp = self.client.delete("/api/projects/demo/sessions/sess_a/trials/ghost")
        self.assertEqual(resp.status_code, 404)

    # ── Subjects ─────────────────────────────────────────────────────────

    def test_list_subjects_missing_project_returns_404(self):
        resp = self.client.get("/api/projects/ghost/subjects")
        self.assertEqual(resp.status_code, 404)

    def test_create_subject_success(self):
        self.pm.create_project("demo")
        resp = self.client.post("/api/projects/demo/subjects", json=self._subject_payload())
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get("/api/projects/demo/subjects")
        ids = [s["subject_id"] for s in resp.json()["subjects"]]
        self.assertIn("P01", ids)

    def test_create_subject_missing_project_returns_404(self):
        resp = self.client.post("/api/projects/ghost/subjects", json=self._subject_payload())
        self.assertEqual(resp.status_code, 404)

    def test_post_subject_twice_updates_instead_of_erroring(self):
        """create_or_update_subject is an upsert, a second POST for the same
        subject_id should update, not raise a duplicate error."""
        self.pm.create_project("demo")
        self.client.post("/api/projects/demo/subjects", json=self._subject_payload(age=25))
        resp = self.client.post("/api/projects/demo/subjects", json=self._subject_payload(age=26))
        self.assertEqual(resp.status_code, 200)
        data = self.pm.get_subject("demo", "P01")
        self.assertEqual(data["age"], 26)

    # ── Project tree ─────────────────────────────────────────────────────

    def test_project_tree_missing_project_returns_404(self):
        """Regression test for the 500 -> 404 fix."""
        resp = self.client.get("/api/projects/ghost/tree")
        self.assertEqual(resp.status_code, 404)

    def test_project_tree_structure(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        self.pm.create_trial("demo", "sess_a", "t1", "P01", "none", ["cam1"])
        resp = self.client.get("/api/projects/demo/tree")
        self.assertEqual(resp.status_code, 200)
        tree = resp.json()
        self.assertEqual(tree["project"], "demo")
        self.assertEqual(tree["sessions"]["sess_a"]["trials"], ["t1"])

    # ── Calibration freshness ────────────────────────────────────────────

    def test_calibration_freshness_missing_project_returns_404(self):
        """Regression test for the 500 -> 404 fix."""
        resp = self.client.get("/api/projects/ghost/calibration/freshness")
        self.assertEqual(resp.status_code, 404)

    def test_calibration_freshness_none(self):
        self.pm.create_project("demo")
        resp = self.client.get("/api/projects/demo/calibration/freshness")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "none")

    def test_calibration_freshness_green_when_recent(self):
        self.pm.create_project("demo")
        self.pm.save_calibration("demo", "today", self._full_calib())
        resp = self.client.get("/api/projects/demo/calibration/freshness")
        self.assertEqual(resp.json()["status"], "green")

    def test_calibration_freshness_red_when_old(self):
        self.pm.create_project("demo")
        self.pm.save_calibration("demo", "old", self._full_calib())
        old_path = self.pm.get_calibration_path("demo", "old")
        os.utime(old_path, (0, 0))  # epoch, guaranteed more than a day old
        resp = self.client.get("/api/projects/demo/calibration/freshness")
        self.assertEqual(resp.json()["status"], "red")

    # ── Selection ────────────────────────────────────────────────────────

    def test_get_selection_initial(self):
        resp = self.client.get("/api/projects/selection")
        self.assertEqual(resp.json(), {"project": None, "session": None, "subject_id": None})

    def test_set_selection_project(self):
        self.pm.create_project("demo")
        resp = self.client.post("/api/projects/selection", json={"project": "demo"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["project"], "demo")

    def test_set_selection_unknown_project_returns_404(self):
        resp = self.client.post("/api/projects/selection", json={"project": "ghost"})
        self.assertEqual(resp.status_code, 404)

    def test_set_selection_session_without_project_returns_400(self):
        resp = self.client.post("/api/projects/selection", json={"session": "sess_a"})
        self.assertEqual(resp.status_code, 400)

    def test_set_selection_session_success(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        self.client.post("/api/projects/selection", json={"project": "demo"})
        resp = self.client.post("/api/projects/selection", json={"session": "sess_a"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["session"], "sess_a")

    def test_set_selection_unknown_session_returns_404(self):
        self.pm.create_project("demo")
        self.client.post("/api/projects/selection", json={"project": "demo"})
        resp = self.client.post("/api/projects/selection", json={"session": "ghost"})
        self.assertEqual(resp.status_code, 404)

    def test_set_selection_subject_without_project_returns_400(self):
        resp = self.client.post("/api/projects/selection", json={"subject_id": "P01"})
        self.assertEqual(resp.status_code, 400)

    def test_set_selection_subject_success(self):
        self.pm.create_project("demo")
        self.pm.create_subject("demo", "P01", "JD", 25, "M", 1.78, 75.0)
        self.client.post("/api/projects/selection", json={"project": "demo"})
        resp = self.client.post("/api/projects/selection", json={"subject_id": "P01"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["subject_id"], "P01")

    def test_set_selection_unknown_subject_returns_404(self):
        self.pm.create_project("demo")
        self.client.post("/api/projects/selection", json={"project": "demo"})
        resp = self.client.post("/api/projects/selection", json={"subject_id": "ghost"})
        self.assertEqual(resp.status_code, 404)

    def test_set_selection_changing_project_clears_session_and_subject(self):
        self.pm.create_project("demo")
        self.pm.create_session("demo", "sess_a")
        self.pm.create_subject("demo", "P01", "JD", 25, "M", 1.78, 75.0)
        self.pm.create_project("other")

        self.client.post("/api/projects/selection", json={"project": "demo"})
        self.client.post("/api/projects/selection", json={"session": "sess_a"})
        self.client.post("/api/projects/selection", json={"subject_id": "P01"})

        resp = self.client.post("/api/projects/selection", json={"project": "other"})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["project"], "other")
        self.assertIsNone(body["session"])
        self.assertIsNone(body["subject_id"])


if __name__ == "__main__":
    unittest.main()