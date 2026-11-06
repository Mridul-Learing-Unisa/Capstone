<<<<<<< HEAD
// Small helpers for the calibration endpoints in code/api/routers/calibration.py
=======
// API client for calibration endpoints in code/api/routers/calibration.py
>>>>>>> e53e591 (Calliberation tab)

const HOST = "http://localhost:8000"
const API = HOST + "/api/calibration"

export type CharucoConfig = {
    columns: number
    rows: number
    square_size_cm: number
<<<<<<< HEAD
    aruco_scale: number      // marker size as a fraction of the square
=======
    aruco_scale: number
>>>>>>> e53e591 (Calliberation tab)
    dict_name: string
    inverted: boolean
}

<<<<<<< HEAD
// Same defaults as the tkinter tab and the server (DEFAULT_CHARUCO), used until the saved config loads
export const DEFAULT_CHARUCO: CharucoConfig = {
    columns: 5, rows: 7, square_size_cm: 11.7, aruco_scale: 0.75, dict_name: "DICT_4X4_50", inverted: false,
}

// FastAPI errors come back as a string, a {message} object or a list, so turn any of them into text
=======
export const DEFAULT_CHARUCO: CharucoConfig = {
    columns: 5,
    rows: 7,
    square_size_cm: 11.7,
    aruco_scale: 0.75,
    dict_name: "DICT_4X4_50",
    inverted: false,
}

export type IntrinsicCam = {
    serial: string
    cam_num: number
    name: string
    calibrated: boolean
    rmse: number | null
    frames_used: number | null
    video: string | null
}

export type ExtrinsicReport = {
    rmse: number | null
    n_cameras: number
    n_points: number | null
    level: string
}

export type SyncIssue = {
    heading: string
    subtext: string
    table: string
    reasons: string[]
}

export type CalibrationStatus = {
    status: string // idle / recording / downloading / syncing / processing / complete / error
    stage: "extrinsic" | "origin" | "intrinsic" | null
    message: string
    recording: { type: string; serials: string[] } | null
    intrinsics: IntrinsicCam[]
    intrinsic_count: number
    extrinsic: ExtrinsicReport | null
    has_extrinsics: boolean
    origin_set: boolean
    loaded_file: string | null
    sync_issue: SyncIssue | null
    can_extrinsic: boolean
    can_origin: boolean
    can_apply: boolean
}

export type CalibrationFile = {
    name: string
    modified: number
}

>>>>>>> e53e591 (Calliberation tab)
function errorText(detail: unknown): string | null {
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map(d => d?.msg ?? String(d)).join("; ")
    if (detail && typeof detail === "object" && "message" in detail) return String(detail.message)
    return null
}

