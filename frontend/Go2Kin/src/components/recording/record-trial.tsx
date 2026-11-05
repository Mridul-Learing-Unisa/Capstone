import { useState, useEffect } from "react"
import { formatTime } from "./recording-api"

type Props = {
    trialName: string
    sound: string[]                             // X, Y, Z kept as text so half-typed numbers like "-" still work
    locked: boolean                             // can't edit while recording or processing
    onTrialNameChange: (name: string) => void
    onSoundChange: (sound: string[]) => void
    startedAt: number | null                    // when recording started (ms), null if not recording
    canStart: boolean
    busy: boolean                               // waiting on the API to start or stop
    message: string                             // the hint under the button
    error: string                               // error message from the API
    onStart: () => void
    onStop: () => void
}

// "Trial Setup" box at the top left of the Recording tab
export default function RecordTrial({ trialName, sound, locked, onTrialNameChange, onSoundChange, startedAt, canStart, busy, message, error, onStart, onStop }: Props) {
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

    function changeAxis(index: number, value: string) {
        onSoundChange(sound.map((old, i) => i === index ? value : old))
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2>Record Trial</h2>
                <div className="text-small flex flex-nowrap gap-2">
                    <p>{message}</p>
                    {error && <p className="text-error">{error}</p>}
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <label className="flex items-center gap-5">
                    <span className="w-[12rem] text-right">Trial Name:</span>
                    <input
                        type="text"
                        className="data w-[15rem]"
                        value={trialName}
                        disabled={locked}
                        onChange={e => onTrialNameChange(e.target.value)}
                    />
                </label>

                <label className="flex items-center gap-5">
                    <span className="w-[12rem] text-right">Sound Source (m):</span>
                    <div className="flex gap-5">
                        {["X", "Y", "Z"].map((axis, i) => (
                            <label key={axis} className="flex items-center gap-1">
                                <span className="text-small">{axis}</span>
                                <input
                                    type="text"
                                    className="data w-14"
                                    value={sound[i]}
                                    disabled={locked}
                                    onChange={e => changeAxis(i, e.target.value)}
                                />
                            </label>
                        ))}
                    </div>
                </label>
            </div>

            <div className="flex items-center gap-5 pl-[12rem] mt-2">
                <button
                    type="button"
                    className={`button-large w-40! h-14! ${buttonColour}`}
                    disabled={busy || (!recording && !canStart)}
                    onClick={recording ? onStop : onStart}
                >
                    {recording ? "Stop" : "Record"}
                </button>
                <span className={`data !text-large font-semibold ${recording ? "text-error" : ""}`}>
                    {formatTime(recording ? elapsed : 0)}
                </span>
            </div>
        </section>
    )
}
