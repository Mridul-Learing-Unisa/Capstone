import { useEffect, useRef, useState } from 'react'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/processing'

type Selection = { project: string | null; session: string | null }
type Trial = { trial_name: string; subject_id: string; synced: boolean; processed: boolean }
type Status = {
    state: string           // idle / running / stopping / complete / failed / cancelled
    current_trial: { index: number; total: number; name: string } | null
    current_step: { index: number; name: string } | null
    steps: { name: string; status: string }[]
    trials: { name: string; session: string; status: string; error: string | null }[]
    logs: string[]
    next_since: number
    logs_dropped: boolean
}

const ACTIVE = ['running', 'stopping']
const MAX_LOG_LINES = 2000
// Same colours as the tkinter ProcessingTab step circles.
const COLORS: Record<string, string> = {
    pending: '#bbb', processing: '#2196F3', complete: '#4CAF50',
    failed: '#F44336', skipped: '#FF9800', cancelled: '#9E9E9E',
}

function Dot({ status }: { status: string }) {
    return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: COLORS[status] ?? '#bbb' }} />
}

// Temporary, unstyled UI for poking the processing API by hand. Lists the trials of the selected
// project / session; tick some and run them through Pose2Sim one after another.
function ProcessingUI() {
    const [selection, setSelection] = useState<Selection | null>(null)
    const [trials, setTrials] = useState<Trial[] | null>(null)   // null = API unreachable
    const [checked, setChecked] = useState<Set<string>>(new Set())
    const [status, setStatus] = useState<Status | null>(null)
    const [logs, setLogs] = useState<string[]>([])
    const [log, setLog] = useState('')
    const since = useRef<number | null>(null)
    const statusPoll = useRef<ReturnType<typeof setInterval> | null>(null)
    const logBox = useRef<HTMLPreElement>(null)

    async function refresh() {
        try {
            const sel: Selection = await (await fetch(HOST + '/api/projects/selection')).json()
            setSelection(sel)
            if (!sel.project || !sel.session) { setTrials([]); return }
            const res = await fetch(`${HOST}/api/projects/${encodeURIComponent(sel.project)}/sessions/${encodeURIComponent(sel.session)}/trials`)
            setTrials((await res.json()).trials ?? [])
        } catch {
            setTrials(null)
        }
    }

    useEffect(() => {
        refresh()
        poll()   // pick up a run that is already going (e.g. after a page reload)
        const t = setInterval(refresh, 3000)
        return () => { clearInterval(t); if (statusPoll.current) clearInterval(statusPoll.current) }
    }, [])

    // Keep the log scrolled to the bottom.
    useEffect(() => {
        if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
    }, [logs])

    async function poll() {
        try {
            const first = since.current === null
            const q = first ? '' : `?since=${since.current}`
            const st: Status = await (await fetch(API + '/status' + q)).json()
            setStatus(st)
            if (first) {
                setLogs(st.logs.slice(-MAX_LOG_LINES))   // whole buffer: replace, so a double mount can't duplicate it
            } else if (st.logs.length || st.logs_dropped) {
                setLogs(prev => [...prev, ...(st.logs_dropped ? ['... (older lines dropped)'] : []), ...st.logs].slice(-MAX_LOG_LINES))
            }
            since.current = st.next_since
            if (ACTIVE.includes(st.state)) {
                if (!statusPoll.current) statusPoll.current = setInterval(poll, 1000)
            } else if (statusPoll.current) {
                clearInterval(statusPoll.current)
                statusPoll.current = null
                refresh()   // pick up the new "processed" flags
            }
        } catch { /* API unreachable: refresh() reports it */ }
    }

    async function call(method: string, path: string, body?: unknown) {
        try {
            const res = await fetch(API + path, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            })
            const data = await res.json().catch(() => null)
            setLog(`${method} /api/processing${path} -> ${res.status}\n` + JSON.stringify(data, null, 2))
            return { ok: res.ok, data }
        } catch (e) {
            setLog(`${method} /api/processing${path} -> request failed: ${e}`)
            return { ok: false, data: null }
        }
    }

    async function start() {
        if (!selection?.project || !selection?.session) return
        const paths = (trials ?? []).filter(t => checked.has(t.trial_name))
            .map(t => `${selection.project}/sessions/${selection.session}/${t.trial_name}`)
        const { ok } = await call('POST', '/start', { trial_paths: paths })
        if (!ok) return
        // New run: the server restarted its log, so start our cursor from 0.
        since.current = 0
        setLogs([])
        poll()
    }

    async function stop() {
        await call('POST', '/stop')
        poll()
    }

    function toggle(name: string) {
        setChecked(prev => {
            const next = new Set(prev)
            if (next.has(name)) next.delete(name); else next.add(name)
            return next
        })
    }

    const running = status !== null && ACTIVE.includes(status.state)
    const selectedCount = (trials ?? []).filter(t => checked.has(t.trial_name)).length
    const runStatus = new Map((status?.trials ?? []).map(t => [t.name, t]))

    return (
        <div>
            <h3>Processing API test</h3>

            <div>
                Trials in: <b>{selection?.project ?? '-'}</b> / <b>{selection?.session ?? '-'}</b>
                {trials === null && <span style={{ color: 'red' }}> API unreachable</span>}
            </div>

            <table>
                <thead>
                    <tr><th></th><th>Trial</th><th>Subject</th><th>Synced</th><th>Processed</th><th>This run</th></tr>
                </thead>
                <tbody>
                    {(trials ?? []).map(t => {
                        const r = runStatus.get(t.trial_name)
                        return (
                            <tr key={t.trial_name}>
                                <td><input type="checkbox" disabled={running} checked={checked.has(t.trial_name)} onChange={() => toggle(t.trial_name)} /></td>
                                <td>{t.trial_name}</td>
                                <td>{t.subject_id}</td>
                                <td>{t.synced ? 'yes' : 'no'}</td>
                                <td>{t.processed ? 'yes' : 'no'}</td>
                                <td>
                                    {r && <><Dot status={r.status} /> {r.status}</>}
                                    {r?.error && <span style={{ color: 'red' }}> - {r.error}</span>}
                                </td>
                            </tr>
                        )
                    })}
                    {trials?.length === 0 && <tr><td colSpan={6}>No trials (select a project and session).</td></tr>}
                </tbody>
            </table>

            <div>
                {running ? (
                    <button disabled={status?.state === 'stopping'} onClick={stop} style={{ background: '#dc3545', color: 'white' }}>
                        {status?.state === 'stopping' ? 'Stopping...' : 'STOP'}
                    </button>
                ) : (
                    <button disabled={selectedCount === 0} onClick={start} style={selectedCount ? { background: '#28a745', color: 'white' } : undefined}>
                        PROCESS SELECTED ({selectedCount})
                    </button>
                )}{' '}
                State: <b>{status?.state ?? '-'}</b>
                {status?.current_trial && <> | trial {status.current_trial.index + 1}/{status.current_trial.total}: <b>{status.current_trial.name}</b></>}
                {status?.current_step && <> | step: <b>{status.current_step.name}</b></>}
            </div>

            <div>
                {(status?.steps ?? []).map(s => (
                    <span key={s.name} style={{ marginRight: 12 }}><Dot status={s.status} /> {s.name}</span>
                ))}
            </div>

            <pre ref={logBox} style={{ height: 250, overflow: 'auto', background: '#111', color: '#ddd', fontSize: 12, padding: 6 }}>
                {logs.join('\n')}
            </pre>

            <pre>{log}</pre>
        </div>
    )
}

export default ProcessingUI
