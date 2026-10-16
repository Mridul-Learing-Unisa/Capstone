import { useEffect, useState } from 'react'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/calibration'

type Intrinsic = {
    serial: string
    cam_num: number
    name: string
    calibrated: boolean
    rmse: number | null
    frames_used: number | null
    video: string | null   // file name of the video selected/recorded for this camera
}

type Status = {
    status: string          // idle / recording / downloading / processing / complete / error
    message: string
    recording: { type: string; serials: string[] } | null
    intrinsics: Intrinsic[]
}

const BUSY = ['recording', 'downloading', 'syncing', 'processing']

// Temporary, unstyled UI for poking the intrinsic calibration API by hand.
// Recording needs the camera connected (Cameras UI) and a project selected (Project UI).
function IntrinsicUI() {
    const [status, setStatus] = useState<Status | null>(null)   // null = API unreachable
    const [paths, setPaths] = useState<Record<string, string>>({})   // serial -> typed video path
    const [log, setLog] = useState('')

    async function refreshStatus() {
        try {
            const res = await fetch(API + '/status')
            setStatus(await res.json())
        } catch {
            setStatus(null)
        }
    }

    // Recording/downloading/calibrating all run in the background on the server, so poll.
    useEffect(() => {
        refreshStatus()
        const poll = setInterval(refreshStatus, 1000)
        return () => clearInterval(poll)
    }, [])

    async function call(method: string, url: string, body?: unknown) {
        try {
            const res = await fetch(url, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            })
            const data = await res.json().catch(() => null)
            setLog(`${method} ${url.replace(HOST, '')} -> ${res.status}\n` + JSON.stringify(data, null, 2))
        } catch (e) {
            setLog(`${method} ${url.replace(HOST, '')} -> request failed: ${e}`)
        }
        refreshStatus()
    }

    const busy = status !== null && BUSY.includes(status.status)

    function isRecording(serial: string) {
        return status?.status === 'recording'
            && status.recording?.type === 'intrinsic'
            && status.recording.serials.includes(serial)
    }

    function recordToggle(cam: Intrinsic) {
        const action = isRecording(cam.serial) ? 'stop' : 'start'
        call('POST', `${API}/intrinsic/${cam.serial}/record/${action}`)
    }

    // Empty path = calibrate from the video just recorded for this camera.
    function calibrate(cam: Intrinsic) {
        const path = paths[cam.serial]?.trim().replace(/^"|"$/g, '')   // strip quotes from Windows "Copy as path"
        call('POST', `${API}/intrinsic/${cam.serial}/calibrate`, path ? { video_path: path } : undefined)
    }

    return (
        <div>
            <h3>Intrinsic calibration API test</h3>

            <div>
                Status: <b>{status ? status.status : 'API unreachable'}</b>
                {status?.message && ` - ${status.message}`}
            </div>

            {status?.intrinsics.map(cam => (
                <div key={cam.serial}>
                    <b>{cam.name}</b>{' '}
                    <button
                        disabled={busy && !isRecording(cam.serial)}
                        onClick={() => recordToggle(cam)}
                    >
                        {isRecording(cam.serial) ? 'Stop' : 'Record'}
                    </button>{' '}
                    Video:{' '}
                    <input
                        style={{ width: 360 }}
                        placeholder={cam.video ?? 'full path to .mp4 on the server, or record one'}
                        value={paths[cam.serial] ?? ''}
                        onChange={e => setPaths(p => ({ ...p, [cam.serial]: e.target.value }))}
                    />{' '}
                    <button
                        disabled={busy || (!cam.video && !paths[cam.serial]?.trim())}
                        onClick={() => calibrate(cam)}
                    >
                        Calibrate
                    </button>{' '}
                    RMSE: {cam.rmse !== null ? `${cam.rmse.toFixed(3)} px` : '--'}
                    {cam.frames_used !== null && ` (${cam.frames_used} frames)`}
                </div>
            ))}

            <pre>{log}</pre>
        </div>
    )
}

export default IntrinsicUI
