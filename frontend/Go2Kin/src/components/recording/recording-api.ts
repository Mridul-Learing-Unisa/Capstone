// Small helpers for talking to the recording + camera endpoints in code/api/routers

const HOST = "http://localhost:8000"

export type Camera = { serial: string, name: string, status: string }
export type Selection = { project: string | null, session: string | null }

export type Job = {
    task_id: string
    status: string   // pending, downloading, syncing, complete or failed
    error?: string
    errors?: Record<string, string>   // cameras that had a problem, by serial
    results: {
        passed: boolean
        reasons: string[]
        offsets: Record<string, { offset_seconds: number, status: string }>
    } | null
}

// what the server is up to right now, so a page refresh doesn't lose a take
export type RecordingStatus = {
    state: "idle" | "recording" | "processing"
    trial_name?: string
    sound_source_position?: number[]
    started_at?: number   // unix seconds
    task_id?: string
    job_status?: string
}

export const FINISHED = ["complete", "failed"]

// FastAPI errors come back as a string, a {message} object or a list, so turn any of them into text
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
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(errorText(data?.detail) ?? `${method} ${path} failed (${res.status})`)
    return data
}

export async function getCameras(): Promise<Camera[]> {
    const data = await request("/api/cameras")
    return data.cameras
}

export function getSelection(): Promise<Selection> {
    return request("/api/projects/selection")
}

export function getRecordingStatus(): Promise<RecordingStatus> {
    return request("/api/recording/status")
}

export function startRecording(trialName: string, cameras: string[], sound: number[]) {
    return request("/api/recording/start", "POST", {
        trial_name: trialName,
        cameras_used: cameras,
        sound_source_position: sound,
    })
}

export function stopRecording(): Promise<Job> {
    return request("/api/recording/stop", "POST")
}

export function getJob(taskId: string): Promise<Job> {
    return request(`/api/recording/jobs/${taskId}`)
}

// same as the tkinter app: "walk" -> "walk_001", "walk_001" -> "walk_002"
export function nextTrialName(name: string): string {
    const match = name.match(/^(.*)_(\d+)$/)
    if (!match) return `${name}_001`
    return `${match[1]}_${String(Number(match[2]) + 1).padStart(3, "0")}`
}

// milliseconds -> "00:01:23"
export function formatTime(ms: number): string {
    const total = Math.floor(ms / 1000)
    const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    return parts.map(n => String(n).padStart(2, "0")).join(":")
}
