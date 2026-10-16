import { useEffect, useRef, useState } from 'react'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/cameras'
const PREVIEW_API = HOST + '/api/preview'

type Camera = { serial: string; name: string; status: string; battery: number | null }

// Same options and defaults as the tkinter bottom camera bar (Hero 12, 50Hz anti-flicker).
const RESOLUTIONS = ['1080', '2.7K', '4K']
const FPS_OPTIONS = ['25', '50', '100', '200']

// Temporary, unstyled UI for poking the cameras + preview API by hand.
// One "Connect all" button; cameras then stay connected until the server shuts down
// (server-side keep-alive), whether or not a preview is open.
function CameraUI() {
    const [cameras, setCameras] = useState<Camera[] | null>(null)   // null = API unreachable
    const [log, setLog] = useState('')
    const [connecting, setConnecting] = useState(false)
    const [startingPreview, setStartingPreview] = useState<string | null>(null)   // serial being started
    const popups = useRef<Record<string, Window>>({})               // serial -> open preview popup
    const [resolution, setResolution] = useState('4K')
    const [fps, setFps] = useState('50')

    async function refreshCameras() {
        try {
            const res = await fetch(API)
            setCameras((await res.json()).cameras)
        } catch {
            setCameras(null)
        }
    }

    // Poll connection status, and stop the server-side preview of any popup the user closed.
    useEffect(() => {
        refreshCameras()
        const poll = setInterval(refreshCameras, 3000)
        const watch = setInterval(() => {
            for (const [serial, win] of Object.entries(popups.current)) {
                if (win.closed) {
                    delete popups.current[serial]
                    fetch(`${PREVIEW_API}/${serial}/stop`, { method: 'POST' }).catch(() => { })
                }
            }
        }, 1000)
        return () => { clearInterval(poll); clearInterval(watch) }
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
            return res.ok
        } catch (e) {
            setLog(`${method} ${url.replace(HOST, '')} -> request failed: ${e}`)
            return false
        }
    }

    // Connecting configures each camera (research settings, clock, saved res/fps/zoom), ~5-10s.
    async function connectAll() {
        setConnecting(true)
        await call('POST', API + '/connect-all')
        setConnecting(false)
        refreshCameras()
    }

    // Like the tkinter bar: changing a dropdown applies it to all connected cameras.
    async function changeResolution(value: string) {
        setResolution(value)
        await call('POST', `${API}/resolution/all`, { resolution: value })
    }

    async function changeFps(value: string) {
        setFps(value)
        await call('POST', `${API}/fps/all`, { fps: value })
    }

    async function startPreview(cam: Camera) {
        if (popups.current[cam.serial] && !popups.current[cam.serial].closed) {
            popups.current[cam.serial].focus()
            return
        }
        // Open synchronously inside the click so the browser doesn't block the popup.
        const win = window.open('', `preview-${cam.serial}`, 'width=960,height=560')
        if (!win) { setLog('Popup blocked, allow popups for this page'); return }

        // One preview at a time (the server stops the others): close their popups.
        for (const [serial, other] of Object.entries(popups.current)) {
            delete popups.current[serial]
            other.close()
        }

        win.document.title = cam.name
        win.document.body.style.cssText = 'margin:0;background:#000;color:#fff;font-family:sans-serif'
        win.document.body.textContent = `Starting ${cam.name}...`

        setStartingPreview(cam.serial)
        const ok = await call('POST', `${PREVIEW_API}/${cam.serial}/start`)   // takes ~3-4s
        setStartingPreview(null)

        if (!ok) { win.close(); return }
        popups.current[cam.serial] = win
        win.document.body.textContent = ''
        const img = win.document.createElement('img')
        img.style.cssText = 'width:100%;height:100vh;object-fit:contain'
        img.onerror = () => win.close()   // stream ended (camera disconnected / preview stopped)
        img.src = `${PREVIEW_API}/${cam.serial}/stream`
        win.document.body.appendChild(img)
    }

    return (
        <div>
            <h3>Cameras API test</h3>

            <div>
                <button disabled={connecting} onClick={connectAll}>
                    {connecting ? 'Connecting...' : 'Connect all'}
                </button>
                <button onClick={() => call('GET', PREVIEW_API)}>Get running previews</button>
                {' '}Res:{' '}
                <select value={resolution} onChange={e => changeResolution(e.target.value)}>
                    {RESOLUTIONS.map(r => <option key={r}>{r}</option>)}
                </select>
                {' '}FPS:{' '}
                <select value={fps} onChange={e => changeFps(e.target.value)}>
                    {FPS_OPTIONS.map(f => <option key={f}>{f}</option>)}
                </select>
                {cameras === null && ' (API unreachable)'}
            </div>

            {cameras?.map(cam => (
                <div key={cam.serial}>
                    <span style={{ color: cam.status === 'connected' ? 'green' : 'red' }}>●</span>{' '}
                    <b>{cam.name}</b> ({cam.serial}) {cam.status}
                    {cam.battery !== null && ` | battery ${cam.battery}%`}{' '}
                    <button
                        disabled={cam.status !== 'connected' || startingPreview !== null}
                        onClick={() => startPreview(cam)}
                    >
                        {startingPreview === cam.serial ? 'Starting...' : 'Preview'}
                    </button>
                </div>
            ))}

            <pre>{log}</pre>
        </div>
    )
}

export default CameraUI
