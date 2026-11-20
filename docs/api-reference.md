# Go2Kin API reference

The React frontend uses the FastAPI service in [code/api](../code/api). This reference covers the application routes registered by [main.py](../code/api/main.py), including routes with no current React caller.

## Run locally

With the project's Python dependencies installed, run the following from the repository root:

```powershell
python -m uvicorn api.main:app --app-dir code --host 127.0.0.1 --port 8000
```

The frontend clients use `http://localhost:8000`. From `frontend/Go2Kin`, run `npm install` and `npm run dev` to start Vite. FastAPI serves interactive Swagger UI at `/docs`, ReDoc at `/redoc`, and the machine-readable schema at `/openapi.json`. For responses assembled as dictionaries, the tables below describe fields that may have limited detail in OpenAPI.

Send bodies as JSON with `Content-Type: application/json` and URL-encode path parameter values. Success defaults to HTTP 200 unless shown as 202. Responses are JSON except for the board PNG and preview stream. FastAPI errors use a `detail` field that can contain a string, an object, or a validation error array (422). Check per-camera results and background job status even when the HTTP request succeeds.

The API keeps selection, camera connections, preview sessions, calibration work, and job progress in shared server state. Use one backend process for a capture workflow. Selection and some settings are persisted in the application config, while in-progress jobs and their status are held in memory. The app registers permissive CORS and has no authentication layer.

## Configuration

[Backend router](../code/api/routers/config.py) · [Recording client](../frontend/Go2Kin/src/components/recording/recording-api.ts)

| Method | Path | Request | Response and behavior |
| --- | --- | --- | --- |
| GET | `/api/config` | — | Current application config object. |
| POST | `/api/config` | Optional fields `data_root`, `gopro_serial_numbers` (string array), `last_project`, `last_session`, `last_calibration` (strings). | `{status, config}`. Persists supplied non-null fields. Changing the data root requires an existing directory on the server and clears the current selection. |

## Projects, sessions, subjects, and trials

[Backend router](../code/api/routers/projects.py) · [React project client](../frontend/Go2Kin/src/components/projects/project-api.ts) · [React freshness hook](../frontend/Go2Kin/src/components/projects/calibration-freshness.ts)

| Method | Path | Request | Response and behavior |
| --- | --- | --- | --- |
| GET | `/api/projects` | — | `{projects}`, an array of project names. |
| POST | `/api/projects` | `{name: string}` | Creates a project and returns `{status, project}`. |
| GET | `/api/projects/{project}/sessions` | — | `{sessions}`, an array of session names. |
| POST | `/api/projects/{project}/sessions` | `{name: string}` | Creates a session and returns `{status, session}`. |
| GET | `/api/projects/{project}/sessions/{session}/trials` | — | `{trials}`, trial metadata records. |
| GET | `/api/projects/{project}/subjects` | — | `{subjects}`, subject records for the project. |
| POST | `/api/projects/{project}/subjects` | Subject fields below, including `subject_id`. | `{status, subject_id}`. Duplicate IDs return 409. |
| PUT | `/api/projects/{project}/subjects/{subject_id}` | Any subset of the editable subject fields below. | `{status, subject}`. The ID comes from the path. |
| PATCH | `/api/projects/{project}/sessions/{session}/trials/{trial_name}` | Optional `subject_id` and `calibration_file` strings, `cameras_used` string array, and `synced` and `processed` booleans. | `{status, trial}`. An assigned subject must exist in the project. |
| DELETE | `/api/projects/{project}/sessions/{session}/trials/{trial_name}` | — | `{status}`. Deletes the trial and its data. |
| GET | `/api/projects/{project}/tree` | — | Project hierarchy with sessions and trial metadata. |
| GET | `/api/projects/{project}/calibration/freshness` | — | `{status, calibration, age_days, age_seconds, label}`. Green means less than one day old, orange means older, and red means no calibration. With no calibration, the name and ages are null. |
| GET | `/api/projects/selection` | — | `{project, session, subject_id}`, with nullable values. |
| POST | `/api/projects/selection` | Optional strings `project`, `session`, `subject_id`. | Returns the persisted selection. Supplying a project resets the session and subject before applying any supplied replacements. Session and subject are scoped to the selected project. Null fields are ignored. |

