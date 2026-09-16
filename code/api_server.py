import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import json
import datetime
import time
import threading
import concurrent.futures

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

# ==========================================
# Calibration
# ==========================================

from calibration.data_types import CameraArray
from calibration.charuco import Charuco

CALIBRATION_DIR = Path(app_config["data_root"]).parent / "config" / "calibration"
CHARUCO_CONFIG_PATH = CALIBRATION_DIR / "charuco_config.json"

calibration_state = {
    "status": "idle", # idle, recording, downloading, processing, complete, error
    "message": "",
    "intrinsic_results": {}, # serial -> dict
    "bundle": None, # Extrinsic bundle
    "camera_array": None, # Camera array (extrinsic)
    "recording_info": None,
    "charuco": None
}

class CharucoConfig(BaseModel):
    columns: int
    rows: int
    square_size_cm: float
    aruco_scale: float
    dict_name: str
    inverted: bool

@app.get("/api/calibration/charuco")
def get_charuco():
    if CHARUCO_CONFIG_PATH.exists():
        with open(CHARUCO_CONFIG_PATH, "r") as f:
            return json.load(f)
    return {}

@app.post("/api/calibration/charuco")
def set_charuco(config: CharucoConfig):
    CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHARUCO_CONFIG_PATH, "w") as f:
        json.dump(config.dict(), f, indent=4)
    return {"status": "success"}

def load_charuco():
    if not CHARUCO_CONFIG_PATH.exists():
        raise Exception("Charuco config not found")
    with open(CHARUCO_CONFIG_PATH, "r") as f:
        data = json.load(f)
    return Charuco(
        columns=data.get("columns", 5),
        rows=data.get("rows", 7),
        square_size=data.get("square_size_cm", 11.70) / 100.0,
        aruco_scale=data.get("aruco_scale", 0.75),
        dict_name=data.get("dict_name", "DICT_4X4_50"),
        inverted=data.get("inverted", False)
    )

