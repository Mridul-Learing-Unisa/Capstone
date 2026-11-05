import { useState, useEffect } from "react"
import NameColumn from "./name-column"
import { request, SELECTION_CHANGED, type Selection } from "./project-api"

// Lets the user pick (or create) a project + session. Only Confirm / Cancel close it.
// New projects/sessions are held locally and only created on Confirm, so Cancel leaves nothing behind.
export default function ProjectDialog({ current, onClose }: { current: Selection | null, onClose: () => void }) {
    const [project, setProject] = useState<string | null>(current?.project ?? null)
    const [session, setSession] = useState<string | null>(current?.session ?? null)

    const [projects, setProjects] = useState<string[]>([])
    const [sessions, setSessions] = useState<string[]>([])
    const [pendingProjects, setPendingProjects] = useState<string[]>([])
    const [pendingSessions, setPendingSessions] = useState<string[]>([])

    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        request("")
            .then(d => setProjects(d.projects ?? []))
            .catch(e => setError(e.message))
    }, [])

    // Sessions of the chosen project (a not-yet-created project has none on the server)
    useEffect(() => {
        if (!project || pendingProjects.includes(project)) return
        let stale = false  // ignore a late reply if the user has already picked another project
        request(`/${encodeURIComponent(project)}/sessions`)
            .then(d => { if (!stale) setSessions(d.sessions ?? []) })
            .catch(e => { if (!stale) setError(e.message) })
        return () => { stale = true }
    }, [project, pendingProjects])

    function chooseProject(name: string) {
        if (name === project) return
        setProject(name)
        setSession(null)
        setSessions([])
        setPendingSessions([])
    }

    function addProject(name: string) {
        if (!projects.includes(name) && !pendingProjects.includes(name)) {
            setPendingProjects(p => [...p, name])
        }
        chooseProject(name)
    }

    function addSession(name: string) {
        if (!sessions.includes(name) && !pendingSessions.includes(name)) {
            setPendingSessions(s => [...s, name])
        }
        setSession(name)
    }

    async function confirm() {
        if (!project || !session) return
        setBusy(true)
        setError(null)
        try {
            const p = encodeURIComponent(project)
            if (pendingProjects.includes(project)) {
                await request("", "POST", { name: project })
                // Now real: a retry after a later failure must not re-create it
                setPendingProjects(list => list.filter(x => x !== project))
                setProjects(list => [...list, project].sort())
            }
            if (pendingSessions.includes(session)) {
                await request(`/${p}/sessions`, "POST", { name: session })
                setPendingSessions(list => list.filter(x => x !== session))
                setSessions(list => [...list, session].sort())
            }
            // Sending `project` resets session + subject on the server, so only send it when it changed
            const body = project === current?.project ? { session } : { project, session }
            await request("/selection", "POST", body)
            window.dispatchEvent(new Event(SELECTION_CHANGED))
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            {/* Blocks clicks on the rest of the page; deliberately does not close the dialog */}
            <div className="fixed inset-0 z-[998] bg-black/10" />

            <section className="absolute top-[3rem] left-0 w-[38rem] h-[] z-[999] flex flex-col gap-4 text-left">
                <div className="grid grid-cols-2 gap-[1rem]">
                    <NameColumn
                        title="Project"
                        names={[...projects, ...pendingProjects]}
                        selected={project}
                        onSelect={chooseProject}
                        onAdd={addProject}
                        disabled={busy}
                    />
                    <NameColumn
                        title="Session"
                        names={[...sessions, ...pendingSessions]}
                        selected={session}
                        onSelect={setSession}
                        onAdd={addSession}
                        disabled={busy || !project}
                        emptyText={project ? "No sessions yet" : "Choose a project first"}
                    />
                </div>

                {error && <p className="text-error">{error}</p>}

                <div className="flex justify-end gap-[1rem]">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="border-none bg-error text-bg-main"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirm}
                        disabled={busy || !project || !session}
                        className="border-none bg-success text-bg-main"
                    >
                        Confirm
                    </button>
                </div>
            </section>
        </>
    )
}