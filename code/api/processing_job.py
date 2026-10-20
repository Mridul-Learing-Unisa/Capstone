# State + worker for the Processing API (routers/processing.py is the thin HTTP layer on top).
#
# One ProcessingJob lives on app.state for the whole server run. start() spawns a background
# thread that processes the requested trials one after another, each in its own subprocess.
# The child invokes the Pose2Sim submodule directly. The thread reads stdout, turns marker lines
# into step progress and everything else into log lines. stop() kills the running subprocess tree.
# Plain Python only (no FastAPI) so it can be tested without the web stack.

import argparse
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import traceback
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

logger = logging.getLogger(__name__)

CODE_DIR = Path(__file__).resolve().parent.parent
if str(CODE_DIR) not in sys.path:
    sys.path.insert(0, str(CODE_DIR))

WORKER_SCRIPT = Path(__file__).resolve()
MARKER = "__GO2KIN_PROGRESS__"
EXIT_OK = 0
EXIT_FAILED = 1
EXIT_BUILD_FAILED = 2
PIPELINE_STEPS = [
    "Calibration",
    "Pose Estimation",
    "Person Association",
    "Triangulation",
    "Filtering",
    "Kinematics",
]
MAX_LOG_LINES = 5000     # oldest lines are dropped beyond this (tqdm bars can be very chatty)
ACTIVE_STATES = ("running", "stopping")


class ProcessingBusy(Exception):
    """A run is already in progress."""


@dataclass(frozen=True)
class TrialRef:
    path: Path       # resolved trial folder
    project: str
    session: str
    name: str


# ---------------------------------------------------------------------------
# Turning the request's trial_paths into validated trials
# ---------------------------------------------------------------------------

def resolve_trial_paths(data_root, raw_paths):
    """Validate trial folder paths. Each may be absolute or relative to data_root and must be
    <data_root>/<project>/sessions/<session>/<trial> containing a trial.json.

    Returns (trials, errors): errors is a list of {"path", "reason"}. Duplicates are dropped,
    order is kept.
    """
    root = Path(data_root).resolve()
    trials, errors, seen = [], [], set()
    for raw in raw_paths:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = root / candidate
        resolved = candidate.resolve()   # also collapses any ".." so it can't escape data_root

        try:
            parts = resolved.relative_to(root).parts
        except ValueError:
            errors.append({"path": raw, "reason": "Path is outside the data root."})
            continue
        if len(parts) != 4 or parts[1] != "sessions":
            errors.append({"path": raw, "reason": "Expected <project>/sessions/<session>/<trial>."})
            continue
        if not (resolved / "trial.json").is_file():
            errors.append({"path": raw, "reason": "Trial not found (no trial.json)."})
            continue

        if resolved in seen:
            continue
        seen.add(resolved)
        trials.append(TrialRef(resolved, project=parts[0], session=parts[2], name=parts[3]))
    return trials, errors


# ---------------------------------------------------------------------------
# Process helpers
# ---------------------------------------------------------------------------

def _popen_platform_kwargs() -> dict:
    # Own process group / session so the whole tree (Pose2Sim spawns workers and ffmpeg) can be killed.
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def kill_process_tree(proc: subprocess.Popen) -> None:
    """Hard-kill the process and everything it started. Safe to call on an exited process."""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True, check=False)
        else:
            os.killpg(proc.pid, signal.SIGKILL)   # session leader: pgid == pid
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


