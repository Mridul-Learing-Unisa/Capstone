import { useEffect, useState } from "react"
import SubjectIcon from "../icons/subject-icon"
import SubjectForm from "./subject-form"
import { EMPTY_DRAFT, parseDraft, type SubjectDraft } from "./subject-draft"
import { request, SELECTION_CHANGED, type Selection, type Subject } from "./project-api"

// Lets the user pick an existing subject of the current project, or create a new one. Only Confirm / Cancel close it.
// A new subject is only created on Confirm, so Cancel leaves nothing behind.
export default function SubjectDialog({ current, onClose }: { current: Selection | null, onClose: () => void }) {
    const project = current?.project ?? null

    const [subjects, setSubjects] = useState<Subject[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(current?.subject_id ?? null)
    const [isNew, setIsNew] = useState(false)  // right-hand side shows the new-subject form
    const [draft, setDraft] = useState<SubjectDraft>(EMPTY_DRAFT)

    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!project) return
        request(`/${encodeURIComponent(project)}/subjects`)
            .then(d => setSubjects(d.subjects ?? []))
            .catch(e => setError(e.message))
    }, [project])

    const parsed = isNew ? parseDraft(draft, subjects.map(s => s.subject_id)) : null
    const selected = subjects.find(s => s.subject_id === selectedId) ?? null
    const canConfirm = !!project && !busy && (isNew ? typeof parsed !== "string" : !!selectedId)

    function chooseExisting(id: string) {
        setIsNew(false)
        setSelectedId(id)
    }

    async function confirm() {
        if (!project || !canConfirm) return
        setBusy(true)
        setError(null)
        try {
            let subjectId = selectedId
            if (isNew && parsed && typeof parsed !== "string") {
                await request(`/${encodeURIComponent(project)}/subjects`, "POST", parsed)
                // Now real: a retry after a later failure selects it instead of re-creating it
                setSubjects(list => [...list, parsed])
                setIsNew(false)
                setSelectedId(parsed.subject_id)
                setDraft(EMPTY_DRAFT)
                subjectId = parsed.subject_id
            }
            await request("/selection", "POST", { subject_id: subjectId })
            window.dispatchEvent(new Event(SELECTION_CHANGED))
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            {/* Blocks clicks on the rest of the page; deliberately does not close the dialog */}
            <div className="fixed inset-0 z-[998] bg-black/10" />

            <section className="absolute top-[3rem] left-0 w-[38rem] h-[27.5rem] z-[999] flex flex-col gap-4 text-left">
                {!project ? (
                    <p>Choose a project first.</p>
                ) : (
                    <div className="grid grid-cols-2 gap-[1rem]">
                        {/* Existing subjects */}
                        <div className="flex flex-col gap-[0.5rem]">
                            <h2>Subject</h2>
                            <ul className="w-[15rem] h-[15rem] overflow-y-auto rounded-[0.3rem] border border-disabled bg-bg-secondary">
                                {subjects.length === 0 && <li className="text-small p-2">No subjects yet</li>}
                                {subjects.map(s => (
                                    <li key={s.subject_id}>
                                        <button
                                            className={`flex w-full items-center gap-2 px-2 py-1 hover:bg-bg-tertiary disabled:cursor-default ${!isNew && s.subject_id === selectedId ? "bg-bg-tertiary" : ""}`}
                                            onClick={() => chooseExisting(s.subject_id)}
                                            disabled={busy}
                                        >
                                            <SubjectIcon />
                                            <span className="truncate">{s.subject_id}</span>
                                            <span className="text-small ml-auto">{s.initials}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <button
                                type="button"
                                onClick={() => setIsNew(true)}
                                disabled={busy || isNew}
                                className="w-[15rem]"
                            >
                                New subject
                            </button>
                        </div>

                        {/* New-subject form, or details of the chosen subject */}
                        <div className="flex flex-col gap-[0.5rem]">
                            <h2>{isNew ? "New subject" : "Details"}</h2>
                            {isNew ? (
                                <>
                                    <SubjectForm draft={draft} onChange={setDraft} disabled={busy} />
                                    {typeof parsed === "string" && <p className="text-small">{parsed}</p>}
                                </>
                            ) : selected ? (
                                <SubjectDetails subject={selected} />
                            ) : (
                                <p className="text-small">Choose a subject, or create a new one.</p>
                            )}
                        </div>
                    </div>
                )}

                {error && <p className="text-error">{error}</p>}

                <div className="mt-auto flex justify-end gap-[1rem]">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="border-none bg-error text-bg-main"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirm}
                        disabled={!canConfirm}
                        className="border-none bg-success text-bg-main"
                    >
                        Confirm
                    </button>
                </div>
            </section>
        </>
    )
}

// Read-only summary of an existing subject.
function SubjectDetails({ subject }: { subject: Subject }) {
    const rows: [string, string | number][] = [
        ["Subject ID", subject.subject_id],
        ["Initials", subject.initials],
        ["Age", subject.age],
        ["Sex", subject.sex],
        ["Height (m)", subject.height_m],
        ["Mass (kg)", subject.mass_kg],
        ["Notes", subject.notes || "—"],
    ]
    return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-[1rem] gap-y-[0.5rem]">
            {rows.map(([label, value]) => (
                <div key={label} className="contents">
                    <dt className="text-text-secondary">{label}</dt>
                    <dd className="data break-words">{value}</dd>
                </div>
            ))}
        </dl>
    )
}
