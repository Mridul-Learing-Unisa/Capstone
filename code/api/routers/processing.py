# Pose2Sim processing endpoints, mirroring the tkinter ProcessingTab: run the pipeline on the
# chosen trials one after another, report which step is running plus the log output, and allow
# cancelling. The work happens in api/processing_job.py (one subprocess per trial); clients
# poll GET /status the way they poll the recording job.

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_processing_job, get_project_manager
from api.processing_job import ProcessingBusy, resolve_trial_paths
from api.schemas import ProcessingStartRequest


router = APIRouter(prefix="/api/processing", tags=["processing"])


@router.post("/start", status_code=202)
def start_processing(
    data: ProcessingStartRequest,
    project_manager=Depends(get_project_manager),
    job=Depends(get_processing_job),
):
    """Start the pipeline on every trial in trial_paths (processed in the order given).
    A trial that fails (or can't be prepared: no calibration, subject, synced videos...) doesn't
    stop the others; see per-trial status in GET /status."""
    # Bad paths reject the whole request, so nothing runs on a half-understood batch.
    trials, errors = resolve_trial_paths(project_manager.data_root, data.trial_paths)
    if errors:
        raise HTTPException(status_code=400, detail={"message": "Invalid trial_paths.", "invalid": errors})

    try:
        run_id = job.start(project_manager, trials)
    except ProcessingBusy:
        raise HTTPException(status_code=409, detail="Processing is already running.")

    return {
        "message": "Processing started",
        "run_id": run_id,
        "trials": [{"name": t.name, "session": t.session, "path": str(t.path)} for t in trials],
    }


@router.post("/stop")
def stop_processing(job=Depends(get_processing_job)):
    """Kill the running pipeline and cancel the trials still queued. Returns immediately; the
    run reports state "cancelled" in GET /status once the process is gone. Repeating the call
    while it is stopping is harmless."""
    if not job.stop():
        raise HTTPException(status_code=409, detail="No processing run is active.")
    return {"message": "Stop requested", "state": "stopping"}


@router.get("/status")
def get_processing_status(
    since: Optional[int] = Query(None, ge=0, description="next_since from the previous poll; only newer log lines are returned"),
    job=Depends(get_processing_job),
):
    """Current state of the run:
    state: idle / running / stopping / complete / failed (a trial failed or was skipped) / cancelled
    current_trial / current_step: what is running now (null when nothing is)
    steps: status of each Pose2Sim step (pending / processing / complete / failed / cancelled)
    trials: per-trial status (pending / processing / complete / failed / skipped / cancelled) + error
    logs: log lines after `since`; pass next_since back as `since` on the next poll."""
    return job.snapshot(since)