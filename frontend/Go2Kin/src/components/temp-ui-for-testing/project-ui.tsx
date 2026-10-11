import { useEffect, useState } from 'react'

const API = 'http://localhost:8000/api/projects'

// Temporary, unstyled UI for poking the projects API by hand.
function ProjectUI() {
    const [project, setProject] = useState('')
    const [session, setSession] = useState('')
    const [trial, setTrial] = useState('')
    const [subject, setSubject] = useState<Record<string, string | number>>({
        subject_id: '', initials: '', age: 25, sex: 'M', height_m: 1.75, mass_kg: 70, notes: '',
    })
    const [log, setLog] = useState('')

    // Server-side current selection (project / session / subject_id)
    const [selection, setSelection] = useState<Record<string, string | null> | null>(null)

    async function refreshSelection() {
        try {
            const res = await fetch(API + '/selection')
            setSelection(await res.json())
        } catch {
            setSelection(null)
        }
    }

    useEffect(() => { refreshSelection() }, [])

    // Dropdown options: existing projects / sessions / trials / subjects
    const [projects, setProjects] = useState<string[]>([])
    const [sessions, setSessions] = useState<string[]>([])
    const [trials, setTrials] = useState<string[]>([])
    const [subjects, setSubjects] = useState<Record<string, string | number>[]>([])
    const [reloadTick, setReloadTick] = useState(0)

    async function getJson(path: string) {
        try {
            const res = await fetch(API + path)
            return res.ok ? await res.json() : null
        } catch {
            return null
        }
    }

    useEffect(() => {
        getJson('').then(d => setProjects(d?.projects ?? []))
    }, [reloadTick])

    useEffect(() => {
        if (!project) { setSessions([]); setSubjects([]); return }
        const p = encodeURIComponent(project)
        getJson(`/${p}/sessions`).then(d => setSessions(d?.sessions ?? []))
        getJson(`/${p}/subjects`).then(d => setSubjects(d?.subjects ?? []))
    }, [project, reloadTick])

    useEffect(() => {
        if (!project || !session) { setTrials([]); return }
        getJson(`/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/trials`)
            .then(d => setTrials((d?.trials ?? []).map((t: { trial_name: string }) => t.trial_name)))
    }, [project, session, reloadTick])

    // Picking an existing subject fills in the rest of the form
    function onSubjectIdChange(value: string) {
        const existing = subjects.find(x => x.subject_id === value)
        setSubject(existing ? { ...subject, ...existing } : { ...subject, subject_id: value })
    }

    async function call(method: string, path: string, body?: unknown) {
        try {
            const res = await fetch(API + path, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            })
            const data = await res.json().catch(() => null)
            setLog(`${method} ${path} -> ${res.status}\n` + JSON.stringify(data, null, 2))
        } catch (e) {
            setLog(`${method} ${path} -> request failed: ${e}`)
        }
        refreshSelection()
        setReloadTick(n => n + 1)
    }

    const p = encodeURIComponent(project)
    const s = encodeURIComponent(session)
    const t = encodeURIComponent(trial)

    return (
        <div>
            <h3>Projects API test</h3>

            <div>
                <b>Current:</b>{' '}
                {selection === null ? '(API unreachable)' : (
                    <>
                        project = {selection.project ?? '-'} | session = {selection.session ?? '-'} |
                        participant = {selection.subject_id ?? '-'} | trial (typed below) = {trial || '-'}
                    </>
                )}
            </div>

            <div>
                <label>Project: <input list="projects-list" value={project} onChange={e => setProject(e.target.value)} />
                    <datalist id="projects-list">{projects.map(x => <option key={x} value={x} />)}</datalist></label>
                <button onClick={() => call('GET', '')}>List projects</button>
                <button onClick={() => call('POST', '', { name: project })}>Create project</button>
                <button onClick={() => call('GET', `/${p}/tree`)}>Tree</button>
                <button onClick={() => call('GET', `/${p}/calibration/freshness`)}>Calibration freshness</button>
                <button onClick={() => call('POST', '/selection', { project: project || null })}>Select project</button>
            </div>

            <div>
                <label>Session: <input list="sessions-list" value={session} onChange={e => setSession(e.target.value)} />
                    <datalist id="sessions-list">{sessions.map(x => <option key={x} value={x} />)}</datalist></label>
                <button onClick={() => call('GET', `/${p}/sessions`)}>List sessions</button>
                <button onClick={() => call('POST', `/${p}/sessions`, { name: session })}>Create session</button>
                <button onClick={() => call('GET', `/${p}/sessions/${s}/trials`)}>List trials</button>
                <button onClick={() => call('POST', '/selection', { session: session || null })}>Select session</button>
            </div>

            <div>
                <label>Trial: <input list="trials-list" value={trial} onChange={e => setTrial(e.target.value)} />
                    <datalist id="trials-list">{trials.map(x => <option key={x} value={x} />)}</datalist></label>
                <button onClick={() => call('DELETE', `/${p}/sessions/${s}/trials/${t}`)}>Delete trial</button>
                <button onClick={() => call('PATCH', `/${p}/sessions/${s}/trials/${t}`, { subject_id: subject.subject_id })}>
                    Set trial subject to subject_id below
                </button>
            </div>

            <div>
                <button onClick={() => call('GET', `/${p}/subjects`)}>List subjects</button>
                {['subject_id', 'initials', 'age', 'sex', 'height_m', 'mass_kg', 'notes'].map(k => (
                    <label key={k}> {k}:{' '}
                        <input
                            list={k === 'subject_id' ? 'subjects-list' : undefined}
                            value={subject[k]}
                            size={k === 'notes' ? 15 : 6}
                            onChange={e => k === 'subject_id' ? onSubjectIdChange(e.target.value) : setSubject({
                                ...subject,
                                [k]: ['age', 'height_m', 'mass_kg'].includes(k) ? Number(e.target.value) : e.target.value,
                            })}
                        />
                    </label>
                ))}
                <datalist id="subjects-list">{subjects.map(x => <option key={String(x.subject_id)} value={String(x.subject_id)} />)}</datalist>
                <button onClick={() => call('POST', `/${p}/subjects`, subject)}>Save subject</button>
                <button onClick={() => call('POST', '/selection', { subject_id: subject.subject_id || null })}>Select subject</button>
            </div>

            <div>
                <button onClick={() => call('GET', '/selection')}>Get selection</button>
            </div>

            <pre>{log}</pre>
        </div>
    )
}

export default ProjectUI
