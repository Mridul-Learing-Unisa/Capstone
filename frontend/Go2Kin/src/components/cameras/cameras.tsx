import { useEffect, useState } from "react"
import ConnectedIcon from "../icons/connected-icon"
import DisconnectedIcon from "../icons/disconnected-icon"
import {
    connectAll, DEFAULT_FPS, DEFAULT_RESOLUTION, disconnectCamera, errorText, FPS_OPTIONS, getCameras,
    getSavedSettings, previewUrl, RESOLUTIONS, setFpsAll, setResolutionAll, startPreview, stopPreview,
    type AllResults, type Camera,
} from "./cameras-api"

// "GoPro 2: Camera not responding" for every camera that failed, "" if none did
function failures(results: AllResults, cameras: Camera[]) {
    return Object.entries(results)
        .filter(([, r]) => r.status === "error")
        .map(([serial, r]) => `${cameras.find(c => c.serial === serial)?.name ?? serial}: ${errorText(r.detail)}`)
        .join("; ")
}

// Camera bar in the footer, like the tkinter bottom bar: status + preview per camera,
// Connect All / Disconnect All, and resolution / FPS applied to every connected camera.
export default function Cameras() {
    const [cameras, setCameras] = useState<Camera[]>([])
    const [apiDown, setApiDown] = useState(false)
    const [busy, setBusy] = useState("")             // "Connecting..." etc. while waiting on the API
    const [error, setError] = useState("")
    const [resolution, setResolution] = useState(DEFAULT_RESOLUTION)
    const [fps, setFps] = useState(DEFAULT_FPS)
    const [preview, setPreview] = useState<string | null>(null)          // serial being previewed
    const [previewStarting, setPreviewStarting] = useState<string | null>(null)

    // check the cameras every 3s (also picks up cameras connected from another tab)
    useEffect(() => {
        async function refresh() {
            try {
                setCameras(await getCameras())
                setApiDown(false)
            } catch {
                setApiDown(true)
            }
        }
        refresh()
        const timer = setInterval(refresh, 3000)
        return () => clearInterval(timer)
    }, [])

    // "connected" or "error" both mean the server holds the camera, so both can be disconnected
    const held = cameras.filter(c => c.status !== "disconnected")
    const connected = cameras.filter(c => c.status === "connected")
    const allHeld = cameras.length > 0 && held.length === cameras.length

    // Show the settings the cameras will actually use: connecting restores each camera's saved
    // profile, so read it from the first connected camera (or the first one if none are).
    // Re-read whenever the number of connected cameras changes.
    const settingsSerial = connected[0]?.serial ?? cameras[0]?.serial
    useEffect(() => {
        if (!settingsSerial) return
        getSavedSettings(settingsSerial)
            .then(saved => {
                if (saved.resolution && RESOLUTIONS.includes(saved.resolution)) setResolution(saved.resolution)
                if (saved.fps && FPS_OPTIONS.includes(saved.fps)) setFps(saved.fps)
            })
            .catch(() => { /* no profile yet (never connected), keep the defaults */ })
    }, [settingsSerial, connected.length])

    async function handleConnectToggle() {
        setError("")
        if (allHeld) {
            setBusy("Disconnecting...")
            setPreview(null)   // the server stops the preview on disconnect
            const results = await Promise.allSettled(held.map(c => disconnectCamera(c.serial)))
            const failed = held.filter((_, i) => results[i].status === "rejected").map(c => c.name)
            if (failed.length) setError(`Couldn't disconnect: ${failed.join(", ")}`)
        } else {
            setBusy("Connecting...")   // takes a few seconds per camera, they run in parallel
            try {
                const failed = failures(await connectAll(), cameras)
                if (failed) setError(failed)
            } catch (e) {
                setError((e as Error).message)
            }
        }
        // show the new status straight away instead of waiting for the next 3s check
        try { setCameras(await getCameras()) } catch { /* the 3s check will catch up */ }
        setBusy("")
    }

    // apply to every connected camera; like tkinter, go back to the old value if the cameras reject it
    async function applyAll(value: string, old: string, set: (v: string) => void, send: (v: string) => Promise<AllResults>) {
        setError("")
        set(value)
        setBusy("Applying...")
        try {
            const results = await send(value)
            const failed = failures(results, cameras)
            const anyOk = Object.values(results).some(r => r.status !== "error")
            if (failed) setError(failed)
            if (!anyOk) set(old)
        } catch (e) {
            setError((e as Error).message)
            set(old)
        }
        setBusy("")
    }

    async function handlePreview(serial: string) {
        if (preview === serial) {
            setPreview(null)
            try { await stopPreview(serial) } catch { /* it's gone already, fine */ }
            return
        }
        setError("")
        setPreviewStarting(serial)
        try {
            await startPreview(serial)   // takes a few seconds; stops any other preview
            setPreview(serial)
        } catch (e) {
            setError((e as Error).message)
        }
        setPreviewStarting(null)
    }

    // don't show a stream whose camera has dropped out
    const previewCam = cameras.find(c => c.serial === preview && c.status === "connected")

    let statusText = busy
    if (!statusText && apiDown) statusText = "Can't reach the API, is the server running?"
    else if (!statusText && cameras.length === 0) statusText = "No cameras set up in go2kin_config.json"

    return (
        <section className="flex items-center gap-[5rem]">
            <div className="flex gap-[2rem]">
                {[0, 1, 2, 3].map(i => {
                    // always draw 4, even if fewer cameras are set up
                    const cam = cameras[i]
                    const isConnected = cam?.status === "connected"
                    let previewText = "Preview"
                    if (cam && previewStarting === cam.serial) previewText = "Starting..."
                    else if (cam && preview === cam.serial) previewText = "Stop"
                    return (
                        // div, not label: a label would forward clicks on the name to the Preview button
                        <div key={i} className="camera-preview">
                            <div className="status" title={cam?.status === "error" ? "Connected but not responding" : cam?.status}>
                                {isConnected ? <ConnectedIcon /> : <DisconnectedIcon />}
                                {cam?.name ?? `GoPro ${i + 1}`}
                            </div>
                            <button
                                type="button"
                                disabled={!isConnected || !!busy || (previewStarting !== null && previewStarting !== cam?.serial)}
                                onClick={() => cam && handlePreview(cam.serial)}
                            >
                                {previewText}
                            </button>
                        </div>
                    )
                })}
            </div>

            <button 
                type="button" 
                disabled={!!busy || cameras.length === 0}
                onClick={handleConnectToggle}
                className="w-[10rem]"
            >
                <span>{allHeld ? "Disconnect All" : "Connect All"}</span>
            </button>

            <div className="flex gap-[2rem]">
                <label className="resolution">
                    Resolution:
                    <select className="w-[6rem]" value={resolution} disabled={connected.length === 0 || !!busy}
                        onChange={e => applyAll(e.target.value, resolution, setResolution, setResolutionAll)}>
                        {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </label>
                <label className="fps">
                    FPS:
                    <select className="w-[6rem]" value={fps} disabled={connected.length === 0 || !!busy}
                        onChange={e => applyAll(e.target.value, fps, setFps, setFpsAll)}>
                        {FPS_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                </label>
            </div>

            <div className="flex flex-col text-left min-w-0">
                {statusText && <p className="text-small">{statusText}</p>}
                {error && <p className="text-small text-error!">{error}</p>}
            </div>

            {/* live preview, floating above the footer (one camera at a time) */}
            {previewCam && (
                <div className="popup fixed! right-[1.5rem] bottom-[6rem] w-[32rem]">
                    <div className="w-full flex items-center justify-between">
                        <span>{previewCam.name} preview</span>
                        <button type="button" onClick={() => handlePreview(previewCam.serial)}>Close</button>
                    </div>
                    <img
                        src={previewUrl(previewCam.serial)}
                        alt={`${previewCam.name} live preview`}
                        className="w-full aspect-video object-contain bg-black rounded"
                        onError={() => setPreview(null)}
                    />
                </div>
            )}
        </section>
    )
}
