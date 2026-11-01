// Shared by the project/session selector and dialog.

export const API = "http://localhost:8000/api/projects"

// Fired after anything changes the server-side selection, so the selectors re-read it.
export const SELECTION_CHANGED = "selection-changed"

export type Selection = { project: string | null, session: string | null }

// Fetch JSON, throwing the API"s error detail on a non-2xx response.
export async function request(path: string, method = "GET", body?: unknown) {
    const res = await fetch(API + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.detail ?? `${method} ${path} failed (${res.status})`)
    return data
}
