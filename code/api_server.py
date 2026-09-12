import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

# Add code directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from go2kin import load_app_config, save_app_config
from project_manager import ProjectManager

app = FastAPI(title="Go2Kin API")

# Configure CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
app_config = load_app_config()
if not app_config.get("data_root") or not Path(app_config["data_root"]).is_dir():
    # Use a default fallback or temporary directory if not configured
    app_config["data_root"] = str(Path(__file__).resolve().parent.parent / "output")
    Path(app_config["data_root"]).mkdir(parents=True, exist_ok=True)
pm = ProjectManager(app_config["data_root"])

class ConfigUpdate(BaseModel):
    data_root: Optional[str] = None
    gopro_serial_numbers: Optional[List[str]] = None
    last_project: Optional[str] = None
    last_session: Optional[str] = None
    last_calibration: Optional[str] = None

@app.get("/api/config")
def get_config():
    return load_app_config()

@app.post("/api/config")
def update_config(config_update: ConfigUpdate):
    global app_config, pm
    current_config = load_app_config()
    if config_update.data_root is not None:
        current_config["data_root"] = config_update.data_root
        pm = ProjectManager(config_update.data_root)
    if config_update.gopro_serial_numbers is not None:
        current_config["gopro_serial_numbers"] = config_update.gopro_serial_numbers
    if config_update.last_project is not None:
        current_config["last_project"] = config_update.last_project
    if config_update.last_session is not None:
        current_config["last_session"] = config_update.last_session
    if config_update.last_calibration is not None:
        current_config["last_calibration"] = config_update.last_calibration
        
    save_app_config(current_config)
    app_config = current_config
    return {"status": "success", "config": current_config}

class ProjectCreate(BaseModel):
    name: str

@app.get("/api/projects")
def list_projects():
    try:
        return {"projects": pm.list_projects()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects")
def create_project(data: ProjectCreate):
    try:
        pm.create_project(data.name)
        return {"status": "success", "project": data.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class SessionCreate(BaseModel):
    name: str

@app.get("/api/projects/{project}/sessions")
def list_sessions(project: str):
    try:
        return {"sessions": pm.list_sessions(project)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects/{project}/sessions")
def create_session(project: str, data: SessionCreate):
    try:
        pm.create_session(project, data.name)
        return {"status": "success", "session": data.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/{project}/sessions/{session}/trials")
def list_trials(project: str, session: str):
    try:
        trials = pm.list_trials(project, session)
        trial_details = []
        for trial_name in trials:
            trial_details.append(pm.get_trial(project, session, trial_name))
        return {"trials": trial_details}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SubjectData(BaseModel):
    subject_id: str
    initials: str
    age: int
    sex: str
    height_m: float
    mass_kg: float
    notes: str = ""

@app.get("/api/projects/{project}/subjects")
def list_subjects(project: str):
    try:
        return {"subjects": pm.list_subjects(project)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects/{project}/subjects")
def create_or_update_subject(project: str, data: SubjectData):
    try:
        # Check if exists to determine create vs update
        subjects = pm.list_subjects(project)
        exists = any(s["subject_id"] == data.subject_id for s in subjects)
        if exists:
            pm.update_subject(project, data.subject_id, initials=data.initials, age=data.age, sex=data.sex, height_m=data.height_m, mass_kg=data.mass_kg, notes=data.notes)
        else:
            pm.create_subject(project, data.subject_id, data.initials, data.age, data.sex, data.height_m, data.mass_kg, data.notes)
        return {"status": "success", "subject_id": data.subject_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
