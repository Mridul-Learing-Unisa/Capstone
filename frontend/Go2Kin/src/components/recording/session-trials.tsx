import { useEffect, useState } from "react"
import { getTrials, type Selection, type Trial } from "./recording-api"

type Props = {
    selection: Selection
    activeTrial: string | null   // the trial being recorded or synced right now
    refreshKey: number           // bump this to reload the list
}

// "Session Trials" box: every trial in the picked session with a coloured status dot
export default function SessionTrials({ selection, activeTrial, refreshKey }: Props) {
    const [trials, setTrials] = useState<Trial[]>([])
    const [error, setError] = useState("")
    const { project, session } = selection

    useEffect(() => {
        if (!project || !session) return
        getTrials(project, session)
            .then(list => { setTrials(list); setError("") })
            .catch(e => setError((e as Error).message))
    }, [project, session, refreshKey])

    // newest at the top
    const sorted = [...trials].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))

    function dotColour(trial: Trial) {
        if (trial.trial_name === activeTrial) return "bg-processing"
        return trial.synced ? "bg-success" : "bg-error"
    }

    return (
        <section className="flex-1 flex flex-col gap-3 min-h-0">
            <h2 className="text-large">Session Trials</h2>

            {!project || !session ? (
                <p className="text-small">Pick a project and session to see its trials.</p>
            ) : error ? (
                <p className="text-error">{error}</p>
            ) : sorted.length === 0 ? (
                <p className="text-small">No trials in this session yet.</p>
            ) : (
                <ul className="flex flex-col gap-2 overflow-y-auto">
                    {sorted.map(trial => (
                        <li key={trial.trial_name} className="flex items-center gap-3">
                            <span className={`w-3 h-3 rounded-full shrink-0 ${dotColour(trial)}`} />
                            <span className="data flex-1 truncate">{trial.trial_name}</span>
                            <span className="text-small">{trial.time} · {trial.cameras_used.length} cams</span>
                        </li>
                    ))}
                </ul>
            )}

            <p className="text-small mt-auto">Green = synced, yellow = working on it, red = not synced</p>
        </section>
    )
}