class ProcessingJob:
    def __init__(self):
        self._lock = threading.RLock()
        self._thread = None
        self._proc = None
        self._stop_event = threading.Event()
        self._logs = deque(maxlen=MAX_LOG_LINES)
        self._log_total = 0        # lines ever logged this run; lets clients poll with a cursor
        self._reset("idle")

    def _reset(self, state):
        self._state = state        # idle | running | stopping | complete | failed | cancelled
        self._run_id = None
        self._started_at = None
        self._finished_at = None
        self._trials = []
        self._current = None       # index into _trials while a trial is being processed
        self._steps = [{"name": n, "status": "pending"} for n in PIPELINE_STEPS]

    # ------------------------------------------------------------------ logging

    def _log(self, line: str) -> None:
        with self._lock:
            self._logs.append(line)
            self._log_total += 1

    # ------------------------------------------------------------------ public API

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    def start(self, pm, trials) -> str:
        """Begin processing `trials` (list of TrialRef). Raises ProcessingBusy if already running."""
        with self._lock:
            if self._state in ACTIVE_STATES:
                raise ProcessingBusy("Processing is already running.")
            self._reset("running")
            self._run_id = uuid4().hex
            self._started_at = time.time()
            self._stop_event = threading.Event()
            self._logs.clear()
            self._log_total = 0
            self._trials = [
                {"path": str(t.path), "session": t.session, "name": t.name,
                 "status": "pending", "error": None}
                for t in trials
            ]
            self._thread = threading.Thread(
                target=self._run, args=(pm, list(trials), self._stop_event), daemon=True)
            self._thread.start()
            return self._run_id

    def stop(self) -> bool:
        """Kill the running pipeline and cancel the trials still queued.
        Returns False if nothing is running. Repeated calls while stopping are harmless."""
        with self._lock:
            if self._state not in ACTIVE_STATES:
                # A repeat that arrives after the stopped run has already wound down is still fine.
                return self._state == "cancelled" and self._stop_event.is_set()
            already = self._stop_event.is_set()
            self._stop_event.set()
            self._state = "stopping"
            proc = self._proc
        if not already:
            self._log("Stop requested: terminating the pipeline")
        if proc is not None:
            kill_process_tree(proc)
        return True

    def shutdown(self, timeout: float = 5.0) -> None:
        """Server is exiting: don't leave an orphaned GPU job behind."""
        if self.stop() and self._thread is not None:
            self._thread.join(timeout)

    def snapshot(self, since=None) -> dict:
        """Everything a client needs for one poll. `since` is the `next_since` of the previous
        poll; only log lines after it are returned (None = all lines still buffered)."""
        with self._lock:
            first_buffered = self._log_total - len(self._logs)
            start = first_buffered if since is None else max(since, first_buffered)
            logs = list(self._logs)[start - first_buffered:]
            dropped = since is not None and since < first_buffered

            trial = self._trials[self._current] if self._current is not None else None
            step = next((i for i, s in enumerate(self._steps) if s["status"] == "processing"), None)
            counts = {}
            for t in self._trials:
                counts[t["status"]] = counts.get(t["status"], 0) + 1

            return {
                "state": self._state,
                "run_id": self._run_id,
                "started_at": self._started_at,       # unix seconds
                "finished_at": self._finished_at,
                "current_trial": None if trial is None else {
                    "index": self._current, "total": len(self._trials),
                    "name": trial["name"], "path": trial["path"],
                },
                "current_step": None if step is None else {
                    "index": step, "name": self._steps[step]["name"],
                },
                # Steps of the trial being processed (or the most recent one once finished).
                "steps": [dict(s) for s in self._steps],
                "trials": [dict(t) for t in self._trials],
                "summary": {k: counts.get(k, 0) for k in
                            ("pending", "processing", "complete", "failed", "skipped", "cancelled")},
                "logs": logs,
                "next_since": self._log_total,
                "logs_dropped": dropped,
            }

    # ------------------------------------------------------------------ worker thread

    def _run(self, pm, trials, stop_event) -> None:
        total = len(trials)
        try:
            self._log(f"Starting processing of {total} trial(s)")
            for i, ref in enumerate(trials):
                if stop_event.is_set():
                    break
                self._log("=" * 50)
                self._log(f"[{i + 1}/{total}] {ref.session}/{ref.name}")
                with self._lock:
                    self._current = i
                    self._trials[i]["status"] = "processing"
                    self._steps = [{"name": n, "status": "pending"} for n in PIPELINE_STEPS]

                try:
                    status, error = self._run_trial(pm, ref, stop_event)
                except Exception as e:   # e.g. Python could not be launched
                    logger.exception("Processing %s failed", ref.name)
                    self._log(f"ERROR: {e}")
                    status, error = "failed", str(e)

                if status == "complete":
                    try:
                        pm.update_trial(ref.project, ref.session, ref.name, processed=True)
                    except Exception as e:
                        self._log(f"Warning: could not update trial.json: {e}")
                with self._lock:
                    self._trials[i]["status"] = status
                    self._trials[i]["error"] = error
                self._log(f"{ref.name}: {status}" + (f" ({error})" if error else ""))
        finally:
            with self._lock:
                for t in self._trials:
                    if t["status"] in ("pending", "processing"):
                        t["status"] = "cancelled" if stop_event.is_set() else "failed"
                        if not stop_event.is_set():
                            t["error"] = "Run ended unexpectedly."
                statuses = [t["status"] for t in self._trials]
                if "cancelled" in statuses:
                    self._state = "cancelled"
                elif "failed" in statuses or "skipped" in statuses:
                    self._state = "failed"
                else:
                    self._state = "complete"
                self._current = None
                self._proc = None
                self._finished_at = time.time()
            ok = statuses.count("complete")
            self._log("=" * 50)
            self._log(f"Finished ({self._state}): {ok}/{total} trial(s) successful")

    def _command(self, pm, ref: TrialRef) -> list:
        return [sys.executable, "-u", str(WORKER_SCRIPT),
                "--data-root", str(pm.data_root),
                "--project", ref.project, "--session", ref.session, "--trial", ref.name]

    def _run_trial(self, pm, ref: TrialRef, stop_event):
        """Run one trial's subprocess to the end. Returns (status, error) where status is one of
        complete / failed / skipped / cancelled."""
        env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
        with self._lock:
            # Checked under the lock so a stop() can't slip in between the check and the spawn.
            if stop_event.is_set():
                return "cancelled", None
            proc = subprocess.Popen(
                self._command(pm, ref), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                bufsize=1, env=env, **_popen_platform_kwargs())
            self._proc = proc

        last_error = None
        try:
            for raw in proc.stdout:
                line = raw.rstrip("\r\n")
                at = line.find(MARKER)
                if at == -1:
                    self._log(line)
                    continue
                if line[:at].strip():
                    self._log(line[:at])     # progress-bar text that shares the line
                try:
                    event = json.loads(line[at + len(MARKER):])
                except ValueError:
                    self._log(line)
                    continue
                if event.get("event") == "step":
                    self._set_step(event.get("index"), event.get("status"))
                elif event.get("event") == "error":
                    last_error = event.get("message")
            returncode = proc.wait()
        finally:
            with self._lock:
                self._proc = None
            proc.stdout.close()

        if returncode == EXIT_OK:
            return "complete", None
        if stop_event.is_set():
            self._finish_running_step("cancelled")
            return "cancelled", None
        self._finish_running_step("failed")   # a crash mid-step never reported its own failure
        if returncode == EXIT_BUILD_FAILED:
            return "skipped", last_error or "Trial could not be prepared."
        return "failed", last_error or f"Pipeline exited with code {returncode}."

    def _set_step(self, index, status) -> None:
        with self._lock:
            if isinstance(index, int) and 0 <= index < len(self._steps):
                self._steps[index]["status"] = status

    def _finish_running_step(self, status) -> None:
        with self._lock:
            for s in self._steps:
                if s["status"] == "processing":
                    s["status"] = status


