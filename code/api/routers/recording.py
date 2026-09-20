from fastapi import APIRouter, HTTPException, Depends

router = APIRouter(prefix="/api/recording", tags=["recording"])

@router.post("/start")
def start_recording():
    return {"message": "Recording started"}