<<<<<<< HEAD
async function send(path: string, method = "GET", body?: unknown) {
    const res = await fetch(API + path, {
=======
async function request(path: string, method = "GET", body?: unknown) {
    const res = await fetch(HOST + path, {
>>>>>>> e53e591 (Calliberation tab)
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
<<<<<<< HEAD
        const data = await res.json().catch(() => null)
        throw new Error(errorText(data?.detail) ?? `${method} ${path} failed (${res.status})`)
    }
    return res
}

// the board calibration will use: saved this session, else config/calibration/charuco_config.json, else defaults
export async function getCharuco(): Promise<CharucoConfig> {
    return (await send("/charuco")).json()
}

// saves to the same file the tkinter tab uses and makes it the active board
export async function saveCharuco(config: CharucoConfig): Promise<CharucoConfig> {
    const data = await (await send("/charuco", "POST", config)).json()
    return data.charuco
}

export async function getDictionaries(): Promise<string[]> {
    const data = await (await send("/charuco/dictionaries")).json()
    return data.dictionaries
}

// PNG of the board for the given (possibly unsaved) config
export async function getBoardImage(config: CharucoConfig): Promise<Blob> {
    return (await send("/charuco/board-image", "POST", config)).blob()
}

// ---------------------------------------------------------------------------
// Status + intrinsic calibration
// ---------------------------------------------------------------------------

export type IntrinsicRow = {
    serial: string
    cam_num: number
    name: string                 // "GoPro 1"
    calibrated: boolean
    rmse: number | null          // px
    frames_used: number | null   // null when it came from a loaded file
    video: string | null         // file name of the video Calibrate will use, if any
}

// GET /status: one shared state for the whole tab (only one calibration step runs at a time)
export type CalibrationStatus = {
    status: "idle" | "recording" | "downloading" | "syncing" | "processing" | "complete" | "error"
    stage: "intrinsic" | "extrinsic" | "origin" | null   // which step status/message are about
    message: string
    recording: { type: string, serials: string[] } | null
    intrinsics: IntrinsicRow[]
    intrinsic_count: number
    loaded_file: string | null
    extrinsic: ExtrinsicReport | null
    has_extrinsics: boolean       // camera positions known (from a run this session or a loaded file)
    origin_set: boolean
    sync_issue: SyncIssue | null  // set when audio sync rejected the extrinsic recording
    can_extrinsic: boolean        // at least one camera has intrinsics
    can_origin: boolean
}

// rmse is null when the extrinsics came from a loaded file
export type ExtrinsicReport = { rmse: number | null, n_cameras: number, n_points: number | null, level: "green" | "amber" | "red" }

export type SyncIssue = { heading: string, subtext: string, table: string, reasons: string[] }


export const BUSY = ["recording", "downloading", "syncing", "processing"]

export type VideoFile = { name: string, path: string, modified: number }

export async function getStatus(): Promise<CalibrationStatus> {
    return (await send("/status")).json()
}

// tkinter's startup load: last_calibration, else the project's latest. Returns false if there was none.
export async function autoLoad(): Promise<boolean> {
    const data = await (await send("/auto-load", "POST")).json()
    return data.status !== "none"
}

export function startIntrinsicRecord(serial: string) {
    return send(`/intrinsic/${serial}/record/start`, "POST")
}

// stops the camera, then the server downloads the video in the background (watch GET /status)
export function stopIntrinsicRecord(serial: string) {
    return send(`/intrinsic/${serial}/record/stop`, "POST")
}

// videoPath = a full path on the server machine; leave it out to use the video just recorded
export function calibrateIntrinsic(serial: string, videoPath?: string) {
    return send(`/intrinsic/${serial}/calibrate`, "POST", videoPath ? { video_path: videoPath } : undefined)
}

export async function listIntrinsicVideos(serial: string): Promise<VideoFile[]> {
    const data = await (await send(`/intrinsic/${serial}/videos`)).json()
    return data.videos
}

// ---------------------------------------------------------------------------
// Extrinsic calibration + freshness
// ---------------------------------------------------------------------------

// records on every connected camera (at least 2, each with intrinsics); the countdown before it is ours
export function startExtrinsicRecord() {
    return send("/extrinsic/record/start", "POST")
}

// stops, then the server downloads -> syncs -> calibrates -> saves in the background (watch GET /status)
export function stopExtrinsicRecord() {
    return send("/extrinsic/record/stop", "POST")
}

// ---------------------------------------------------------------------------
// Set origin
// ---------------------------------------------------------------------------

// records the board lying at the origin on every connected camera (needs extrinsics first)
export function startOriginRecord() {
    return send("/origin/record/start", "POST")
}

// stops, then the server downloads -> trims (no clap sync, the board is still) -> sets the origin -> saves
export function stopOriginRecord() {
    return send("/origin/record/stop", "POST")
}
=======
        const payload = await res.json().catch(() => null)
        const msg = errorText(payload?.detail) ?? `HTTP ${res.status}`
        throw new Error(msg)
    }
    return res.json().catch(() => null)
}

export async function getCharucoConfig(): Promise<CharucoConfig> {
    return request("/api/calibration/charuco")
}

export async function saveCharucoConfig(config: CharucoConfig): Promise<{ status: string }> {
    return request("/api/calibration/charuco", "POST", config)
}

export async function getCharucoDictionaries(): Promise<string[]> {
    const res = await request("/api/calibration/charuco/dictionaries")
    return res?.dictionaries ?? []
}

export async function downloadBoardImage(config: CharucoConfig): Promise<void> {
    const res = await fetch(API + "/charuco/board-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    })
    if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(errorText(payload?.detail) ?? `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `charuco_${config.columns}x${config.rows}_${config.dict_name}.png`
    a.click()
    URL.revokeObjectURL(url)
}

export async function getCalibrationStatus(): Promise<CalibrationStatus> {
    return request("/api/calibration/status")
}

export async function startIntrinsicRecord(serial: string): Promise<void> {
    return request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/record/start`, "POST")
}

export async function stopIntrinsicRecord(serial: string): Promise<void> {
    return request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/record/stop`, "POST")
}

export async function calibrateIntrinsic(serial: string, video_path?: string): Promise<void> {
    return request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/calibrate`, "POST", video_path ? { video_path } : undefined)
}

export async function startExtrinsicRecord(): Promise<void> {
    return request("/api/calibration/extrinsic/record/start", "POST")
}

export async function stopExtrinsicRecord(): Promise<void> {
    return request("/api/calibration/extrinsic/record/stop", "POST")
}

export async function startOriginRecord(): Promise<void> {
    return request("/api/calibration/origin/record/start", "POST")
}

export async function stopOriginRecord(): Promise<void> {
    return request("/api/calibration/origin/record/stop", "POST")
}

export async function listCalibrationFiles(): Promise<CalibrationFile[]> {
    const res = await request("/api/calibration/files")
    return res?.files ?? []
}

export async function loadCalibration(name: string): Promise<unknown> {
    return request("/api/calibration/load", "POST", { name })
}

export async function loadIntrinsics(name: string): Promise<unknown> {
    return request("/api/calibration/load-intrinsics", "POST", { name })
}

export async function autoLoadCalibration(): Promise<unknown> {
    return request("/api/calibration/auto-load", "POST")
}

export async function deleteTempVideos(): Promise<{ deleted: number }> {
    return request("/api/calibration/temp-videos", "DELETE")
}

export async function applyCalibration(): Promise<{ status: string; filename: string }> {
    return request("/api/calibration/apply", "POST")
}

>>>>>>> e53e591 (Calliberation tab)
