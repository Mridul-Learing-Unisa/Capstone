# Endpoints for managing projects, sessions, trials, and subjects, backed by ProjectManager.

from fastapi import APIRouter, Depends, HTTPException

from project_manager import ProjectManager
from api.deps import get_project_manager
from api.schemas import ProjectCreate, SessionCreate, SubjectData

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