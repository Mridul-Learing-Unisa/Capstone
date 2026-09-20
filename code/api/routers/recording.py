from fastapi import APIRouter, HTTPException

from api.deps import (
    connected_cameras,
    recording_start_info,
)
from api.schemas import RecordingStartRequest

router = APIRouter(prefix="/api/recording", tags=["recording"])

@router.post("/start")
def start_recording(recording_data_request: RecordingStartRequest, connected_cameras=connected_cameras, recording_start_info=recording_start_info):
    if recording_start_info["cameras_used"]:
        raise HTTPException(
            status_code=409,
            detail="A recording is already active.",
        )
    
    # Check that all cameras to be used are currently connected.
    for serial in recording_data_request.cameras_used:
        if serial not in connected_cameras:
            raise HTTPException(
                status_code=400,
                detail=f"Camera {serial} is not connected.",
            )

    # Update the recording start information with the new recording session details.
    recording_start_info["cameras_used"] = recording_data_request.cameras_used
    recording_start_info["trial_name"] = recording_data_request.trial_name
    recording_start_info["sound_source_position"] = recording_data_request.sound_source_position

    return {"message": "Recording started"}