import { useEffect, useState } from "react"
import DownArrowIcon from "../icons/down-arrow-icon"
import SuccessIcon from "../icons/success-icon"
import FailIcon from "../icons/fail-icon"
import ProcessingIcon from "../icons/processing-icon"
import DisabledIcon from "../icons/disabled-icon"
import BatteryIcon from "../icons/battery-icon"
import { getCameras, type Camera } from "../cameras/cameras-api"
import {
    BUSY, calibrateIntrinsic, getStatus, listIntrinsicVideos, startIntrinsicRecord, stopIntrinsicRecord,
    type CalibrationStatus, type IntrinsicRow, type VideoFile,
} from "./calibration-api"

// same colour bands the tkinter tab uses for calibration RMSE
function rmseColour(rmse: number) {
    if (rmse < 1) return "text-success"
    if (rmse < 2) return "text-processing"
    return "text-error"
}

// "Calibrating Camera 2..." -> 2, so a row can show what the server is doing even after a page reload
function busyCamNum(status: CalibrationStatus | null) {
    if (!status || status.stage !== "intrinsic") return null
    const match = status.message.match(/Camera (\d+)/)
    return match ? Number(match[1]) : null
}

// "Intrinsic Calibration" box: per camera, record a charuco video (or pick one), calibrate, show the RMSE.
// Intrinsics stay on the server between visits, and the page auto-loads the last calibration like tkinter.
export default function IntrinsicCalibration() {
    const [open, setOpen] = useState(false)   // closed by default, like the Charuco panel
    const [status, setStatus] = useState<CalibrationStatus | null>(null)
    const [cameras, setCameras] = useState<Camera[]>([])
    const [paths, setPaths] = useState<Record<string, string>>({})   // typed / picked video path, by serial
    const [pending, setPending] = useState<string | null>(null)       // serial waiting on a button's request
    const [error, setError] = useState("")
    const [browse, setBrowse] = useState<{ serial: string, videos: VideoFile[] } | null>(null)

    // calibration status every second (it's local and cheap), cameras every 3s like the footer
    useEffect(() => {
        async function pollStatus() {
            try { setStatus(await getStatus()) } catch { setStatus(null) }
        }
        async function pollCameras() {
            try { setCameras(await getCameras()) } catch { /* the footer already shows the API is down */ }
        }
        pollStatus()
        pollCameras()
        const statusTimer = setInterval(pollStatus, 1000)
        const cameraTimer = setInterval(pollCameras, 3000)
        return () => { clearInterval(statusTimer); clearInterval(cameraTimer) }
    }, [])

    const rows = status?.intrinsics ?? []
    const busy = !!status && BUSY.includes(status.status)
    const activeCam = busyCamNum(status)
    const calibratedCount = rows.filter(r => r.calibrated).length
    const allCalibrated = rows.length > 0 && calibratedCount === rows.length
    const failed = status?.status === "error" && status.stage === "intrinsic"

    // icon left of the title
    let icon = <DisabledIcon />
    let iconTitle = "Not every camera is calibrated yet"
    if (busy && status?.stage === "intrinsic") { icon = <ProcessingIcon />; iconTitle = status.message }
    else if (failed) { icon = <FailIcon />; iconTitle = status.message }
    else if (allCalibrated) { icon = <SuccessIcon />; iconTitle = "All cameras calibrated" }

    // run one button's request; the 1s status poll shows the progress after that
    async function run(serial: string, action: () => Promise<unknown>) {
        setPending(serial)
        setError("")
        try {
            await action()
            setStatus(await getStatus())
        } catch (e) {
            setError((e as Error).message)
        }
        setPending(null)
    }

    function handleRecord(row: IntrinsicRow, recordingThis: boolean) {
        if (recordingThis) return run(row.serial, () => stopIntrinsicRecord(row.serial))
        // the new recording replaces whatever video was picked for this camera
        setPaths(p => ({ ...p, [row.serial]: "" }))
        return run(row.serial, () => startIntrinsicRecord(row.serial))
    }

    function handleCalibrate(row: IntrinsicRow) {
        const path = paths[row.serial]?.trim()
        return run(row.serial, () => calibrateIntrinsic(row.serial, path || undefined))
    }

    async function handleBrowse(serial: string) {
        if (browse?.serial === serial) { setBrowse(null); return }
        setError("")
        try {
            setBrowse({ serial, videos: await listIntrinsicVideos(serial) })
        } catch (e) {
            setError((e as Error).message)
        }
    }

    function pickVideo(serial: string, video: VideoFile) {
        setPaths(p => ({ ...p, [serial]: video.path }))
        setBrowse(null)
    }

    let footerText = ""
    if (status === null) footerText = "Can't reach the API, is the server running?"
    else if (status.stage === "intrinsic" && !failed) footerText = status.message

    return (
        <section className="intrinsic-calibration flex flex-col items-start gap-[1rem] w-full">
            {/* click the header to expand / collapse */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                className="w-full flex items-center justify-between cursor-pointer select-none"
                onClick={() => setOpen(o => !o)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o) } }}
            >
                <div className="flex items-center gap-[0.5rem]" title={iconTitle}>
                    {icon}
                    <h2>Intrinsic Calibration</h2>
                </div>
                <div className="flex items-center gap-[1rem]">
                    {!open && rows.length > 0 && (
                        <span className="text-small">{calibratedCount}/{rows.length} cameras calibrated</span>
                    )}
                    <span className={`transition-transform ${open ? "rotate-180" : ""}`}><DownArrowIcon /></span>
                </div>
            </div>

            {open && (
                <>
                    {rows.length === 0 && <p className="text-small">No cameras set up in go2kin_config.json</p>}

                    {rows.map(row => {
                        const cam = cameras.find(c => c.serial === row.serial)
                        const connected = cam?.status === "connected"
                        const recordingThis = status?.status === "recording"
                            && status.recording?.type === "intrinsic" && !!status.recording.serials.includes(row.serial)
                        const thisBusy = activeCam === row.cam_num && busy
                        const path = paths[row.serial] ?? ""

                        let recordText = recordingThis ? "Stop" : "Record"
                        if (thisBusy && status?.status === "downloading") recordText = "Downloading..."
                        const calibrateText = thisBusy && status?.status === "processing" ? "Calibrating..." : "Calibrate"

                        return (
                            // div, not label: a label would forward clicks on "Camera 1:" to the Record button
                            <div key={row.serial} className="flex flex-col items-start gap-1 w-full">
                                <div className="flex items-center gap-2">
                                    <span>Camera {row.cam_num}:</span>
                                    {connected ? (
                                        <span className="text-small text-text-secondary flex items-center gap-1 font-mono">
                                            <BatteryIcon level={cam?.battery} />
                                            <span className={cam?.battery != null && cam.battery <= 20 ? "text-error font-medium" : ""}>
                                                {cam?.battery != null ? `${cam.battery}%` : "—"}
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="text-small text-text-secondary italic">(disconnected)</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-[1.5rem]">
                                    <button
                                        type="button"
                                        className={`w-[9rem] ${recordingThis ? "bg-error text-bg-main border-none" : ""}`}
                                        title={connected ? "" : "Connect the camera first"}
                                        disabled={pending !== null || (busy && !recordingThis) || (!connected && !recordingThis)}
                                        onClick={() => handleRecord(row, recordingThis)}
                                    >
                                        {recordText}
                                    </button>
                                    <div className="flex gap-2">
                                        {/* empty = use the video just recorded (shown as the placeholder) */}
                                        <input
                                            type="text"
                                            className="w-[10rem]"
                                            value={path}
                                            placeholder={row.video ?? "No video"}
                                            title={path || row.video || "Record a video, pick one with Browse, or paste a full path"}
                                            disabled={busy}
                                            onChange={e => setPaths(p => ({ ...p, [row.serial]: e.target.value }))}
                                        />
                                        <button type="button" disabled={busy} onClick={() => handleBrowse(row.serial)}>Browse</button>
                                    </div>
                                    <button
                                        type="button"
                                        className="w-[9rem]"
                                        disabled={pending !== null || busy || (!path.trim() && !row.video)}
                                        onClick={() => handleCalibrate(row)}
                                    >
                                        {calibrateText}
                                    </button>
                                    <div className="flex gap-2" title={row.frames_used ? `${row.frames_used} frames used` : ""}>
                                        <span>RMSE:</span>
                                        <span className={`data ${row.rmse !== null ? rmseColour(row.rmse) : ""}`}>
                                            {row.rmse !== null ? `${row.rmse.toFixed(3)} px` : "--"}
                                        </span>
                                    </div>
                                </div>

                                {/* Browse: this camera's recorded intrinsic videos (a browser can't pass a local path to the server) */}
                                {browse?.serial === row.serial && (
                                    <div className="w-full flex flex-col items-start gap-1 pl-[10.5rem]">
                                        {browse.videos.length === 0 ? (
                                            <p className="text-small">No intrinsic videos for this camera yet. Record one, or paste a full path.</p>
                                        ) : browse.videos.map(v => (
                                            <button key={v.path} type="button" className="data text-small! h-[1.75rem]!"
                                                title={v.path} onClick={() => pickVideo(row.serial, v)}>
                                                {v.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}

                    {(footerText || error || failed) && (
                        <p className="text-small text-left">
                            {error || failed
                                ? <span className="text-error!">{error || status?.message}</span>
                                : footerText}
                        </p>
                    )}
                </>
            )}
        </section>
    )
}
