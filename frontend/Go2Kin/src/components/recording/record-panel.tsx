import { useEffect, useState } from "react"
import { formatTime } from "./recording-api"

type Props = {
    startedAt: number | null   // when recording started (ms), null if not recording
    canStart: boolean
    busy: boolean              // waiting on the API to start or stop
    message: string            // the hint under the button
    error: string
    onStart: () => void
    onStop: () => void
}

// Big Record / Stop button with the timer, bottom left of the tab
export default function RecordPanel({ startedAt, canStart, busy, message, error, onStart, onStop }: Props) {
    const [elapsed, setElapsed] = useState(0)
    const recording = startedAt !== null

    // tick the timer while recording
    useEffect(() => {
        if (startedAt === null) return
        const timer = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 250)
        return () => clearInterval(timer)
    }, [startedAt])

    let buttonColour = "bg-disabled"
    if (recording) buttonColour = "bg-error"
    else if (canStart && !busy) buttonColour = "bg-success"

    return (
        <section className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-6">
                <button
                    type="button"
                    className={`button-large w-40! h-14! ${buttonColour}`}
                    disabled={busy || (!recording && !canStart)}
                    onClick={recording ? onStop : onStart}
                >
                    {recording ? "Stop" : "Record"}
                </button>
                <span className={`data text-large font-semibold ${recording ? "text-error" : ""}`}>
                    {formatTime(recording ? elapsed : 0)}
                </span>
            </div>

            <p>{message}</p>
            {error && <p className="text-error">{error}</p>}
        </section>
    )
}