Subject creation requires a non-empty `subject_id` and `initials`, integer `age` from 0 to 120, `sex` of `M`, `F`, or `Other`, `height_m` greater than 0 and at most 3, and `mass_kg` greater than 0 and at most 500. `notes` defaults to an empty string. Updates can omit all of these fields and take `subject_id` from the URL.

## Cameras

[Backend router](../code/api/routers/cameras.py) · [React camera client](../frontend/Go2Kin/src/components/cameras/cameras-api.ts)

The `serial` path parameter is the configured GoPro serial number. Hardware commands generally require a connected camera. Named setting writes resolve the display name using the camera's model and firmware reference, apply it to the camera, and update its stored profile. A successful named write returns `{status, setting_id, value, value_name}`, where `value` is the resolved option ID.

| Method | Path | Request | Response and behavior |
| --- | --- | --- | --- |
| GET | `/api/cameras` | — | `{cameras}`, rows with `serial`, `name`, `status` (`connected`, `disconnected`, or `error`), and nullable battery percentage `battery`. |
| POST | `/api/cameras/connect-all` | — | `{status, results}`, one result per configured serial. |
| POST | `/api/cameras/{serial}/connect` | — | `{status, warnings}`. Connects the camera and initializes its settings. |
| POST | `/api/cameras/{serial}/disconnect` | — | `{status}`. Stops its preview and releases the connection. |
| GET | `/api/cameras/{serial}/info` | — | GoPro camera information JSON. |
| GET | `/api/cameras/{serial}/state` | — | GoPro live status and settings JSON. |
| GET | `/api/cameras/{serial}/settings/reference` | — | Supported settings and options for the camera's model and firmware. |
| GET | `/api/cameras/{serial}/settings` | — | `{status, profile}`, the stored camera profile. Returns 404 if absent. |
| POST | `/api/cameras/{serial}/resolution` | `{resolution: string}`, e.g. `"1080"`. | Named setting result. |
| POST | `/api/cameras/{serial}/fps` | `{fps: string}`, e.g. `"50"`. | Named setting result. |
| POST | `/api/cameras/{serial}/lens` | `{lens: string}`, e.g. `"Linear"`. | Named setting result. |
| POST | `/api/cameras/{serial}/setting` | `{setting_id: integer, display_name: string}` | Named setting result for the supplied setting ID. |
| POST | `/api/cameras/settings/global` | `{resolution: integer, fps: integer}` | Sends raw GoPro option IDs to connected cameras and returns `{status, results}`. This route bypasses named-setting validation and profile writes. |
| POST | `/api/cameras/resolution/all` | `{resolution: string}` | `{status, results}`, named setting outcomes keyed by connected serial. |
| POST | `/api/cameras/fps/all` | `{fps: string}` | `{status, results}`, named setting outcomes keyed by connected serial. |
| GET | `/api/cameras/{serial}/zoom` | — | `{serial, zoom}`, current digital zoom. |
| POST | `/api/cameras/{serial}/zoom` | `{percent: integer}`, 0–100. | Sets and saves digital zoom, returning `{serial, zoom}`. |
| POST | `/api/cameras/{serial}/zoom/in` | `{step: integer}`, defaults to 5 if omitted from the required JSON object. | Increases and saves digital zoom, returning `{serial, zoom}`. |
| POST | `/api/cameras/{serial}/zoom/out` | `{step: integer}`, defaults to 5 if omitted from the required JSON object. | Decreases and saves digital zoom, returning `{serial, zoom}`. |
| POST | `/api/cameras/{serial}/mode` | `{mode: string}`, one of `video`, `photo`, `timelapse`. | `{serial, mode}`. |
| POST | `/api/cameras/{serial}/sync-time` | — | Sets the camera clock from the server and returns `{serial, status}`. |

## Live preview

[Backend router](../code/api/routers/preview.py) · [React camera client](../frontend/Go2Kin/src/components/cameras/cameras-api.ts)

Start the preview first, then use the stream URL as an HTML image source. The backend uses one UDP preview port (8554), so starting a different preview stops the previous one. While previewing, the server sets the camera to Linear at 1080p and 30 fps, and attempts to restore its saved settings when preview stops.