def _emit_progress(event: str, **values) -> None:
    print(MARKER + json.dumps({"event": event, **values}), flush=True)


def _run_pose2sim_trial(data_root: str, project: str, session: str, trial_name: str) -> int:
    """Prepare one Go2Kin trial and invoke Pose2Sim's public pipeline functions."""
    from pose2sim_builder import build_pose2sim_project
    from project_manager import ProjectManager

    pm = ProjectManager(data_root)
    try:
        processed_path = build_pose2sim_project(pm, project, session, trial_name)
    except Exception as exc:
        traceback.print_exc()
        _emit_progress("error", message=str(exc))
        return EXIT_BUILD_FAILED

    original_cwd = Path.cwd()
    try:
        os.chdir(processed_path)
        pose2sim_path = CODE_DIR / "pose2sim"
        if str(pose2sim_path) not in sys.path:
            sys.path.insert(0, str(pose2sim_path))

        from Pose2Sim import Pose2Sim as P2S

        steps = [
            P2S.calibration,
            P2S.poseEstimation,
            P2S.personAssociation,
            P2S.triangulation,
            P2S.filtering,
            P2S.kinematics,
        ]
        for index, (name, step) in enumerate(zip(PIPELINE_STEPS, steps)):
            _emit_progress("step", index=index, status="processing")
            print(f"--- Starting {name} ---", flush=True)
            try:
                step()
            except Exception as exc:
                traceback.print_exc()
                _emit_progress("step", index=index, status="failed")
                _emit_progress("error", message=f"{name} failed: {exc}")
                return EXIT_FAILED
            _emit_progress("step", index=index, status="complete")

        return EXIT_OK
    except Exception as exc:
        traceback.print_exc()
        _emit_progress("error", message=str(exc))
        return EXIT_FAILED
    finally:
        os.chdir(original_cwd)


def _run_child() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--trial", required=True)
    args = parser.parse_args()
    return _run_pose2sim_trial(args.data_root, args.project, args.session, args.trial)


if __name__ == "__main__":
    raise SystemExit(_run_child())
