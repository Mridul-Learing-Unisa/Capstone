import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

# Add code directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / 'goproUSB'))
from go2kin import load_app_config, save_app_config
from project_manager import ProjectManager
from goproUSB import GPcam
from camera_profiles import get_profile_manager

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
profile_manager = get_profile_manager()
connected_cameras = {} # Mapping of serial_number -> GPcam instance

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

# ==========================================
# Camera Control
# ==========================================

@app.get("/api/cameras")
def list_cameras():
    serials = app_config.get("gopro_serial_numbers", [])
    result = []
    for s in serials:
        status = "disconnected"
        batt = None
        if s in connected_cameras:
            try:
                state = connected_cameras[s].getState()
                if state.status_code == 200:
                    status = "connected"
                    batt = state.json().get("status", {}).get("70", None) # 70 is internal battery %
                else:
                    status = "error"
            except Exception:
                status = "error"
        result.append({"serial": s, "status": status, "battery": batt})
    return {"cameras": result}

@app.post("/api/cameras/{serial}/connect")
def connect_camera(serial: str):
    cam = GPcam(serial)
    try:
        # Test connection
        res = cam.getCameraInfo()
        if res.status_code == 200:
            connected_cameras[serial] = cam
            cam.USBenable()
            
            # Optional: update profile
            try:
                state_res = cam.getState()
                if state_res.status_code == 200:
                    cam_info = res.json()
                    state_json = state_res.json()
                    # We might need reference to properly create profile, but we'll try without
                    model = cam_info.get('model_name', '')
                    firmware = cam_info.get('firmware_version', '')
                    reference = profile_manager.load_settings_reference(model, firmware)
                    if reference:
                        profile_manager.create_or_update_profile(cam_info, state_json, reference)
            except Exception as e:
                print(f"Warning: Failed to update camera profile for {serial}: {e}")
                
            return {"status": "success"}
        else:
            raise HTTPException(status_code=400, detail="Failed to connect, camera returned error")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cameras/{serial}/disconnect")
def disconnect_camera(serial: str):
    if serial in connected_cameras:
        try:
            connected_cameras[serial].USBdisable()
        except:
            pass
        del connected_cameras[serial]
    return {"status": "success"}

class GlobalSettings(BaseModel):
    resolution: int
    fps: int

@app.post("/api/cameras/settings/global")
def set_global_settings(settings: GlobalSettings):
    results = {}
    for s, cam in connected_cameras.items():
        try:
            cam.setSetting(2, settings.resolution)
            cam.setSetting(3, settings.fps)
            results[s] = "success"
        except Exception as e:
            results[s] = str(e)
    return {"status": "complete", "results": results}

@app.get("/api/cameras/{serial}/settings")
def get_camera_settings(serial: str):
    profile = profile_manager.load_camera_profile(serial)
    if profile:
        return {"status": "success", "profile": profile}
    raise HTTPException(status_code=404, detail="Camera profile not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
