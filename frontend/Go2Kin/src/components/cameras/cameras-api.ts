// Small helpers for the camera endpoints in code/api/routers/cameras.py and preview.py

const HOST = "http://localhost:8000"

export type Camera = {
    serial: string
    name: string                                   // "GoPro 1"
    status: "connected" | "disconnected" | "error" // error = connected but not answering
    battery: number | null
}

// per camera result from the "/all" endpoints, by serial
export type AllResults = Record<string, { status: string, detail?: unknown }>

// Same options as the tkinter bottom bar (Hero 12, 50Hz anti-flicker). The camera rejects
// combinations it can't do (e.g. 4K @ 200), so those come back as an error.
export const RESOLUTIONS = ["1080", "2.7K", "4K"]
export const FPS_OPTIONS = ["25", "50", "100", "200"]
// tkinter's defaults, used until a camera profile says otherwise
export const DEFAULT_RESOLUTION = "4K"
export const DEFAULT_FPS = "50"

// FastAPI errors come back as a string, a {message} object or a list, so turn any of them into text
export function errorText(detail: unknown): string {
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map(d => d?.msg ?? String(d)).join("; ")
    if (detail && typeof detail === "object" && "message" in detail) return String(detail.message)
    return "unknown error"
}

async function request(path: string, method = "GET", body?: unknown) {
    const res = await fetch(HOST + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.detail ? errorText(data.detail) : `${method} ${path} failed (${res.status})`)
    return data
}

export async function getCameras(): Promise<Camera[]> {
    const data = await request("/api/cameras")
    return data.cameras
}

// connects every camera that isn't connected yet, in parallel; one failing doesn't stop the rest
export async function connectAll(): Promise<AllResults> {
    const data = await request("/api/cameras/connect-all", "POST")
    return data.results
}

export function disconnectCamera(serial: string) {
    return request(`/api/cameras/${serial}/disconnect`, "POST")
}

// resolution + FPS the camera was last set to, from its saved profile (works while disconnected)
export async function getSavedSettings(serial: string): Promise<{ resolution?: string, fps?: string }> {
    const data = await request(`/api/cameras/${serial}/settings`)
    const settings = data.profile?.current_settings ?? {}
    return { resolution: settings["2"]?.value_name, fps: settings["3"]?.value_name }
}

export async function setResolutionAll(resolution: string): Promise<AllResults> {
    const data = await request("/api/cameras/resolution/all", "POST", { resolution })
    return data.results
}

export async function setFpsAll(fps: string): Promise<AllResults> {
    const data = await request("/api/cameras/fps/all", "POST", { fps })
    return data.results
}

// only one camera can preview at a time, starting a new one stops the old one on the server
export function startPreview(serial: string) {
    return request(`/api/preview/${serial}/start`, "POST")
}

export function stopPreview(serial: string) {
    return request(`/api/preview/${serial}/stop`, "POST")
}

// MJPEG stream, works straight in an <img src>
export function previewUrl(serial: string) {
    return `${HOST}/api/preview/${serial}/stream`
}
