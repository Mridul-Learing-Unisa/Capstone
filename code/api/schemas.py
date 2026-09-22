# Pydantic request/response models shared across routers (config updates, project/session creation, subject data).

from pydantic import BaseModel, Field
from typing import Optional, List


class ConfigUpdate(BaseModel):
    data_root: Optional[str] = None
    gopro_serial_numbers: Optional[List[str]] = None
    last_project: Optional[str] = None
    last_session: Optional[str] = None
    last_calibration: Optional[str] = None


class ProjectCreate(BaseModel):
    name: str


class SessionCreate(BaseModel):
    name: str


class SubjectData(BaseModel):
    subject_id: str
    initials: str
    age: int
    sex: str
    height_m: float
    mass_kg: float
    notes: str = ""


class GlobalSettings(BaseModel):
    resolution: int
    fps: int


class ResolutionRequest(BaseModel):
    resolution: str  # display name, e.g. "4K", "1080"


class FPSRequest(BaseModel):
    fps: str  # display name, e.g. "50", "100"


class LensRequest(BaseModel):
    lens: str  # display name, e.g. "Linear", "Wide"


class SettingRequest(BaseModel):
    setting_id: int
    display_name: str


class ZoomRequest(BaseModel):
    percent: int = Field(ge=0, le=100)


class ZoomStepRequest(BaseModel):
    step: int = 5


class ModeRequest(BaseModel):
    mode: str  # "video" | "photo" | "timelapse"


class CharucoConfig(BaseModel):
    columns: int
    rows: int
    square_size_cm: float
    aruco_scale: float
    dict_name: str
    inverted: bool


class CalibExtrinsicData(BaseModel):
    cameras_used: List[str]
    sound_source: Optional[List[float]] = [0.0, 0.0, 0.0]