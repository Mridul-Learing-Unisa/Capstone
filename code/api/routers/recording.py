from fastapi import APIRouter, HTTPException

from api.deps import (
    connected_cameras,
    recording_start_info,
)
from api.schemas import RecordingStart

router = APIRouter(prefix="/api/recording", tags=["recording"])

@router.post("/start")
def start_recording(recording_data: RecordingStart, connected_cameras=connected_cameras, recording_start_info=recording_start_info):
    if recording_start_info["cameras_used"]:
        raise HTTPException(
            status_code=409,
            detail="A recording is already active.",
        )

    return {"message": "Recording started"}