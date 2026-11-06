import { useEffect, useState } from "react"
import SuccessIcon from "../icons/success-icon"
import FailIcon from "../icons/fail-icon"
import ProcessingIcon from "../icons/processing-icon"
import DisabledIcon from "../icons/disabled-icon"
import { getCameras, type Camera } from "../cameras/cameras-api"
import { BUSY, getStatus, startOriginRecord, stopOriginRecord, type CalibrationStatus } from "./calibration-api"

// button text while the server works through the steps after Stop
const STEP_TEXT: Record<string, string> = {
    downloading: "Downloading...",
    syncing: "Trimming...",       // no clap sync for origin, the videos are only trimmed
    processing: "Setting...",
}

// "Set Origin" box: record the board lying where the world origin should be -> Stop ->
// the server downloads, trims, moves the cameras into that frame and saves the calibration.
// Starts straight away (no countdown), like the tkinter tab.
export default function SetOrigin() {
    const [status, setStatus] = useState<CalibrationStatus | null>(null)
    const [cameras, setCameras] = useState<Camera[]>([])
    const [pending, setPending] = useState(false)   // waiting on start / stop
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

    const busy = !!status && BUSY.includes(status.status)
    const ours = status?.stage === "origin"
    const recording = busy && ours && status?.status === "recording"
    const working = busy && ours && !recording            // downloading / trimming / setting the origin
    const failed = ours && status?.status === "error"
    const connected = cameras.filter(c => c.status === "connected")

    // why Set Origin can't start, first problem wins (the server checks the same things)
    let blocker = ""
    if (status === null) blocker = "Can't reach the API, is the server running?"
    else if (busy && !ours) blocker = "Wait for the current calibration step to finish"
    else if (!status.has_extrinsics) blocker = "Run extrinsic calibration first"
    else if (connected.length < 2) blocker = "Connect at least 2 cameras"
    const canStart = !blocker && !busy && !pending

    // icon left of the title
    let icon = <DisabledIcon />
    // loading a file always resets origin_set on the server, so "not set" may just mean "not set this session"
    let iconTitle = "Origin not set this session (a loaded calibration may already include it)"
    if (pending || (busy && ours)) { icon = <ProcessingIcon />; iconTitle = status?.message || "Starting..." }
    else if (failed) { icon = <FailIcon />; iconTitle = status?.message ?? "" }
    else if (status?.origin_set) { icon = <SuccessIcon />; iconTitle = "Origin set" }

    async function call(action: () => Promise<unknown>) {
        setPending(true)
        setError("")
        try {
            await action()
            setStatus(await getStatus())
        } catch (e) {
            setError((e as Error).message)
        }
        setPending(false)
    }

    // the big button: green Set Origin -> red Stop -> yellow steps -> green again
    let buttonText = "Set Origin"
    let buttonColour = canStart ? "bg-success" : "bg-disabled"
    let buttonDisabled = !canStart
    let onClick = () => call(startOriginRecord)
    if (recording) {
        buttonText = "Stop"
        buttonColour = "bg-error"
        buttonDisabled = pending
        onClick = () => call(stopOriginRecord)
    } else if (working || pending) {
        buttonText = STEP_TEXT[status?.status ?? ""] ?? "Starting..."
        buttonColour = "bg-processing"
        buttonDisabled = true
    }

    // the line under the button
    let info = ""
    let infoIsError = false
    if (error || failed) { info = error || status?.message || ""; infoIsError = true }
    else if (recording) info = `${status?.message} Keep the board still and visible to all cameras for a few seconds, then press Stop`
    else if (working) info = status?.message ?? ""
    else if (blocker) info = blocker
    else if (ours && status?.status === "complete") info = status.message
    else if (!status?.origin_set) info = "Lay the board flat where the origin should be, then press Set Origin"

    return (
        <section className="flex flex-col items-start gap-[1rem] w-full">
            <div className="flex items-center gap-[0.5rem]" title={iconTitle}>
                {icon}
                <h2>Set Origin</h2>
            </div>
            <button
                type="button"
                className={`button-large w-[12rem]! ml-[16rem] ${buttonColour} ${buttonDisabled ? "cursor-not-allowed" : ""}`}
                disabled={buttonDisabled}
                onClick={onClick}
            >
                {buttonText}
            </button>
            {info && <p className={`text-small text-left ${infoIsError ? "text-error!" : ""}`}>{info}</p>}
        </section>
    )
}
