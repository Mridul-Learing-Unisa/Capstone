// API client for calibration endpoints in code/api/routers/calibration.py

const HOST = "http://localhost:8000"
const API = HOST + "/api/calibration"

export type CharucoConfig = {
    columns: number
    rows: number
    square_size_cm: number
    aruco_scale: number
    dict_name: string
    inverted: boolean
}

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

export type IntrinsicRow = IntrinsicCam

export type ExtrinsicReport = {
    rmse: number | null
    n_cameras: number
    n_points: number | null
    level: "green" | "amber" | "red"
}

export type SyncIssue = {
    heading: string
    subtext: string
    table: string
    reasons: string[]
}

export type CalibrationStatus = {
    status: "idle" | "recording" | "downloading" | "syncing" | "processing" | "complete" | "error" | string
    stage: "intrinsic" | "extrinsic" | "origin" | null
    message: string
    recording: { type: string; serials: string[] } | null
    intrinsics: IntrinsicRow[]
    intrinsic_count: number
    extrinsic: ExtrinsicReport | null
    has_extrinsics: boolean
    origin_set: boolean
    loaded_file: string | null
    sync_issue: SyncIssue | null
    can_extrinsic: boolean
    can_origin: boolean
    can_apply?: boolean
}

export const BUSY = ["recording", "downloading", "syncing", "processing"]

export type VideoFile = { name: string; path: string; modified: number }

export type CalibrationFile = {
    name: string
    modified: number
}

function errorText(detail: unknown): string | null {
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map(d => d?.msg ?? String(d)).join("; ")
    if (detail && typeof detail === "object" && "message" in detail) return String(detail.message)
    return null
}

async function request(path: string, method = "GET", body?: unknown) {
    const res = await fetch(HOST + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
        const payload = await res.json().catch(() => null)
        const msg = errorText(payload?.detail) ?? `HTTP ${res.status}`
        throw new Error(msg)
    }
    return res
}

// Charuco board
export async function getCharucoConfig(): Promise<CharucoConfig> {
    return (await request("/api/calibration/charuco")).json()
}
export const getCharuco = getCharucoConfig

export async function saveCharucoConfig(config: CharucoConfig): Promise<{ status: string }> {
    return (await request("/api/calibration/charuco", "POST", config)).json()
}
export async function saveCharuco(config: CharucoConfig): Promise<CharucoConfig> {
    const res = await (await request("/api/calibration/charuco", "POST", config)).json()
    return res.charuco ?? config
}

export async function getCharucoDictionaries(): Promise<string[]> {
    const res = await (await request("/api/calibration/charuco/dictionaries")).json()
    return res?.dictionaries ?? []
}
export const getDictionaries = getCharucoDictionaries

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

export async function getBoardImage(config: CharucoConfig): Promise<Blob> {
    const res = await fetch(API + "/charuco/board-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    })
    if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(errorText(payload?.detail) ?? `HTTP ${res.status}`)
    }
    return res.blob()
}

// Calibration status
export async function getCalibrationStatus(): Promise<CalibrationStatus> {
    return (await request("/api/calibration/status")).json()
}
export const getStatus = getCalibrationStatus

export async function autoLoadCalibration(): Promise<unknown> {
    return (await request("/api/calibration/auto-load", "POST")).json()
}
export async function autoLoad(): Promise<boolean> {
    try {
        const res = await (await request("/api/calibration/auto-load", "POST")).json()
        return res?.status !== "none"
    } catch {
        return false
    }
}

// Intrinsics
export async function startIntrinsicRecord(serial: string): Promise<void> {
    await request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/record/start`, "POST")
}

export async function stopIntrinsicRecord(serial: string): Promise<void> {
    await request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/record/stop`, "POST")
}

export async function calibrateIntrinsic(serial: string, video_path?: string): Promise<void> {
    await request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/calibrate`, "POST", video_path ? { video_path } : undefined)
}

export async function listIntrinsicVideos(serial: string): Promise<VideoFile[]> {
    const data = await (await request(`/api/calibration/intrinsic/${encodeURIComponent(serial)}/videos`)).json()
    return data?.videos ?? []
}

// Extrinsics
export async function startExtrinsicRecord(): Promise<void> {
    await request("/api/calibration/extrinsic/record/start", "POST")
}

export async function stopExtrinsicRecord(): Promise<void> {
    await request("/api/calibration/extrinsic/record/stop", "POST")
}

// Origin
export async function startOriginRecord(): Promise<void> {
    await request("/api/calibration/origin/record/start", "POST")
}

export async function stopOriginRecord(): Promise<void> {
    await request("/api/calibration/origin/record/stop", "POST")
}

// Saved files
export async function listCalibrationFiles(): Promise<CalibrationFile[]> {
    const res = await (await request("/api/calibration/files")).json()
    return res?.files ?? []
}

export async function loadCalibration(name: string): Promise<unknown> {
    return (await request("/api/calibration/load", "POST", { name })).json()
}

export async function loadIntrinsics(name: string): Promise<unknown> {
    return (await request("/api/calibration/load-intrinsics", "POST", { name })).json()
}

export async function deleteTempVideos(): Promise<{ deleted: number }> {
    return (await request("/api/calibration/temp-videos", "DELETE")).json()
}

export async function applyCalibration(): Promise<{ status: string; filename: string }> {
    return (await request("/api/calibration/apply", "POST")).json()
}
