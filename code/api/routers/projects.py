# Endpoints for managing projects, sessions, trials, and subjects, backed by ProjectManager.
# Mirrors the tkinter TopBar: the selection is saved to go2kin_config.json
# (last_project / last_session / last_participant) and restored at startup (deps.init_app_state).

from fastapi import APIRouter, Depends, HTTPException

from go2kin import save_app_config
from project_manager import ProjectManager
from api.deps import get_app_config, get_project_manager, get_selection_state
from api.schemas import ProjectCreate, SessionCreate, SubjectData, SubjectUpdate, SelectionUpdate, TrialUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def list_projects(pm: ProjectManager = Depends(get_project_manager)):
    try:
        return {"projects": pm.list_projects()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
def create_project(data: ProjectCreate, pm: ProjectManager = Depends(get_project_manager)):
    try:
        pm.create_project(data.name)
        return {"status": "success", "project": data.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{project}/sessions")
def list_sessions(project: str, pm: ProjectManager = Depends(get_project_manager)):
    try:
        return {"sessions": pm.list_sessions(project)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project}/sessions")
def create_session(project: str, data: SessionCreate, pm: ProjectManager = Depends(get_project_manager)):
    try:
        pm.create_session(project, data.name)
        return {"status": "success", "session": data.name}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{project}/sessions/{session}/trials")
def list_trials(project: str, session: str, pm: ProjectManager = Depends(get_project_manager)):
    try:
        trials = pm.list_trials(project, session)
        trial_details = [pm.get_trial(project, session, t) for t in trials]
        return {"trials": trial_details}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project}/subjects")
def list_subjects(project: str, pm: ProjectManager = Depends(get_project_manager)):
    try:
        return {"subjects": pm.list_subjects(project)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _subject_exists(pm: ProjectManager, project: str, subject_id: str) -> bool:
    return any(s["subject_id"] == subject_id for s in pm.list_subjects(project))


@router.post("/{project}/subjects")
def create_subject(project: str, data: SubjectData, pm: ProjectManager = Depends(get_project_manager)):
    """Create a new subject. An existing ID is refused (as in tkinter); edit it with PUT instead."""
    try:
        if _subject_exists(pm, project, data.subject_id):
            raise HTTPException(status_code=409, detail=f"Subject already exists: {data.subject_id}")
        pm.create_subject(
            project, data.subject_id, data.initials, data.age,
            data.sex, data.height_m, data.mass_kg, data.notes,
        )
        return {"status": "success", "subject_id": data.subject_id}
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{project}/subjects/{subject_id}")
def update_subject(project: str, subject_id: str, data: SubjectUpdate, pm: ProjectManager = Depends(get_project_manager)):
    """Edit an existing subject's details (the ID itself can't change, trials reference it)."""
    try:
        pm.update_subject(project, subject_id, **data.model_dump(exclude_none=True))
        return {"status": "success", "subject": pm.get_subject(project, subject_id)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Trial update / delete, ProjectManager already has both, just wasn't exposed
# ---------------------------------------------------------------------------

@router.patch("/{project}/sessions/{session}/trials/{trial_name}")
def update_trial(
    project: str,
    session: str,
    trial_name: str,
    data: TrialUpdate,
    pm: ProjectManager = Depends(get_project_manager),
):
    try:
        if data.subject_id and not _subject_exists(pm, project, data.subject_id):
            raise HTTPException(status_code=404, detail=f"Subject not found: {data.subject_id}")
        pm.update_trial(project, session, trial_name, **data.model_dump(exclude_unset=True))
        return {"status": "success", "trial": pm.get_trial(project, session, trial_name)}
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{project}/sessions/{session}/trials/{trial_name}")
def delete_trial(
    project: str,
    session: str,
    trial_name: str,
    pm: ProjectManager = Depends(get_project_manager),
):
    try:
        pm.delete_trial(project, session, trial_name)
        return {"status": "success"}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Project tree, for the top bar's file explorer view
# ---------------------------------------------------------------------------

@router.get("/{project}/tree")
def get_project_tree(project: str, pm: ProjectManager = Depends(get_project_manager)):
    """Full project -> sessions -> trials structure in one call.

    Sessions/trials only, subjects are a flat per-project list (see
    /subjects above) and aren't nested here since a trial only references
    a subject_id, it doesn't live under one.
    """
    try:
        return pm.get_project_tree(project)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Calibration freshness, for the top bar's status indicator
# ---------------------------------------------------------------------------

@router.get("/{project}/calibration/freshness")
def get_calibration_freshness(project: str, pm: ProjectManager = Depends(get_project_manager)):
    """Same colours as the tkinter top bar: red = no calibration, green = today, orange = older."""
    try:
        latest = pm.get_latest_calibration(project)
        if latest is None:
            return {"status": "red", "calibration": None, "age_days": None, "label": "none"}
        age_days = pm.get_calibration_age_days(project, latest)
        # Strip the timestamp suffix for display ("initial_2026-03-25-14-00" -> "initial"), as tkinter does.
        display = latest.rsplit("_", 1)[0] if "_" in latest else latest
        return {
            "status": "green" if age_days < 1 else "orange",
            "calibration": latest,
            "age_days": age_days,
            "label": f"{display} — {'today' if age_days < 1 else f'{age_days}d ago'}",
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Current selection (project / session / subject), for the top bar
# ---------------------------------------------------------------------------

@router.get("/selection")
def get_selection(selection: dict = Depends(get_selection_state)):
    return selection


def _save_selection(selection: dict, app_config: dict) -> None:
    """Persist the selection like the tkinter TopBar, so it survives a restart."""
    app_config["last_project"] = selection["project"] or ""
    app_config["last_session"] = selection["session"] or ""
    app_config["last_participant"] = selection["subject_id"] or ""
    save_app_config(app_config)


@router.post("/selection")
def set_selection(
    data: SelectionUpdate,
    pm: ProjectManager = Depends(get_project_manager),
    selection: dict = Depends(get_selection_state),
    app_config: dict = Depends(get_app_config),
):
    """Validate everything first, then apply and save, so a failed request changes nothing."""
    new = dict(selection)

    if data.project is not None:
        try:
            pm.get_project_path(data.project)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        # session and subject are both scoped to the project, so a project
        # change invalidates whatever was previously selected for either
        new.update(project=data.project, session=None, subject_id=None)

    if data.session is not None:
        if not new["project"]:
            raise HTTPException(status_code=400, detail="Select a project before a session")
        try:
            pm.get_session_path(new["project"], data.session)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        new["session"] = data.session

    if data.subject_id is not None:
        if not new["project"]:
            raise HTTPException(status_code=400, detail="Select a project before a subject")
        try:
            if not _subject_exists(pm, new["project"], data.subject_id):
                raise HTTPException(status_code=404, detail=f"Subject not found: {data.subject_id}")
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        new["subject_id"] = data.subject_id

    selection.update(new)
    _save_selection(selection, app_config)
    return selection
