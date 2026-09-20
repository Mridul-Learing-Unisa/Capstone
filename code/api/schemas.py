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
    

# Recording Tab schemas
class RecordingStartRequest(BaseModel):
    trial_name: str = Field(min_length=1)
    cameras_used: List[str] = Field(min_length=1)
    sound_source_position: List[float] = Field(
        min_length=3,
        max_length=3,
    )

