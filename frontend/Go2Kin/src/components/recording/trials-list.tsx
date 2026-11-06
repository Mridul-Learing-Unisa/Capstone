import { useEffect, useState } from "react"
import { getSubjects, getTrials, type Selection, type Subject, type Trial } from "./recording-api"

type Props = {
    selection: Selection
    activeTrial: string | null                  // the trial being recorded or synced right now
    refreshKey: number                          // bump this to reload the list
    selected: string[]                          // ticked trial names (for the Process button)
    onSelectedChange: (names: string[]) => void
}

// same widths for the header and every row so the columns line up
const COL = {
    check: "w-[2rem] shrink-0",
    trial: "w-[15rem] shrink-0 text-left truncate",
    date: "w-[10rem] shrink-0 text-left",
    participant: "w-[10rem] shrink-0 text-left truncate",
    status: "flex-1 text-left",
}

// "YYYY-MM-DD HH:mm", like the tkinter list
function formatDate(trial: Trial) {
    if (!trial.date) return "--"
    return `${trial.date} ${trial.time?.slice(0, 5) ?? ""}`.trim()
}

// "S01 (AB)" when the subject has initials
function formatParticipant(subjectId: string, subjects: Subject[]) {
    if (!subjectId) return "--"
    const initials = subjects.find(s => s.subject_id === subjectId)?.initials
    return initials ? `${subjectId} (${initials})` : subjectId
}

// status colours, same rules as the tkinter SessionTrialsList
function syncColour(trial: Trial, activeTrial: string | null) {
    if (trial.trial_name === activeTrial) return "bg-processing"   // recording / downloading / syncing
    return trial.synced ? "bg-success" : "bg-error"
}

function calibColour(trial: Trial) {
    return trial.calibration_file && trial.calibration_file !== "none" ? "bg-success" : "bg-disabled"
}

function procColour(trial: Trial) {
    if (trial.processed === true) return "bg-success"
    if (trial.processed === "failed") return "bg-error"
    return "bg-disabled"
}

function Dot({ colour }: { colour: string }) {
    return <span className={`inline-block w-3 h-3 rounded-full ${colour}`} />
}

// Every trial in the picked session, newest first, with a check box to pick trials to process
export default function TrialsList({ selection, activeTrial, refreshKey, selected, onSelectedChange }: Props) {
    const [trials, setTrials] = useState<Trial[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [error, setError] = useState("")
    const { project, session } = selection
    const hasSession = !!project && !!session

    useEffect(() => {
        if (!project || !session) return
        getTrials(project, session)
            .then(list => { setTrials(list); setError("") })
            .catch(e => setError((e as Error).message))
        // only needed for the participant initials, so the list still works without them
        getSubjects(project).then(setSubjects).catch(() => setSubjects([]))
    }, [project, session, refreshKey])

    const sorted = [...trials].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    const shown = hasSession ? sorted : []

    function toggle(name: string) {
        onSelectedChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name])
    }

    let emptyText = ""
    if (!hasSession) emptyText = "Pick a project and session to see its trials."
    else if (error) emptyText = error
    else if (shown.length === 0) emptyText = "No trials in this session yet."

    return (
        <section className="!bg-bg-secondary w-full min-h-0 flex flex-col gap-4">
            <div className="flex gap-2">
                <button type="button" disabled={shown.length === 0}
                    onClick={() => onSelectedChange(shown.map(t => t.trial_name))}>Select All</button>
                <button type="button" disabled={selected.length === 0}
                    onClick={() => onSelectedChange([])}>Deselect All</button>
            </div>

            <section className="flex flex-col flex-1 min-h-0 !p-0 !shadow-none overflow-hidden">
                <div className="bg-bg-tertiary flex items-center h-[2rem] shrink-0 px-[0.5rem]">
                    <span className={COL.check} />
                    <span className={COL.trial}>Trial</span>
                    <span className={COL.date}>Date</span>
                    <span className={COL.participant}>Participant</span>
                    <span className={COL.status}>Sync.</span>
                    <span className={COL.status}>Cal.</span>
                    <span className={COL.status}>Proc.</span>
                </div>

                {emptyText ? (
                    <p className={`p-[0.5rem] text-left ${error ? "text-error" : "text-small"}`}>{emptyText}</p>
                ) : (
                    <ul className="flex-1 overflow-y-auto">
                        {shown.map((trial, i) => {
                            const checked = selected.includes(trial.trial_name)
                            let rowBg = i % 2 ? "bg-bg-secondary" : ""
                            if (checked) rowBg = "bg-success/15"
                            return (
                                <li key={trial.trial_name}>
                                    {/* the whole row is the label, so clicking anywhere on it toggles the box (like tkinter) */}
                                    <label className={`flex items-center h-[2rem] px-[0.5rem] cursor-pointer hover:bg-bg-tertiary ${rowBg}`}>
                                        <span className={COL.check}>
                                            <input type="checkbox" className="accent-success cursor-pointer"
                                                checked={checked} onChange={() => toggle(trial.trial_name)} />
                                        </span>
                                        <span className={`data ${COL.trial}`} title={trial.trial_name}>{trial.trial_name}</span>
                                        <span className={COL.date}>{formatDate(trial)}</span>
                                        <span className={COL.participant}>{formatParticipant(trial.subject_id, subjects)}</span>
                                        <span className={COL.status}><Dot colour={syncColour(trial, activeTrial)} /></span>
                                        <span className={COL.status}><Dot colour={calibColour(trial)} /></span>
                                        <span className={COL.status}><Dot colour={procColour(trial)} /></span>
                                    </label>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </section>
        </section>
    )
}
