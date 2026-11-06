import { useEffect, useState } from "react"
import SuccessIcon from "../icons/success-icon"
import FailIcon from "../icons/fail-icon"
import ProcessingIcon from "../icons/processing-icon"
import DisabledIcon from "../icons/disabled-icon"
import { getCameras, type Camera } from "../cameras/cameras-api"
import { CALIBRATION_CHANGED, formatAge, useCalibrationFreshness } from "../projects/calibration-freshness"
import {
    BUSY, getStatus, startExtrinsicRecord, stopExtrinsicRecord, type CalibrationStatus,
} from "./calibration-api"

// tkinter counts down 5s before an extrinsic recording; the last value used is remembered in the browser
const DELAY_KEY = "go2kin.extrinsicRecordDelay"
const DEFAULT_DELAY = "5"

// button text while the server works through the steps after Stop
const STEP_TEXT: Record<string, string> = {
    downloading: "Downloading...",
    syncing: "Syncing...",
    processing: "Calibrating...",
}

// "Extrinsic Calibration" box: countdown -> record all cameras (clap twice) -> Stop ->
// the server downloads, audio-syncs, calibrates and saves the calibration on its own.
export default function ExtrinsicCalibration() {
    const [status, setStatus] = useState<CalibrationStatus | null>(null)
    const [cameras, setCameras] = useState<Camera[]>([])
    const { freshness, fresh } = useCalibrationFreshness()   // the top bar's check, so the two always agree
    const [delay, setDelay] = useState(() => localStorage.getItem(DELAY_KEY) ?? DEFAULT_DELAY)
    const [countdown, setCountdown] = useState<number | null>(null)   // seconds left before recording starts
    const [pending, setPending] = useState(false)                      // waiting on start / stop
    const [error, setError] = useState("")

    // calibration status every second, cameras every 3s like the footer
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

    // a calibration was just saved (or loaded): tell the top bar and this panel to re-check its age now
    const loadedFile = status?.loaded_file
    useEffect(() => {
        if (loadedFile) window.dispatchEvent(new Event(CALIBRATION_CHANGED))
    }, [loadedFile])

    // count down once a second, then start recording on every connected camera
    useEffect(() => {
        if (countdown === null) return
        const timer = setTimeout(() => {
            if (countdown > 1) { setCountdown(countdown - 1); return }
            setCountdown(null)
            setPending(true)
            startExtrinsicRecord()
                .catch(e => setError((e as Error).message))
                .finally(() => setPending(false))
        }, 1000)
        return () => clearTimeout(timer)
    }, [countdown])

    const busy = !!status && BUSY.includes(status.status)
    const ours = status?.stage === "extrinsic"
    const recording = busy && ours && status?.status === "recording"
    const working = busy && ours && !recording            // downloading / syncing / calibrating
    const failed = ours && status?.status === "error"
    const report = status?.extrinsic ?? null
    const tooOld = status?.has_extrinsics && !fresh

    // why Calibrate can't start, first problem wins (the server checks the same things)
    const connected = cameras.filter(c => c.status === "connected")
    const noIntrinsics = connected.filter(c => !status?.intrinsics.find(r => r.serial === c.serial)?.calibrated)
    const delaySeconds = Number(delay)
    const delayOk = delay.trim() !== "" && Number.isInteger(delaySeconds) && delaySeconds >= 0 && delaySeconds <= 60
    let blocker = ""
    if (status === null) blocker = "Can't reach the API, is the server running?"
    else if (busy && !ours) blocker = "Wait for the current calibration step to finish"
    else if (connected.length < 2) blocker = "Connect at least 2 cameras"
    else if (noIntrinsics.length > 0) blocker = `Run intrinsic calibration first for ${noIntrinsics.map(c => c.name).join(", ")}`
    else if (!delayOk) blocker = "Record delay must be a whole number of seconds from 0 to 60"
    const canStart = !blocker && !busy && countdown === null && !pending

    // icon left of the title
    let icon = <DisabledIcon />
    let iconTitle = "No extrinsic calibration yet"
    if (countdown !== null || (busy && ours)) { icon = <ProcessingIcon />; iconTitle = status?.message || "Starting..." }
    else if (failed) { icon = <FailIcon />; iconTitle = status?.message ?? "" }
    else if (tooOld) {
        icon = <FailIcon />
        iconTitle = freshness?.age_seconds != null
            ? `Calibration is ${formatAge(freshness.age_seconds)} old, recalibrate`
            : "No saved calibration in this project"
    }
    else if (status?.has_extrinsics) { icon = <SuccessIcon />; iconTitle = "Calibrated today" }

    // the big button: green Calibrate -> yellow countdown -> red Stop -> yellow steps -> green again
    let buttonText = "Calibrate"
    let buttonColour = canStart ? "bg-success" : "bg-disabled"
    let buttonDisabled = !canStart
    let onClick = () => {
        localStorage.setItem(DELAY_KEY, String(delaySeconds))
        setError("")
        if (delaySeconds === 0) setCountdown(1)   // the effect starts recording after its first tick
        else setCountdown(delaySeconds)
    }
    if (countdown !== null) {
        buttonText = `Starting ${countdown}`
        buttonColour = "bg-processing"
        buttonDisabled = false
        onClick = () => setCountdown(null)   // click again to cancel
    } else if (recording) {
        buttonText = "Stop"
        buttonColour = "bg-error"
        buttonDisabled = pending
        onClick = () => {
            setPending(true)
            setError("")
            stopExtrinsicRecord()
                .catch(e => setError((e as Error).message))
                .finally(() => setPending(false))
        }
    } else if (working || (pending && ours)) {
        buttonText = STEP_TEXT[status?.status ?? ""] ?? "Starting..."
        buttonColour = "bg-processing"
        buttonDisabled = true
    } else if (pending) {
        buttonText = "Starting..."
        buttonColour = "bg-processing"
        buttonDisabled = true
    }

    // the line under the button
    let info = ""
    let infoIsError = false
    if (error || failed) {
        infoIsError = true
        info = error || status?.message || ""
        if (!error && status?.sync_issue?.reasons.length) info = `Audio sync rejected, please re-record: ${status.sync_issue.reasons.join("; ")}`
    } else if (countdown !== null) info = "Get the board ready. Click the button again to cancel"
    else if (recording) info = `${status?.message} Clap twice near the centre of the camera volume, then press Stop`
    else if (working) info = status?.message ?? ""
    else if (blocker) info = blocker
    else if (report) {
        const parts = [report.rmse !== null ? `RMSE: ${report.rmse.toFixed(3)} px` : "Loaded from file", `${report.n_cameras} cameras`]
        if (report.n_points !== null) parts.push(`${report.n_points} points`)
        if (freshness?.age_seconds != null) parts.push(`${formatAge(freshness.age_seconds)} old`)
        info = parts.join(" · ")
        infoIsError = !!tooOld
    }

    // RMSE colour, same bands as tkinter (green < 1px, yellow < 2px, red above).
    // Full class names (with ! to beat .text-small's colour) so Tailwind can find them.
    const levelColour = { green: "text-success!", amber: "text-processing!", red: "text-error!" }
    const infoColour = infoIsError ? "text-error!" : report && !blocker && !busy ? levelColour[report.level] : ""

    return (
        <section className="flex flex-col items-start gap-[1rem] w-full">
            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-[0.5rem]" title={iconTitle}>
                    {icon}
                    <h2>Extrinsic Calibration</h2>
                </div>
                <div>
                    {info && <p className={`text-small ${infoColour}`}>{info}</p>}
                </div>
            </div>
            <div className="flex items-center">
                <label className="flex items-center gap-2 w-[16rem]">
                    Record Delay (s):
                    <input
                        type="text"
                        inputMode="numeric"
                        className="data w-[4rem]"
                        value={delay}
                        disabled={countdown !== null || busy}
                        onChange={e => setDelay(e.target.value)}
                    />
                </label>
                <button
                    type="button"
                    className={`button-large w-[12rem]! ${buttonColour} ${buttonDisabled ? "cursor-not-allowed" : ""}`}
                    disabled={buttonDisabled}
                    onClick={onClick}
                >
                    {buttonText}
                </button>
            </div>
        </section>
    )
}
