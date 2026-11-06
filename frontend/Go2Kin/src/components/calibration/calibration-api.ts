// Small helpers for the calibration endpoints in code/api/routers/calibration.py

const HOST = "http://localhost:8000"
const API = HOST + "/api/calibration"

export type CharucoConfig = {
    columns: number
    rows: number
    square_size_cm: number
    aruco_scale: number      // marker size as a fraction of the square
    dict_name: string
    inverted: boolean
}

// Same defaults as the tkinter tab and the server (DEFAULT_CHARUCO), used until the saved config loads
export const DEFAULT_CHARUCO: CharucoConfig = {
    columns: 5, rows: 7, square_size_cm: 11.7, aruco_scale: 0.75, dict_name: "DICT_4X4_50", inverted: false,
}

// FastAPI errors come back as a string, a {message} object or a list, so turn any of them into text
function errorText(detail: unknown): string | null {
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map(d => d?.msg ?? String(d)).join("; ")
    if (detail && typeof detail === "object" && "message" in detail) return String(detail.message)
    return null
}

async function send(path: string, method = "GET", body?: unknown) {
    const res = await fetch(API + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
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
    [key: string]: unknown        // extrinsic / origin fields, used by the other panels
}

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
