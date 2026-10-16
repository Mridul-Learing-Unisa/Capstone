# Pydantic request/response models shared across routers (config updates, project/session creation, subject data).

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal, Optional, List



class ConfigUpdate(BaseModel):
    data_root: Optional[str] = None
    gopro_serial_numbers: Optional[List[str]] = None
    last_project: Optional[str] = None
    last_session: Optional[str] = None
    last_calibration: Optional[str] = None


class SelectionUpdate(BaseModel):
    project: Optional[str] = None
    session: Optional[str] = None
    subject_id: Optional[str] = None


# Names are trimmed like the tkinter dialogs do (name.strip()); a padded name would
# otherwise create a folder Windows can't reopen ("  x  " -> "  x").
class ProjectCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str


class SessionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str


class TrialUpdate(BaseModel):
    subject_id: Optional[str] = None
    calibration_file: Optional[str] = None
    cameras_used: Optional[List[str]] = None
    synced: Optional[bool] = None
    processed: Optional[bool] = None


class SubjectData(BaseModel):
    """Same rules as the tkinter New Participant dialog: ID and initials required,
    whole-number age, numeric height/mass, sex M/F/Other."""
    model_config = ConfigDict(str_strip_whitespace=True)
    subject_id: str = Field(min_length=1)
    initials: str = Field(min_length=1)
    age: int = Field(ge=0, le=120)
    sex: Literal["M", "F", "Other"]
    height_m: float = Field(gt=0, le=3)
    mass_kg: float = Field(gt=0, le=500)
    notes: str = ""


class SubjectUpdate(BaseModel):
    """Partial edit of an existing subject; omitted fields are left unchanged."""
    model_config = ConfigDict(str_strip_whitespace=True)
    initials: Optional[str] = Field(default=None, min_length=1)
    age: Optional[int] = Field(default=None, ge=0, le=120)
    sex: Optional[Literal["M", "F", "Other"]] = None
    height_m: Optional[float] = Field(default=None, gt=0, le=3)
    mass_kg: Optional[float] = Field(default=None, gt=0, le=500)
    notes: Optional[str] = None


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


class CalibRecordRequest(BaseModel):
    """Extrinsic / origin recording. cameras_used omitted = every connected camera (as in the tkinter tab)."""
    cameras_used: Optional[List[str]] = None


class IntrinsicCalibrateRequest(BaseModel):
    """video_path omitted = the video just recorded for this camera. Give a path to use an existing video (tkinter "Browse")."""
    video_path: Optional[str] = None


class CalibrationLoadRequest(BaseModel):
    name: str   # file stem from GET /api/calibration/files


# Recording Tab schemas
class RecordingStartRequest(BaseModel):
    trial_name: str = Field(min_length=1)
    cameras_used: List[str] = Field(min_length=1)
    sound_source_position: List[float] = Field(
        min_length=3,
        max_length=3,
    )