| Method | Path | Response and behavior |
| --- | --- | --- |
| GET | `/api/preview` | `{previews}`, a serial-keyed map of `{active, port}`. |
| POST | `/api/preview/{serial}/start` | Requires a configured, connected camera. Returns `{status, serial, port, stopped}` on start or `{status: "already_running", serial}` for the active camera. |
| POST | `/api/preview/{serial}/stop` | Stops the preview and returns `{status: "stopped", serial}`. |
| GET | `/api/preview/{serial}/stream` | MJPEG as `multipart/x-mixed-replace; boundary=frame`. Returns 404 when the preview is inactive. |

## Calibration

[Backend router](../code/api/routers/calibration.py) · [Scene router](../code/api/routers/calibration_scene.py) · [React calibration client](../frontend/Go2Kin/src/components/calibration/calibration-api.ts) · [React viewport](../frontend/Go2Kin/src/components/calibration/calibration-viewport.tsx)

For ChArUco requests, send integer `columns` and `rows`, numeric `square_size_cm` and `aruco_scale`, string `dict_name`, and boolean `inverted`. File and video operations use paths on the server. Calibration file loads take a file stem from the file list.

| Method | Path | Request | Response and behavior |
| --- | --- | --- | --- |
| GET | `/api/calibration/charuco` | — | Active ChArUco configuration. |
| POST | `/api/calibration/charuco` | ChArUco configuration. | Persists the board configuration and returns `{status, charuco}`. |
| GET | `/api/calibration/charuco/dictionaries` | — | `{dictionaries}`, supported dictionary names. |
| POST | `/api/calibration/charuco/board-image` | ChArUco configuration. | Renders an `image/png` from the supplied configuration. |
| GET | `/api/calibration/status` | — | State, stage, message, recording details, intrinsic summaries, extrinsic and origin results, sync issue, and flags `can_extrinsic`, `can_origin`, and `can_apply`. |
| GET | `/api/calibration/intrinsic` | — | `{cameras}`, rows with `serial`, `cam_num`, `name`, `calibrated`, `rmse`, `frames_used`, and `video`. |
| GET | `/api/calibration/intrinsic/{serial}/videos` | — | `{videos}`, existing intrinsic MP4s for the current project and camera, newest first. Entries contain `name`, `path`, and Unix modification time `modified`. |
| POST | `/api/calibration/intrinsic/{serial}/record/start` | — | Starts capture and returns `{status: "recording", serial, cam_num}`. |
| POST | `/api/calibration/intrinsic/{serial}/record/stop` | — | Begins the download and returns `{status: "downloading"}`. |
| POST | `/api/calibration/intrinsic/{serial}/calibrate` | Optional `{video_path: string}`. Defaults to the just-recorded video. | Starts intrinsic processing and returns `{status: "processing", cam_num}`. |
| POST | `/api/calibration/extrinsic/record/start` | Optional `{cameras_used: string[]}`. Defaults to connected cameras. | `{status: "recording", cameras, failed}`. Requires at least two cameras and intrinsics for the selected cameras. |
| POST | `/api/calibration/extrinsic/record/stop` | — | `{status: "downloading"}`. Downloads, syncs, calibrates and saves in the background. |
| POST | `/api/calibration/origin/record/start` | Optional `{cameras_used: string[]}`. Defaults to connected cameras. | `{status: "recording", cameras, failed}`. Requires an extrinsic calibration and at least two cameras. |
| POST | `/api/calibration/origin/record/stop` | — | `{status: "downloading"}`. Downloads the capture and computes the world origin in the background. |
| POST | `/api/calibration/apply` | — | Saves the current calibration if extrinsics are available. Returns `{status, filename, filepath}`. |
| GET | `/api/calibration/files` | — | `{files}`, each with a file stem `name` and Unix modification time `modified`. |
| POST | `/api/calibration/load` | `{name: string}` | Makes a full saved calibration current. Returns `{status, file, charuco, n_cameras, n_posed, n_intrinsics}`. |
| POST | `/api/calibration/load-intrinsics` | `{name: string}` | Loads the intrinsic results and clears active extrinsics. Returns the same fields as `/load`. |
| POST | `/api/calibration/auto-load` | — | Tries the last saved config path, then the current project's latest calibration if that path is unavailable. Returns the load result or `{status: "none"}`. |
| DELETE | `/api/calibration/temp-videos` | — | Deletes the current project's calibration temporary videos while calibration is idle. Returns `{status: "deleted"}` or `{status: "none"}`. |
| GET | `/api/calibration/scene` | — | `{source, frame, cameras}`. Prefers live poses, then the configured saved calibration. Sources are `live` or `saved`. Returns 404 when no posed calibration is available. |

