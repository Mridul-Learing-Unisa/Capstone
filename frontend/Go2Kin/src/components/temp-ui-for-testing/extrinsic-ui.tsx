import { useEffect, useRef, useState } from 'react'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/calibration'

type Stage = 'extrinsic' | 'origin'

type Status = {
    status: string          // idle / recording / downloading / syncing / processing / complete / error
    stage: Stage | 'intrinsic' | null
    message: string
    recording: { type: string; serials: string[] } | null
    extrinsic: { rmse: number | null; n_cameras: number; n_points: number | null; level: string } | null
    origin_set: boolean
    loaded_file: string | null
    sync_issue: { heading: string; subtext: string; table: string; reasons: string[] } | null
    can_extrinsic: boolean
    can_origin: boolean
}

const BUSY = ['recording', 'downloading', 'syncing', 'processing']

// Same colours as the tkinter calibration tab indicators.
const COLORS: Record<string, string> = {
    grey: '#9E9E9E', red: '#F44336', amber: '#FF9800', green: '#4CAF50', blue: '#2196F3',
}

// Temporary, unstyled UI for poking the extrinsic + set-origin API by hand.
// Needs 2+ connected cameras (Cameras UI), a project (Project UI) and intrinsics (Intrinsic UI).
// The server saves ("applies") the calibration automatically when each step succeeds.
function ExtrinsicUI() {
    const [status, setStatus] = useState<Status | null>(null)   // null = API unreachable
    const [delay, setDelay] = useState('5')                        // tkinter extrinsic countdown is 5s
    const [countdown, setCountdown] = useState<{ stage: Stage; left: number } | null>(null)
    const timer = useRef<ReturnType<typeof setInterval> | null>(null)
    const [log, setLog] = useState('')

    async function refreshStatus() {
        try {
            const res = await fetch(API + '/status')
            setStatus(await res.json())
        } catch {
            setStatus(null)
        }
    }

    // Recording/downloading/syncing/calibrating all run in the background on the server, so poll.
    useEffect(() => {
        refreshStatus()
        const poll = setInterval(refreshStatus, 1000)
        return () => { clearInterval(poll); if (timer.current) clearInterval(timer.current) }
    }, [])

    async function call(method: string, url: string) {
        try {
            const res = await fetch(url, { method })
            const data = await res.json().catch(() => null)
            setLog(`${method} ${url.replace(HOST, '')} -> ${res.status}\n` + JSON.stringify(data, null, 2))
        } catch (e) {
            setLog(`${method} ${url.replace(HOST, '')} -> request failed: ${e}`)
        }
        refreshStatus()
    }

    const busy = status !== null && BUSY.includes(status.status)

    function isRecording(stage: Stage) {
        return status?.status === 'recording' && status.recording?.type === stage
    }

    // Countdown runs client-side (as in tkinter), then the server starts all connected cameras.
    function start(stage: Stage) {
        const seconds = Math.max(0, parseInt(delay) || 0)
        if (seconds === 0) { call('POST', `${API}/${stage}/record/start`); return }
        setCountdown({ stage, left: seconds })
        timer.current = setInterval(() => {
            setCountdown(c => {
                if (!c || c.left > 1) return c && { ...c, left: c.left - 1 }
                clearInterval(timer.current!)
                timer.current = null
                call('POST', `${API}/${stage}/record/start`)
                return null
            })
        }, 1000)
    }

    function cancelCountdown() {
        if (timer.current) clearInterval(timer.current)
        timer.current = null
        setCountdown(null)
    }

    function buttonClick(stage: Stage) {
        if (countdown?.stage === stage) cancelCountdown()
        else if (isRecording(stage)) call('POST', `${API}/${stage}/record/stop`)
        else start(stage)
    }

    // grey = not done, red = recording/error, amber = working, else the result colour.
    function indicator(stage: Stage): string {
        if (!status) return COLORS.grey
        if (countdown?.stage === stage) return COLORS.grey
        if (status.stage === stage) {
            if (status.status === 'recording') return COLORS.red
            if (BUSY.includes(status.status)) return COLORS.amber
            if (status.status === 'error') return COLORS.red
        }
        if (stage === 'extrinsic') return status.extrinsic ? COLORS[status.extrinsic.level] ?? COLORS.green : COLORS.grey
        return status.origin_set ? COLORS.green : COLORS.grey
    }

    function stageText(stage: Stage): string {
        if (countdown?.stage === stage) return `Starting in ${countdown.left}...`
        if (status?.stage === stage && status.status !== 'idle') return status.message
        if (stage === 'extrinsic' && status?.extrinsic) {
            const e = status.extrinsic
            return `${e.n_cameras} cameras posed` + (e.rmse !== null ? `, RMSE ${e.rmse.toFixed(3)}px` : '')
        }
        if (stage === 'origin' && status?.origin_set) return 'Origin set'
        return ''
    }

    function button(stage: Stage, label: string, allowed: boolean) {
        const recording = isRecording(stage)
        const counting = countdown?.stage === stage
        return (
            <button
                disabled={!status || (!recording && !counting && (busy || countdown !== null || !allowed))}
                onClick={() => buttonClick(stage)}
                style={recording ? { background: '#dc3545', color: 'white' } : undefined}
            >
                {recording ? 'STOP' : counting ? 'Cancel' : label}
            </button>
        )
    }

    return (
        <div>
            <h3>Extrinsic calibration + set origin API test</h3>

            <div>
                Record delay (s):{' '}
                <input
                    type="number" min={0} style={{ width: 50 }}
                    value={delay} disabled={countdown !== null}
                    onChange={e => setDelay(e.target.value)}
                />
                {status === null && ' (API unreachable)'}
            </div>

            <div>
                {button('extrinsic', 'Start calibration', !status?.can_extrinsic)}{' '}
                <span style={{ color: indicator('extrinsic') }}>●</span> {stageText('extrinsic')}
                <div style={{ color: '#666' }}>Tip: clap near the centre of the camera volume</div>
            </div>

            <div>
                {button('origin', 'Set origin', !status?.can_origin)}{' '}
                <span style={{ color: indicator('origin') }}>●</span> {stageText('origin')}
            </div>

            <div>Applied calibration: <b>{status?.loaded_file ?? '--'}</b></div>

            {status?.sync_issue && (
                <div style={{ color: 'red' }}>
                    <b>{status.sync_issue.heading}</b> {status.sync_issue.subtext}
                    <ul>{status.sync_issue.reasons.map(r => <li key={r}>{r}</li>)}</ul>
                    <pre>{status.sync_issue.table}</pre>
                </div>
            )}

            <pre>{log}</pre>
        </div>
    )
}

export default ExtrinsicUI
