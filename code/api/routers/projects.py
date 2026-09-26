# Endpoints for managing projects, sessions, trials, and subjects, backed by ProjectManager.

from fastapi import APIRouter, Depends, HTTPException

from project_manager import ProjectManager
from api.deps import get_project_manager, get_selection_state
from api.schemas import ProjectCreate, SessionCreate, SubjectData, SelectionUpdate, TrialUpdate

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project}/sessions")
def create_session(project: str, data: SessionCreate, pm: ProjectManager = Depends(get_project_manager)):
    try:
        pm.create_session(project, data.name)
        return {"status": "success", "session": data.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{project}/sessions/{session}/trials")
def list_trials(project: str, session: str, pm: ProjectManager = Depends(get_project_manager)):
    try:
        trials = pm.list_trials(project, session)
        trial_details = [pm.get_trial(project, session, t) for t in trials]
        return {"trials": trial_details}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project}/subjects")
def list_subjects(project: str, pm: ProjectManager = Depends(get_project_manager)):
    try:
        return {"subjects": pm.list_subjects(project)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project}/subjects")
def create_or_update_subject(project: str, data: SubjectData, pm: ProjectManager = Depends(get_project_manager)):
    try:
        subjects = pm.list_subjects(project)
        exists = any(s["subject_id"] == data.subject_id for s in subjects)
        if exists:
            pm.update_subject(
                project, data.subject_id,
                initials=data.initials, age=data.age, sex=data.sex,
                height_m=data.height_m, mass_kg=data.mass_kg, notes=data.notes,
            )
        else:
            pm.create_subject(
                project, data.subject_id, data.initials, data.age,
                data.sex, data.height_m, data.mass_kg, data.notes,
            )
        return {"status": "success", "subject_id": data.subject_id}
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
        pm.update_trial(project, session, trial_name, **data.dict(exclude_unset=True))
        return {"status": "success", "trial": pm.get_trial(project, session, trial_name)}
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Calibration freshness, for the top bar's status indicator
# ---------------------------------------------------------------------------

@router.get("/{project}/calibration/freshness")
def get_calibration_freshness(project: str, pm: ProjectManager = Depends(get_project_manager)):
    try:
        latest = pm.get_latest_calibration(project)
        if latest is None:
            return {"status": "none", "calibration": None, "age_days": None}
        age_days = pm.get_calibration_age_days(project, latest)
        return {
            "status": "green" if age_days < 1 else "red",
            "calibration": latest,
            "age_days": age_days,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Current selection (project / session / subject), for the top bar
# ---------------------------------------------------------------------------

@router.get("/selection")
def get_selection(selection: dict = Depends(get_selection_state)):
    return selection


@router.post("/selection")
def set_selection(
    data: SelectionUpdate,
    pm: ProjectManager = Depends(get_project_manager),
    selection: dict = Depends(get_selection_state),
):
    if data.project is not None:
        try:
            pm.get_project_path(data.project)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        selection["project"] = data.project
        # session and subject are both scoped to the project, so a project
        # change invalidates whatever was previously selected for either
        selection["session"] = None
        selection["subject_id"] = None

    if data.session is not None:
        if not selection.get("project"):
            raise HTTPException(status_code=400, detail="Select a project before a session")
        try:
            pm.get_session_path(selection["project"], data.session)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        selection["session"] = data.session

    if data.subject_id is not None:
        if not selection.get("project"):
            raise HTTPException(status_code=400, detail="Select a project before a subject")
        try:
            subjects = pm.list_subjects(selection["project"])
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        if not any(s["subject_id"] == data.subject_id for s in subjects):
            raise HTTPException(status_code=404, detail=f"Subject not found {data.subject_id}")
        selection["subject_id"] = data.subject_id

    return selection
