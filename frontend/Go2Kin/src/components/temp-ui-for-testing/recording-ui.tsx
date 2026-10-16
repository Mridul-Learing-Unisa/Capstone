import { useEffect, useRef, useState } from 'react'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/recording'

type Camera = { serial: string; name: string; status: string }
type Selection = { project: string | null; session: string | null; subject_id: string | null }
type Job = {
    task_id: string
    status: string          // pending / downloading / syncing / complete / failed
    error?: string
    errors?: Record<string, string>   // per-camera stop/download problems
    results: {
        passed: boolean
        reasons: string[]
        offsets: Record<string, { offset_seconds: number; status: string }>
    } | null
}

const DONE = ['complete', 'failed']
const SOUND_KEY = 'go2kin.soundSource'   // remembered per browser, like tkinter keeps it in its config
const TRIAL_KEY = 'go2kin.trialName'      // next trial name, like tkinter's last_trial_name

function loadTrialName(): string {
    try { return localStorage.getItem(TRIAL_KEY) || 'TEMP' } catch { return 'TEMP' }   // tkinter default
}

function loadSound(): string[] {
    try {
        const saved = JSON.parse(localStorage.getItem(SOUND_KEY) ?? '')
        if (Array.isArray(saved) && saved.length === 3) return saved.map(String)
    } catch { /* nothing saved yet */ }
    return ['0.0', '0.0', '0.0']   // tkinter default
}

// tkinter increment_trial_name: "walk" -> "walk_001", "walk_001" -> "walk_002".
function nextTrialName(name: string): string {
    const m = name.match(/^(.*)_(\d+)$/)
    return m ? `${m[1]}_${String(Number(m[2]) + 1).padStart(3, '0')}` : `${name}_001`
}

function formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000)
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':')
}

