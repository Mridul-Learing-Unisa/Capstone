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
    const [now, setNow] = useState(() => Date.now())
    const recording = startedAt !== null
    // "now" is left over from the last take until the first tick, so clamp to 0 instead of flashing the old time
    const elapsed = recording ? Math.max(0, now - startedAt) : 0

    // tick the timer while recording
    useEffect(() => {
        if (startedAt === null) return
        const timer = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(timer)
    }, [startedAt])

    // grey while waiting on the API, red to stop, green when ready to record
    let buttonColour = "bg-disabled"
    let buttonText = recording ? "Stop" : "Record"
    if (busy) buttonText = recording ? "Stopping..." : "Starting..."
    else if (recording) buttonColour = "bg-error"
    else if (canStart) buttonColour = "bg-success"

    function changeAxis(index: number, value: string) {
        onSoundChange(sound.map((old, i) => i === index ? value : old))
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2>Record Trial</h2>
                <div className="text-small flex flex-wrap justify-end gap-x-2 text-right">
                    <p>{message}</p>
                    {error && <p className="text-error">{error}</p>}
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <label className="flex items-center gap-4">
                    <span className="w-[12rem] text-right">Trial Name:</span>
                    <input
                        type="text"
                        className="data w-[15rem]"
                        value={trialName}
                        disabled={locked}
                        onChange={e => onTrialNameChange(e.target.value)}
                    />
                </label>

                {/* div, not label: it holds three labelled inputs and labels can't be nested */}
                <div className="flex items-center gap-4">
                    <span className="w-[12rem] text-right">Sound Source (m):</span>
                    <div className="flex gap-4">
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
                </div>
            </div>

            <div className="flex items-center gap-4 ml-[12rem] mb-[1rem] mt-2">
                <button
                    type="button"
                    className={`button-large disabled:cursor-not-allowed ${buttonColour}`}
                    disabled={busy || (!recording && !canStart)}
                    onClick={recording ? onStop : onStart}
                >
                    {buttonText}
                </button>
                <span className={`data !text-large font-semibold ${recording ? "text-error" : ""}`}>
                    {formatTime(elapsed)}
                </span>
            </div>
        </section>
    )
}