For a new calibration, select the project and configure the board. Record and stop each intrinsic video, wait for download, then run intrinsic calibration. Record and stop extrinsics after preparing the camera intrinsics, then optionally record and stop origin calibration. Poll `GET /api/calibration/status` after background actions. Its `status`, `stage`, and `message` describe progress and errors. Extrinsic recording already saves its result when it completes.

Scene camera objects include `id`, world `position`, `look_direction`, `up_direction`, `rotation`, `translation`, `size`, and `fov_y_deg`. The world frame is Z-up and the camera convention is OpenCV (X right, Y down, Z forward).

## Trial recording

[Backend router](../code/api/routers/recording.py) · [React recording client](../frontend/Go2Kin/src/components/recording/recording-api.ts)

Select a project and session, connect cameras, and start a take. A start can succeed with only a subset of cameras, so use the returned `cameras_used` and inspect `failed`. Stopping hands off download and audio synchronization to a background job. Use its `task_id` to track the result. After a page reload, `GET /api/recording/status` can recover an active take or its current job ID.

| Method | Path | Request | Response and behavior |
| --- | --- | --- | --- |
| POST | `/api/recording/start` | `trial_name` (non-empty string), `cameras_used` (non-empty serial array), `sound_source_position` (array of three numbers). | `{message, cameras_used, failed}`. Returns 409 when recording or calibration is busy. |
| POST | `/api/recording/stop` | — | **202** with `{task_id, status}` and possible `errors`. Stops capture and schedules download and sync. Returns 409 if there is no active take or current stop job. |
| GET | `/api/recording/status` | — | `state` is `idle`, `recording`, or `processing`. Active responses include trial name, cameras, sound source position, start time in Unix seconds, task ID, and job status. |
| GET | `/api/recording/jobs/{task_id}` | — | Job snapshot with `task_id`, `status`, per-camera `errors`, and any overall `error` or sync `results`. Returns 404 for an unknown job. |

Recording job states are `pending`, `downloading`, `syncing`, `complete`, and `failed`. Sync results include `passed`, `reasons`, and filename-keyed `offsets` with `offset_seconds` and `status`. A job can fail a sync acceptance check and report the reasons in `results`.

## Pose2Sim processing

[Backend router](../code/api/routers/processing.py) · [Background worker](../code/api/processing_job.py) · [React processing client](../frontend/Go2Kin/src/components/processing/processing-api.ts)

Processing runs trials sequentially. Invalid paths reject the start request. A trial that fails or is skipped during processing leaves the remaining trials eligible to run. Poll status until the run reaches `complete`, `failed`, or `cancelled`.

| Method | Path | Request | Response and behavior |
| --- | --- | --- | --- |
| POST | `/api/processing/start` | `{trial_paths: string[]}`, at least one path. Accepts absolute paths under the data root or paths relative to it, such as `MyProject/sessions/2026-10-19/trial_001`. | **202** with `{message, run_id, trials}`. Invalid entries return 400, and a concurrent run returns 409. |
| POST | `/api/processing/stop` | — | Requests cancellation and returns `{message, state}`. Returns 409 when there is no run to stop. |
| GET | `/api/processing/status` | Optional query parameter `since` (non-negative integer). | Returns `state`, `run_id`, `started_at`, `finished_at`, `current_trial`, `current_step`, `steps`, `trials`, `summary`, `logs`, `next_since`, and `logs_dropped`. Pass the previous `next_since` as `since` to fetch newer log lines. |

Run states are `idle`, `running`, `stopping`, `complete`, `failed`, and `cancelled`. Per-trial statuses are `pending`, `processing`, `complete`, `failed`, `skipped`, and `cancelled`.

## Maintain the contract

Request models are in [schemas.py](../code/api/schemas.py). When changing a route, update its request model, response handling in the relevant React client, and this reference together. Check `/openapi.json` against the route and inspect the handler for dynamic response fields, partial failures, and background state transitions.