// Temporary, unstyled UI for poking the recording API by hand. Records with every connected
// camera (as the tkinter Recording tab does) into the selected project / session / participant.
function RecordingUI() {
    const [sound, setSound] = useState<string[]>(loadSound)
    const [trialName, setTrialName] = useState(loadTrialName)
    const [cameras, setCameras] = useState<Camera[] | null>(null)   // null = API unreachable
    const [selection, setSelection] = useState<Selection | null>(null)
    const [recording, setRecording] = useState(false)
    const [busy, setBusy] = useState(false)             // start/stop request in flight
    const [startedAt, setStartedAt] = useState<number | null>(null)
    const [now, setNow] = useState(Date.now())
    const [job, setJob] = useState<Job | null>(null)
    const [log, setLog] = useState('')
    const jobPoll = useRef<ReturnType<typeof setInterval> | null>(null)

    async function refresh() {
        try {
            const [cams, sel] = await Promise.all([
                fetch(HOST + '/api/cameras').then(r => r.json()),
                fetch(HOST + '/api/projects/selection').then(r => r.json()),
            ])
            setCameras(cams.cameras)
            setSelection(sel)
        } catch {
            setCameras(null)
        }
    }

    useEffect(() => {
        refresh()
        resume()
        const poll = setInterval(refresh, 3000)
        return () => { clearInterval(poll); if (jobPoll.current) clearInterval(jobPoll.current) }
    }, [])

    // Pick up a take that is still recording or processing on the server (e.g. after a page reload).
    async function resume() {
        try {
            const st = await (await fetch(API + '/status')).json()
            if (st.state === 'idle') {
                // The take may have finished while no page was open: skip names already used in this session.
                const sel: Selection = await (await fetch(HOST + '/api/projects/selection')).json()
                if (!sel.project || !sel.session) return
                const res = await fetch(`${HOST}/api/projects/${encodeURIComponent(sel.project)}/sessions/${encodeURIComponent(sel.session)}/trials`)
                const used = new Set(((await res.json()).trials ?? []).map((t: { trial_name: string }) => t.trial_name))
                setTrialName(name => { while (used.has(name)) name = nextTrialName(name); return name })
                return
            }
            setTrialName(st.trial_name)
            if (st.sound_source_position?.length === 3) setSound(st.sound_source_position.map(String))
            if (st.state === 'recording') {
                setStartedAt(st.started_at * 1000)
                setNow(Date.now())
                setRecording(true)
            } else {
                setJob({ task_id: st.task_id, status: st.job_status, results: null })
                pollJob(st.task_id, st.trial_name)
            }
        } catch { /* API unreachable: refresh() reports it */ }
    }

    // Count-up timer while recording.
    useEffect(() => {
        if (!recording) return
        const tick = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(tick)
    }, [recording])

    useEffect(() => {
        try { localStorage.setItem(SOUND_KEY, JSON.stringify(sound)) } catch { /* storage unavailable */ }
    }, [sound])

    useEffect(() => {
        try { localStorage.setItem(TRIAL_KEY, trialName) } catch { /* storage unavailable */ }
    }, [trialName])

    const connected = cameras?.filter(c => c.status === 'connected') ?? []
    const processing = job !== null && !DONE.includes(job.status)
    const soundValid = sound.every(v => v.trim() !== '' && !isNaN(Number(v)))
    const canStart = !busy && !processing && connected.length > 0 && trialName.trim() !== ''
        && soundValid && !!selection?.project && !!selection?.session

    async function call(method: string, path: string, body?: unknown) {
        try {
            const res = await fetch(API + path, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            })
            const data = await res.json().catch(() => null)
            setLog(`${method} /api/recording${path} -> ${res.status}\n` + JSON.stringify(data, null, 2))
            return { ok: res.ok, data }
        } catch (e) {
            setLog(`${method} /api/recording${path} -> request failed: ${e}`)
            return { ok: false, data: null }
        }
    }

    async function start() {
        setBusy(true)
        setJob(null)
        const { ok } = await call('POST', '/start', {
            trial_name: trialName.trim(),
            cameras_used: connected.map(c => c.serial),
            sound_source_position: sound.map(Number),
        })
        setBusy(false)
        if (ok) {
            setStartedAt(Date.now())
            setNow(Date.now())
            setRecording(true)
        }
    }

    // Stopping always ends the recording on the server; download + sync then run as a job.
    async function stop() {
        setBusy(true)
        setRecording(false)
        const { data } = await call('POST', '/stop')
        setBusy(false)
        if (!data?.task_id) return
        setJob({ task_id: data.task_id, status: data.status, errors: data.errors, results: null })
        if (DONE.includes(data.status)) return
        pollJob(data.task_id, trialName.trim())
    }

    // Follow the download + sync job; the trial name stays locked until it ends, then moves on.
    function pollJob(taskId: string, name: string) {
        if (jobPoll.current) clearInterval(jobPoll.current)
        jobPoll.current = setInterval(async () => {
            try {
                const j: Job = await (await fetch(`${API}/jobs/${taskId}`)).json()
                setJob(j)
                if (DONE.includes(j.status)) {
                    clearInterval(jobPoll.current!)
                    jobPoll.current = null
                    setTrialName(nextTrialName(name))   // ready for the next take
                }
            } catch { /* keep polling */ }
        }, 1000)
    }

    return (
        <div>
            <h3>Recording API test</h3>

            <div>
                Saves to: <b>{selection?.project ?? '-'}</b> / <b>{selection?.session ?? '-'}</b>
                {' '}| participant: <b>{selection?.subject_id ?? '-'}</b>
                {' '}| cameras: {cameras === null ? 'API unreachable' : connected.map(c => c.name).join(', ') || 'none connected'}
            </div>

            <div>
                Sound source (m):{' '}
                {['X', 'Y', 'Z'].map((axis, i) => (
                    <label key={axis}>
                        {' '}{axis}{' '}
                        <input
                            style={{ width: 55 }} value={sound[i]} disabled={recording || processing}
                            onChange={e => setSound(s => s.map((v, j) => j === i ? e.target.value : v))}
                        />
                    </label>
                ))}
                {!soundValid && <span style={{ color: 'red' }}> numbers only</span>}
            </div>

            <div>
                Trial name:{' '}
                <input value={trialName} disabled={recording || processing} onChange={e => setTrialName(e.target.value)} />{' '}
                {recording ? (
                    <button disabled={busy} onClick={stop} style={{ background: '#dc3545', color: 'white' }}>STOP</button>
                ) : (
                    <button disabled={!canStart} onClick={start} style={canStart ? { background: '#28a745', color: 'white' } : undefined}>
                        {busy ? 'Starting...' : 'RECORD'}
                    </button>
                )}{' '}
                <span style={{ fontFamily: 'monospace', fontSize: 20, color: recording ? '#dc3545' : '#333' }}>
                    {formatElapsed(recording && startedAt ? now - startedAt : 0)}
                </span>
            </div>

            {job && (
                <div>
                    Job: <b>{job.status}</b>
                    {processing && ' ...'}
                    {job.error && <span style={{ color: 'red' }}> - {job.error}</span>}
                    {job.errors && Object.keys(job.errors).length > 0 && (
                        <div style={{ color: '#b8860b' }}>
                            {Object.entries(job.errors).map(([serial, msg]) => <div key={serial}>{serial}: {msg}</div>)}
                        </div>
                    )}
                    {job.results && (
                        <div style={{ color: job.results.passed ? 'green' : 'red' }}>
                            Sync {job.results.passed ? 'passed' : 'rejected'}:{' '}
                            {Object.entries(job.results.offsets)
                                .map(([file, o]) => `${file} ${(o.offset_seconds * 1000).toFixed(1)}ms ${o.status}`)
                                .join(' | ')}
                            {job.results.reasons.length > 0 && (
                                <ul>{job.results.reasons.map(r => <li key={r}>{r}</li>)}</ul>
                            )}
                        </div>
                    )}
                </div>
            )}

            <pre>{log}</pre>
        </div>
    )
}

export default RecordingUI
