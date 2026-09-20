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
    
    # Remove duplicate serial numbers
    selected_cameras = list(
        dict.fromkeys(recording_data_request.cameras_used)
    )
    
    # Check that all cameras to be used are currently connected
    for camera_serial in selected_cameras:
        if camera_serial not in connected_cameras:
            raise HTTPException(
                status_code=400,
                detail=f"Camera {camera_serial} is not connected.",
            )

    # Update the recording start information with the new recording session details
    recording_start_info["cameras_used"] = []
    recording_start_info["trial_name"] = recording_data_request.trial_name
    recording_start_info["sound_source_position"] = recording_data_request.sound_source_position
    
    # Remove duplicate camera serial numbers while preserving order
    for camera_serial in selected_cameras:
        # Retrieve the camera object for the current serial number
        camera = connected_cameras[camera_serial]
        
        # Add the camera serial number to the list of cameras used in the current recording session
        recording_start_info["cameras_used"].append(camera_serial)
    
        try:
            # Start the recording on the current camera.
            response = camera.shutterStart()
            response.raise_for_status()
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to start recording: {str(e)}",
            )

    return {
        "message": "Recording started",
        "trial_name": recording_start_info["trial_name"],
        "cameras_used": recording_start_info["cameras_used"],
        "sound_source_position": recording_start_info["sound_source_position"],
    }