// Shared by the project/session and subject selectors and dialogs.

export const API = "http://localhost:8000/api/projects"

// Fired after anything changes the server-side selection, so the selectors re-read it.
export const SELECTION_CHANGED = "selection-changed"

export type Selection = { project: string | null, session: string | null, subject_id?: string | null }

// Mirrors SubjectData in code/api/schemas.py
export type Subject = {
    subject_id: string
    initials: string
    age: number
    sex: "M" | "F" | "Other"
    height_m: number
    mass_kg: number
    notes: string
}

// FastAPI validation errors (422) send `detail` as a list of { loc, msg }; turn that into one line.
function formatDetail(detail: unknown): string | null {
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) {
        return detail.map(d => `${d?.loc?.[d.loc.length - 1] ?? "field"}: ${d?.msg ?? d}`).join("; ")
    }
    return null
}

// Fetch JSON, throwing the API's error detail on a non-2xx response.
export async function request(path: string, method = "GET", body?: unknown) {
    const res = await fetch(API + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(formatDetail(data?.detail) ?? `${method} ${path} failed (${res.status})`)
    return data
}
