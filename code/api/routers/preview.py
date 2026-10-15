# Live preview endpoints. Each camera streams UDP on its own port; a background
# thread reads it with OpenCV (as LivePreviewCapture does in the tkinter app) and
# the latest frame is served to the browser as MJPEG, so React can use a plain <img>.

import threading
import time

import cv2
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from api.deps import get_app_config, get_connected_cameras, get_preview_sessions, get_profile_manager_dep

router = APIRouter(prefix="/api/preview", tags=["preview"])

BASE_PORT = 8554          # camera N (index in gopro_serial_numbers) streams on BASE_PORT + N
MAX_WIDTH = 1280          # frames are downscaled to this width before JPEG encoding
JPEG_QUALITY = 80
KEEP_ALIVE_S = 30


class PreviewSession:
    """One camera's running preview: UDP capture thread + latest JPEG frame."""

    def __init__(self, serial: str, port: int, cam):
        self.serial = serial
        self.port = port
        self.cam = cam
        self.cap = None
        self.running = False
        self.thread = None
        self.latest_jpeg = None
        self.frame_id = 0
        self.cond = threading.Condition()

    def open_capture(self) -> bool:
        stream_url = f"udp://0.0.0.0:{self.port}"
        self.cap = cv2.VideoCapture()
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok = self.cap.open(stream_url + "?overrun_nonfatal=1&fifo_size=1000000&fflags=nobuffer&flags=low_delay", cv2.CAP_FFMPEG)
        if not ok:
            ok = self.cap.open(stream_url + "?overrun_nonfatal=1&fifo_size=50000000", cv2.CAP_FFMPEG)
        if not ok:
            self.cap.release()
            self.cap = None
        return ok

    def start_thread(self) -> None:
        self.running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self) -> None:
        last_keep_alive = time.time()
        while self.running and self.cap is not None and self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.001)
                continue

            h, w = frame.shape[:2]
            if w > MAX_WIDTH:
                frame = cv2.resize(frame, (MAX_WIDTH, int(h * MAX_WIDTH / w)), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if ok:
                with self.cond:
                    self.latest_jpeg = buf.tobytes()
                    self.frame_id += 1
                    self.cond.notify_all()

            if time.time() - last_keep_alive > KEEP_ALIVE_S:
                last_keep_alive = time.time()
                try:
                    self.cam.keepAlive()
                except Exception:
                    pass  # non-critical, next interval retries

    def stop(self) -> None:
        self.running = False
        if self.thread:
            self.thread.join(timeout=1.0)
        if self.cap:
            self.cap.release()
            self.cap = None
        try:
            self.cam.streamStop()
        except Exception as e:
            print(f"Error stopping camera stream for {self.serial}: {e}")
        with self.cond:
            self.cond.notify_all()   # wake any MJPEG generators so they exit


def stop_session(serial: str, sessions: dict) -> None:
    """Stop and forget a camera's preview if one is running (used by /stop and /disconnect)."""
    session = sessions.pop(serial, None)
    if session is not None:
        session.stop()


def _port_for(serial: str, app_config: dict) -> int:
    serials = app_config.get("gopro_serial_numbers", [])
    if serial not in serials:
        raise HTTPException(status_code=404, detail=f"Unknown camera {serial}")
    return BASE_PORT + serials.index(serial)


@router.get("")
def preview_status(sessions: dict = Depends(get_preview_sessions)):
    """Which cameras currently have a preview running."""
    return {"previews": {s: {"active": True, "port": sess.port} for s, sess in sessions.items()}}


@router.post("/{serial}/start")
def start_preview(
    serial: str,
    app_config: dict = Depends(get_app_config),
    connected_cameras: dict = Depends(get_connected_cameras),
    sessions: dict = Depends(get_preview_sessions),
    profile_manager=Depends(get_profile_manager_dep),
):
    port = _port_for(serial, app_config)
    cam = connected_cameras.get(serial)
    if cam is None:
        raise HTTPException(status_code=404, detail=f"Camera {serial} is not connected")
    if serial in sessions:
        return {"status": "already_running", "serial": serial}

    session = PreviewSession(serial, port, cam)
    try:
        # Preview forces Linear / 1080p / 30fps (low bandwidth, intentional), same as the tkinter app.
        cam.modeVideo()
        cam.setVideoLensesLinear()
        cam.setVideoResolution1080()
        cam.setFPS30()

        # Reapply saved zoom after the settings above, which can reset it.
        profile = profile_manager.load_camera_profile(serial) or {}
        saved_zoom = profile.get("current_zoom", 0)
        if saved_zoom:
            cam.setDigitalZoom(saved_zoom)
            time.sleep(0.3)

        response = cam.streamStart(port=port)
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Camera refused to start stream (status {response.status_code})")

        time.sleep(2)   # let the stream initialise before opening the UDP socket
        if not session.open_capture():
            raise HTTPException(status_code=502, detail="Could not open the video stream")
    except HTTPException:
        session.stop()
        raise
    except Exception as e:
        session.stop()
        raise HTTPException(status_code=502, detail=f"Failed to start preview: {e}")

    session.start_thread()
    sessions[serial] = session
    return {"status": "started", "serial": serial, "port": port}


@router.post("/{serial}/stop")
def stop_preview(serial: str, sessions: dict = Depends(get_preview_sessions)):
    stop_session(serial, sessions)
    return {"status": "stopped", "serial": serial}


@router.get("/{serial}/stream")
def preview_stream(serial: str, sessions: dict = Depends(get_preview_sessions)):
    """MJPEG stream (multipart/x-mixed-replace). Use directly as <img src>. Ends when the preview is stopped."""
    session = sessions.get(serial)
    if session is None:
        raise HTTPException(status_code=404, detail="Preview not running for this camera")

    def frames():
        last_id = 0
        while session.running:
            with session.cond:
                session.cond.wait_for(lambda: session.frame_id != last_id or not session.running, timeout=2.0)
                if not session.running:
                    break
                if session.frame_id == last_id:
                    continue
                last_id = session.frame_id
                jpeg = session.latest_jpeg
            yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")
