import { useEffect, useRef, useState } from "react"
import type { Selection } from "../recording/recording-api"
import {
    ACTIVE_STATES, getProcessingStatus, startProcessing, stopProcessing,
    type ProcessingStatus, type StepStatus,
} from "./processing-api"

type Props = {
    selection: Selection
    selected: string[]              // trials ticked in the trials list
    onFinished: () => void          // called when a run ends, so the list can reload its "processed" dots
}

// same colours as the dots in the trials list
const STEP_COLOUR: Record<StepStatus, string> = {
    pending: "bg-disabled",
    processing: "bg-processing",
    complete: "bg-success",
    failed: "bg-error",
    cancelled: "bg-disabled",
}

// "Process Trials" box on the Recording tab: runs Pose2Sim on the ticked trials, one after another
export default function ProcessTrials({ selection, selected, onFinished }: Props) {
    const [status, setStatus] = useState<ProcessingStatus | null>(null)
    const [busy, setBusy] = useState(false)         // waiting on start / stop
    const [error, setError] = useState("")
    const [apiDown, setApiDown] = useState(false)
    const wasRunning = useRef(false)

    const { project, session } = selection
    const running = status !== null && ACTIVE_STATES.includes(status.state)
    const stopping = status?.state === "stopping"

    // check the server on load (so a page refresh doesn't lose a run), then every second while one is going
    useEffect(() => {
        let stale = false
        async function poll() {
            try {
                const latest = await getProcessingStatus()
                if (stale) return
                setStatus(latest)
                setApiDown(false)
            } catch {
                if (!stale) setApiDown(true)
            }
        }
        poll()
        if (!running) return () => { stale = true }
        const timer = setInterval(poll, 1000)
        return () => { stale = true; clearInterval(timer) }
    }, [running])

    // a run just ended: tell the parent so the trials list picks up the new "processed" flags
    useEffect(() => {
        if (wasRunning.current && !running) onFinished()
        wasRunning.current = running
    }, [running, onFinished])

    async function handleStart() {
        if (!project || !session) return
        setBusy(true)
        setError("")
        try {
            await startProcessing(project, session, selected)
            setStatus(await getProcessingStatus())
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy(false)
    }

    async function handleStop() {
        setBusy(true)
        setError("")
        try {
            await stopProcessing()
            setStatus(await getProcessingStatus())
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy(false)
    }

    const hasSession = !!project && !!session
    const trials = status?.trials ?? []
    const failed = trials.filter(t => t.status === "failed" || t.status === "skipped")
    const done = trials.filter(t => t.status === "complete").length

    // work out the hint next to the heading, first problem wins
    let message = ""
    let canStart = false
    if (busy) message = running ? "Stopping..." : "Starting..."
    else if (stopping) message = "Stopping, waiting for the current step to end..."
    else if (running && status?.current_trial) {
        const { index, total, name } = status.current_trial
        message = `Trial ${index + 1}/${total}: ${name}`
        if (status.current_step) message += ` - ${status.current_step.name}`
    } else if (apiDown) message = "Can't reach the API, is the server running?"
    else if (!hasSession) message = "Pick a project and session first"
    else if (selected.length === 0) message = "Tick the trials to process"
    else {
        canStart = true
        message = `${selected.length} trial(s) selected`
    }

    // result of the last run, shown while idle
    let summary = ""
    if (!running && status && status.state !== "idle" && trials.length > 0) {
        if (status.state === "cancelled") summary = `Cancelled: ${done}/${trials.length} trial(s) finished`
        else summary = `Last run: ${done}/${trials.length} trial(s) processed`
    }

    // grey while waiting on the API, red to stop, green when ready
    let buttonColour = "bg-disabled"
    let buttonText = "Process"
    if (running) {
        buttonText = stopping ? "Stopping..." : "Stop"
        buttonColour = "bg-error"
    } else if (busy) buttonText = "Starting..."
    else if (canStart) buttonColour = "bg-success"

    const showSteps = running || (status !== null && status.state !== "idle")

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
                <h2>Process Trials</h2>
                <div className="text-small flex flex-wrap justify-end gap-x-2 text-right">
                    <p>{message}</p>
                    {error && <p className="text-error">{error}</p>}
                </div>
            </div>

            <div className="flex items-center gap-4">
                <button
                    type="button"
                    className={`button-large disabled:cursor-not-allowed ${buttonColour}`}
                    disabled={busy || stopping || (!running && !canStart)}
                    onClick={running ? handleStop : handleStart}
                >
                    {buttonText}
                </button>

                {showSteps && (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-left">
                        {(status?.steps ?? []).map(step => (
                            <li key={step.name} className="flex items-center gap-1">
                                <span className={`inline-block w-3 h-3 rounded-full ${STEP_COLOUR[step.status] ?? "bg-disabled"}`} />
                                {step.name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {(summary || failed.length > 0) && (
                <div className="text-small text-left flex flex-col gap-1">
                    {summary && <p>{summary}</p>}
                    {!running && failed.map(t => (
                        <p key={t.name} className="text-error">
                            <span className="data">{t.name}</span>: {t.error ?? t.status}
                        </p>
                    ))}
                </div>
            )}
        </section>
    )
}
