# App entrypoint. Builds the FastAPI app, sets up CORS, initializes shared
# state (config + ProjectManager), and registers every router.

import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Add code/ directory to path so sibling modules (go2kin.py, project_manager.py) import cleanly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.deps import init_app_state
from api.routers import config, projects

app = FastAPI(title="Go2Kin API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_app_state(app)

app.include_router(config.router)
app.include_router(projects.router)
# app.include_router(calibration.router)   # add as each tab's endpoints are ready
# app.include_router(recording.router)
# app.include_router(processing.router)
# app.include_router(live_preview.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)