@app.post("/api/calibration/intrinsic/{serial}/record/start")
def start_intrinsic_record(serial: str):
    global calibration_state
    if calibration_state["status"] not in ["idle", "complete", "error"]:
        raise HTTPException(status_code=400, detail="Busy")
    if serial not in connected_cameras:
        raise HTTPException(status_code=400, detail="Camera not connected")
    
    video_dir = Path(pm.data_root) / "temp_calibration"
    video_dir.mkdir(exist_ok=True, parents=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    calibration_state["recording_info"] = {
        "type": "intrinsic",
        "serial": serial,
        "video_dir": str(video_dir),
        "timestamp": timestamp
    }
    
    connected_cameras[serial].shutterStart()
    calibration_state["status"] = "recording"
    calibration_state["message"] = f"Recording intrinsic for {serial}"
    return {"status": "success"}

def process_intrinsic(info):
    global calibration_state
    try:
        serial = info["serial"]
        video_dir = Path(info["video_dir"])
        timestamp = info["timestamp"]
        
        calibration_state["status"] = "downloading"
        calibration_state["message"] = "Downloading intrinsic video..."
        
        cam = connected_cameras[serial]
        cam.shutterStop()
        while cam.camBusy() or cam.encodingActive():
            time.sleep(0.5)
            
        fname = video_dir / f"intrinsic_{timestamp}_{serial}.mp4"
        cam.mediaDownloadLast(str(fname))
        cam.deleteAllFiles()
        
        calibration_state["status"] = "processing"
        calibration_state["message"] = "Running intrinsic calibration..."
        
        from calibration.calibrate import run_intrinsic_calibration_from_video
        charuco = load_charuco()
        
        # Resolve to 1-indexed cam_num based on loaded config
        serials = app_config.get("gopro_serial_numbers", [])
        cam_num = serials.index(serial) + 1 if serial in serials else 1
            
        output = run_intrinsic_calibration_from_video(str(fname), cam_num, charuco)
        calibration_state["intrinsic_results"][serial] = {
            "cam_num": cam_num,
            "camera": output.camera,
            "rmse": output.report.rmse
        }
        
        calibration_state["status"] = "complete"
        calibration_state["message"] = f"Intrinsic complete. RMSE: {output.report.rmse:.3f}"
    except Exception as e:
        calibration_state["status"] = "error"
        calibration_state["message"] = str(e)

@app.post("/api/calibration/intrinsic/{serial}/record/stop")
def stop_intrinsic_record(serial: str):
    global calibration_state
    if calibration_state["status"] != "recording" or calibration_state["recording_info"]["serial"] != serial:
        raise HTTPException(status_code=400, detail="Not recording for this camera")
        
    info = calibration_state["recording_info"]
    threading.Thread(target=process_intrinsic, args=(info,), daemon=True).start()
    return {"status": "processing"}

class CalibExtrinsicData(BaseModel):
    cameras_used: List[str]
    sound_source: Optional[List[float]] = [0.0, 0.0, 0.0]

@app.post("/api/calibration/extrinsic/record/start")
def start_extrinsic_record(data: CalibExtrinsicData):
    global calibration_state
    if calibration_state["status"] not in ["idle", "complete", "error"]:
        raise HTTPException(status_code=400, detail="Busy")
        
    video_dir = Path(pm.data_root) / "temp_calibration"
    video_dir.mkdir(exist_ok=True, parents=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    calibration_state["recording_info"] = {
        "type": "extrinsic",
        "cameras": data.cameras_used,
        "sound_pos": data.sound_source,
        "video_dir": str(video_dir),
        "timestamp": timestamp
    }
    
    for serial in data.cameras_used:
        if serial in connected_cameras:
            connected_cameras[serial].shutterStart()
            
    calibration_state["status"] = "recording"
    calibration_state["message"] = "Recording extrinsic"
    return {"status": "success"}

def process_extrinsic(info):
    global calibration_state
    try:
        video_dir = Path(info["video_dir"])
        timestamp = info["timestamp"]
        
        calibration_state["status"] = "downloading"
        calibration_state["message"] = "Downloading extrinsic videos..."
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for serial in info["cameras"]:
                if serial in connected_cameras:
                    cam = connected_cameras[serial]
                    cam.shutterStop()
                    def dl(c, s):
                        while c.camBusy() or c.encodingActive():
                            time.sleep(0.5)
                        fname = video_dir / f"extrinsic_{timestamp}_{s}.mp4"
                        c.mediaDownloadLast(str(fname))
                        c.deleteAllFiles()
                    futures.append(executor.submit(dl, cam, serial))
            concurrent.futures.wait(futures)
            
        calibration_state["status"] = "processing"
        calibration_state["message"] = "Syncing and computing extrinsics..."
        
        from audio_sync import compute_sync_offsets, trim_and_sync_videos, evaluate_sync_acceptance
        from calibration.calibrate import run_extrinsic_calibration
        
        video_paths = [str(f) for f in video_dir.glob(f"extrinsic_{timestamp}_*.mp4")]
        if len(video_paths) < 2:
            raise Exception("Not enough videos downloaded")
            
        offsets = compute_sync_offsets(video_paths, str(video_dir), sound_source_position=info["sound_pos"])
        acceptable, _ = evaluate_sync_acceptance(offsets)
        if not acceptable:
            raise Exception("Audio sync rejected")
            
        out_files = trim_and_sync_videos(video_paths, offsets, str(video_dir))
        
        cameras = {}
        for serial, res in calibration_state["intrinsic_results"].items():
            if serial in info["cameras"]:
                cameras[res["cam_num"]] = res["camera"]
                
        camera_array = CameraArray(cameras=cameras)
        charuco = load_charuco()
        
        bundle = run_extrinsic_calibration(video_dir, charuco, camera_array)
        
        calibration_state["bundle"] = bundle
        calibration_state["camera_array"] = bundle.camera_array
        calibration_state["status"] = "complete"
        calibration_state["message"] = "Extrinsic calibration complete"
        
    except Exception as e:
        calibration_state["status"] = "error"
        calibration_state["message"] = str(e)

@app.post("/api/calibration/extrinsic/record/stop")
def stop_extrinsic_record():
    global calibration_state
    if calibration_state["status"] != "recording" or calibration_state["recording_info"]["type"] != "extrinsic":
        raise HTTPException(status_code=400, detail="Not recording extrinsic")
        
    info = calibration_state["recording_info"]
    threading.Thread(target=process_extrinsic, args=(info,), daemon=True).start()
    return {"status": "processing"}

@app.post("/api/calibration/origin/record/start")
def start_origin_record(data: CalibExtrinsicData):
    global calibration_state
    if calibration_state["status"] not in ["idle", "complete", "error"]:
        raise HTTPException(status_code=400, detail="Busy")
        
    video_dir = Path(pm.data_root) / "temp_calibration"
    video_dir.mkdir(exist_ok=True, parents=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    calibration_state["recording_info"] = {
        "type": "origin",
        "cameras": data.cameras_used,
        "sound_pos": data.sound_source,
        "video_dir": str(video_dir),
        "timestamp": timestamp
    }
    
    for serial in data.cameras_used:
        if serial in connected_cameras:
            connected_cameras[serial].shutterStart()
            
    calibration_state["status"] = "recording"
    calibration_state["message"] = "Recording origin"
    return {"status": "success"}

def process_origin(info):
    global calibration_state
    try:
        video_dir = Path(info["video_dir"])
        timestamp = info["timestamp"]
        
        calibration_state["status"] = "downloading"
        calibration_state["message"] = "Downloading origin videos..."
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for serial in info["cameras"]:
                if serial in connected_cameras:
                    cam = connected_cameras[serial]
                    cam.shutterStop()
                    def dl(c, s):
                        while c.camBusy() or c.encodingActive():
                            time.sleep(0.5)
                        fname = video_dir / f"origin_{timestamp}_{s}.mp4"
                        c.mediaDownloadLast(str(fname))
                        c.deleteAllFiles()
                    futures.append(executor.submit(dl, cam, serial))
            concurrent.futures.wait(futures)
            
        calibration_state["status"] = "processing"
        calibration_state["message"] = "Syncing and computing origin..."
        
        from audio_sync import compute_sync_offsets, trim_and_sync_videos, evaluate_sync_acceptance
        from calibration.calibrate import set_origin, compute_origin_transform
        from calibration.alignment import apply_similarity_transform
        
        video_paths = [str(f) for f in video_dir.glob(f"origin_{timestamp}_*.mp4")]
        if len(video_paths) < 2:
            raise Exception("Not enough videos downloaded")
            
        offsets = compute_sync_offsets(video_paths, str(video_dir), sound_source_position=info["sound_pos"])
        acceptable, _ = evaluate_sync_acceptance(offsets)
        if not acceptable:
            raise Exception("Audio sync rejected")
            
        out_files = trim_and_sync_videos(video_paths, offsets, str(video_dir))
        charuco = load_charuco()
        
        if calibration_state["bundle"] is not None:
            aligned_bundle = set_origin(video_dir, charuco, calibration_state["camera_array"], calibration_state["bundle"])
            calibration_state["bundle"] = aligned_bundle
            calibration_state["camera_array"] = aligned_bundle.camera_array
        else:
            transform = compute_origin_transform(video_dir, charuco, calibration_state["camera_array"])
            new_camera_array, _ = apply_similarity_transform(calibration_state["camera_array"], None, transform)
            calibration_state["camera_array"] = new_camera_array
            
        calibration_state["status"] = "complete"
        calibration_state["message"] = "Origin set successfully"
        
    except Exception as e:
        calibration_state["status"] = "error"
        calibration_state["message"] = str(e)

@app.post("/api/calibration/origin/record/stop")
def stop_origin_record():
    global calibration_state
    if calibration_state["status"] != "recording" or calibration_state["recording_info"]["type"] != "origin":
        raise HTTPException(status_code=400, detail="Not recording origin")
        
    info = calibration_state["recording_info"]
    threading.Thread(target=process_origin, args=(info,), daemon=True).start()
    return {"status": "processing"}

@app.get("/api/calibration/status")
def get_calibration_status():
    return {
        "status": calibration_state["status"],
        "message": calibration_state["message"],
        "intrinsic_count": len(calibration_state["intrinsic_results"]),
        "has_extrinsics": calibration_state["camera_array"] is not None
    }

@app.post("/api/calibration/apply")
def apply_calibration():
    if calibration_state["camera_array"] is None:
        raise HTTPException(status_code=400, detail="No extrinsic calibration to apply")
        
    from calibration.persistence import save_calibration
    calib_dir = Path(pm.data_root) / "calibration"
    calib_dir.mkdir(exist_ok=True)
    today = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M")
    filepath = calib_dir / f"calibration_{today}.json"
    
    charuco = load_charuco()
    save_calibration(filepath, calibration_state["camera_array"], charuco)
    
    app_config["last_calibration"] = str(filepath)
    save_app_config(app_config)
    
    return {"status": "success", "filepath": str(filepath)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
