import { useEffect, useState } from "react"
import ConnectedIcon from "../icons/connected-icon"
import DisconnectedIcon from "../icons/disconnected-icon"
import BatteryIcon from "../icons/battery-icon"
import {
    connectAll,
    connectCamera,
    DEFAULT_FPS,
    DEFAULT_RESOLUTION,
    disconnectCamera,
    errorText,
    FPS_OPTIONS,
    getCameras,
    getSavedSettings,
    previewUrl,
    RESOLUTIONS,
    setFpsAll,
    setResolutionAll,
    startPreview,
    stopPreview,
    type AllResults,
    type Camera,
} from "./cameras-api"

// "GoPro 2: Camera not responding" for every camera that failed, "" if none did
function failures(results: AllResults, cameras: Camera[]) {
    return Object.entries(results)
        .filter(([, r]) => r.status === "error")
        .map(([serial, r]) => `${cameras.find(c => c.serial === serial)?.name ?? serial}: ${errorText(r.detail)}`)
        .join("; ")
}

// Camera bar in the footer, matching the Figma design: status + preview per camera,
// Connect All / Disconnect All, and resolution / FPS controls.
export default function Cameras() {
    const [cameras, setCameras] = useState<Camera[]>([])
    const [apiDown, setApiDown] = useState(false)
    const [busy, setBusy] = useState("")             // "Connecting..." etc. while waiting on the API
    const [error, setError] = useState("")
    const [resolution, setResolution] = useState(DEFAULT_RESOLUTION)
    const [fps, setFps] = useState(DEFAULT_FPS)
    const [preview, setPreview] = useState<string | null>(null)          // serial being previewed
    const [previewStarting, setPreviewStarting] = useState<string | null>(null)
    const [streamLoading, setStreamLoading] = useState(false)
    const [streamError, setStreamError] = useState(false)
    const [previewKey, setPreviewKey] = useState(0)

    // Check the cameras every 3s (also picks up cameras connected from another tab)
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
    const anyHeld = held.length > 0

    // Show settings the cameras actually use: read from saved profile of connected camera
    const settingsSerial = connected[0]?.serial ?? cameras[0]?.serial
    useEffect(() => {
        if (!settingsSerial) return
        getSavedSettings(settingsSerial)
            .then(saved => {
                if (saved.resolution && RESOLUTIONS.includes(saved.resolution)) setResolution(saved.resolution)
                if (saved.fps && FPS_OPTIONS.includes(saved.fps)) setFps(saved.fps)
            })
            .catch(() => { /* keep the defaults if no profile exists */ })
    }, [settingsSerial, connected.length])

    async function handleConnectAll() {
        setError("")
        setBusy("Connecting all cameras...")
        try {
            const res = await connectAll()
            const failed = failures(res, cameras)
            if (failed) setError(failed)

            // Refresh camera state
            const latest = await getCameras()
            setCameras(latest)

            // Apply selected resolution and FPS to the newly connected cameras
            const newlyConnected = latest.filter(c => c.status === "connected")
            if (newlyConnected.length > 0) {
                if (resolution) setResolutionAll(resolution).catch(() => { })
                if (fps) setFpsAll(fps).catch(() => { })
            }
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy("")
    }

    async function handleDisconnectAll() {
        setError("")
        setBusy("Disconnecting all cameras...")
        setPreview(null)
        try {
            const results = await Promise.allSettled(held.map(c => disconnectCamera(c.serial)))
            const failed = held.filter((_, i) => results[i].status === "rejected").map(c => c.name)
            if (failed.length) setError(`Couldn't disconnect: ${failed.join(", ")}`)
        } catch (e) {
            setError((e as Error).message)
        }
        try { setCameras(await getCameras()) } catch { }
        setBusy("")
    }

    async function handleConnectCamera(serial: string) {
        const cam = cameras.find(c => c.serial === serial)
        setError("")
        setBusy(`Connecting ${cam?.name ?? "camera"}...`)
        try {
            await connectCamera(serial)
            if (resolution) setResolutionAll(resolution).catch(() => { })
            if (fps) setFpsAll(fps).catch(() => { })
        } catch (e) {
            setError((e as Error).message)
        }
        try { setCameras(await getCameras()) } catch { }
        setBusy("")
    }

    async function handleDisconnectCamera(serial: string) {
        const cam = cameras.find(c => c.serial === serial)
        setError("")
        if (preview === serial) {
            setPreview(null)
        }
        setBusy(`Disconnecting ${cam?.name ?? "camera"}...`)
        try {
            await disconnectCamera(serial)
        } catch (e) {
            setError((e as Error).message)
        }
        try { setCameras(await getCameras()) } catch { }
        setBusy("")
    }

    // Apply to every connected camera; fall back to old value if cameras reject it
    async function applyAll(value: string, old: string, set: (v: string) => void, send: (v: string) => Promise<AllResults>) {
        setError("")
        set(value)
        if (connected.length === 0) return // Saved locally, will apply on next connect

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
        const cam = cameras.find(c => c.serial === serial)
        if (preview === serial) {
            setPreview(null)
            setStreamError(false)
            setStreamLoading(false)
            try { await stopPreview(serial) } catch { /* ignore if already stopped */ }
            return
        }

        setError("")
        setStreamError(false)
        setStreamLoading(true)
        setPreviewStarting(serial)

        try {
            // If camera is not connected yet, connect it first
            if (cam?.status !== "connected") {
                setBusy(`Connecting ${cam?.name ?? "camera"}...`)
                await connectCamera(serial)
                const latest = await getCameras()
                setCameras(latest)
            }

            setBusy(`Starting ${cam?.name ?? "camera"} preview...`)
            await startPreview(serial)
            setPreview(serial)
            setPreviewKey(k => k + 1)
        } catch (e) {
            setError((e as Error).message)
            setPreview(null)
            setStreamLoading(false)
        } finally {
            setPreviewStarting(null)
            setBusy("")
        }
    }

    const previewCam = cameras.find(c => c.serial === preview && c.status === "connected")

    let statusText = busy
    if (!statusText && apiDown) statusText = "Can't reach the API, is the server running?"
    else if (!statusText && cameras.length === 0) statusText = "No cameras configured"

    return (
        <section className="flex flex-wrap items-center justify-between gap-4 py-2 px-4 bg-white border border-[#BBBBBB] rounded-xl shadow-xs">
            {/* Cameras Status + Preview/Connect Buttons */}
            <div className="flex flex-wrap items-center gap-6">
                {[0, 1, 2, 3].map(i => {
                    const cam = cameras[i]
                    const isConnected = cam?.status === "connected"
                    const isError = cam?.status === "error"

                    let previewText = isConnected ? "Preview" : "Connect"
                    if (cam && previewStarting === cam.serial) previewText = "Starting..."
                    else if (cam && preview === cam.serial) previewText = "Stop"

                    return (
                        <div key={i} className="camera-preview flex flex-col items-start gap-1">
                            <div
                                className="status flex items-center gap-1.5 cursor-pointer hover:opacity-80"
                                onClick={() => cam && (isConnected ? handleDisconnectCamera(cam.serial) : handleConnectCamera(cam.serial))}
                                title={
                                    isError
                                        ? "Connected but not responding. Click to disconnect."
                                        : isConnected
                                            ? "Connected. Click to disconnect."
                                            : "Disconnected. Click to connect."
                                }
                            >
                                {isConnected ? <ConnectedIcon /> : <DisconnectedIcon />}
                                <span className="text-xs font-semibold text-[#121212]">
                                    {cam?.name ?? `GoPro ${i + 1}`}
                                </span>
                                {isConnected && (
                                    <span
                                        className="text-[11px] text-[#666666] font-mono flex items-center gap-0.5 ml-1"
                                        title={cam?.battery != null ? `Battery: ${cam.battery}%` : "Battery unknown"}
                                    >
                                        <BatteryIcon level={cam?.battery} />
                                        <span className={cam?.battery != null && cam.battery <= 20 ? "text-[#F83F23] font-bold" : ""}>
                                            {cam?.battery != null ? `${cam.battery}%` : "—"}
                                        </span>
                                    </span>
                                )}
                                {isConnected && (
                                    <button
                                        type="button"
                                        title="Disconnect camera"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDisconnectCamera(cam.serial)
                                        }}
                                        className="text-[10px] text-[#888888] hover:text-[#F83F23] ml-0.5 cursor-pointer"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            <button
                                type="button"
                                disabled={!cam || (previewStarting !== null && previewStarting !== cam.serial) || (!!busy && !previewStarting)}
                                onClick={() => cam && handlePreview(cam.serial)}
                                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer shadow-xs transition-colors ${preview === cam?.serial
                                        ? "bg-[#F83F23] text-white hover:opacity-90"
                                        : isConnected
                                            ? "bg-white border border-[#BBBBBB] text-[#121212] hover:bg-gray-100"
                                            : "bg-[#EBEBEB] border border-[#BBBBBB] text-[#666666] hover:bg-white hover:text-[#121212]"
                                    }`}
                            >
                                {previewText}
                            </button>
                        </div>
                    )
                })}
            </div>

            {/* Batch Connect / Disconnect Buttons */}
            <div className="flex items-center gap-2">
                {anyHeld ? (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={!!busy}
                            onClick={handleDisconnectAll}
                            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#BBBBBB] text-[#121212] hover:bg-gray-100 shadow-xs cursor-pointer disabled:opacity-50"
                        >
                            Disconnect All
                        </button>
                        {!allHeld && (
                            <button
                                type="button"
                                disabled={!!busy}
                                onClick={handleConnectAll}
                                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#00BE13] text-white hover:opacity-90 shadow-xs cursor-pointer disabled:opacity-50"
                            >
                                Connect All
                            </button>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        disabled={!!busy || cameras.length === 0}
                        onClick={handleConnectAll}
                        className="px-5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#BBBBBB] text-[#121212] hover:bg-gray-100 shadow-xs cursor-pointer disabled:opacity-50 min-w-[7.5rem]"
                    >
                        Connect All
                    </button>
                )}
            </div>

            {/* Resolution and FPS Dropdowns */}
            <div className="flex items-center gap-4">
                <label className="resolution flex items-center gap-1.5 text-xs text-[#666666] font-medium">
                    Resolution:
                    <select
                        className="bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1 text-xs text-[#121212] cursor-pointer"
                        value={resolution}
                        disabled={!!busy}
                        onChange={e => applyAll(e.target.value, resolution, setResolution, setResolutionAll)}
                    >
                        {RESOLUTIONS.map(r => (
                            <option key={r} value={r}>
                                {r}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="fps flex items-center gap-1.5 text-xs text-[#666666] font-medium">
                    FPS:
                    <select
                        className="bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1 text-xs text-[#121212] cursor-pointer"
                        value={fps}
                        disabled={!!busy}
                        onChange={e => applyAll(e.target.value, fps, setFps, setFpsAll)}
                    >
                        {FPS_OPTIONS.map(f => (
                            <option key={f} value={f}>
                                {f}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {/* Status and Error messages */}
            {(statusText || error) && (
                <div className="flex flex-col text-left max-w-xs text-xs">
                    {statusText && <span className="text-[#666666] italic">{statusText}</span>}
                    {error && <span className="text-[#F83F23] font-medium truncate" title={error}>{error}</span>}
                </div>
            )}

            {/* Live Preview Modal */}
            {previewCam && (
                <div className="fixed right-6 bottom-20 w-[30rem] z-50 bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-2xl p-4 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="w-full flex items-center justify-between border-b border-[#BBBBBB] pb-2">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#00BE13] animate-pulse" />
                            <span className="font-semibold text-sm text-[#121212]">{previewCam.name} Live Preview</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => handlePreview(previewCam.serial)}
                            className="text-xs px-2.5 py-1 bg-white border border-[#BBBBBB] rounded hover:bg-gray-100 cursor-pointer font-medium"
                        >
                            Close
                        </button>
                    </div>

                    <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative flex items-center justify-center">
                        {streamLoading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-white text-xs z-10">
                                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                <span>Starting stream from {previewCam.name}...</span>
                            </div>
                        )}
                        {streamError ? (
                            <div className="flex flex-col items-center justify-center gap-2 text-white/70 text-xs p-4 text-center">
                                <p className="text-red-400 font-semibold">Video stream initializing or interrupted</p>
                                <span className="text-[11px] text-white/50">Ensure camera is on and USB connection is stable.</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStreamError(false)
                                        setStreamLoading(true)
                                        setPreviewKey(k => k + 1)
                                    }}
                                    className="mt-2 px-3 py-1 bg-white text-black rounded text-xs font-semibold hover:bg-gray-200 cursor-pointer"
                                >
                                    Retry Stream
                                </button>
                            </div>
                        ) : (
                            <img
                                key={previewKey}
                                src={`${previewUrl(previewCam.serial)}?t=${previewKey}`}
                                alt={`${previewCam.name} live preview`}
                                className="w-full h-full object-contain"
                                onLoad={() => setStreamLoading(false)}
                                onError={() => {
                                    setStreamLoading(false)
                                    setStreamError(true)
                                }}
                            />
                        )}
                    </div>
                </div>
            )}
        </section>
    )
}
