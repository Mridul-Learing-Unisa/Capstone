# Pydantic request/response models shared across routers (config updates, project/session creation, subject data).

from pydantic import BaseModel
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