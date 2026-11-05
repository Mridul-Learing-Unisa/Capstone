import type { SubjectDraft } from "./subject-draft"

type SubjectFormProps = {
    draft: SubjectDraft
    onChange: (draft: SubjectDraft) => void
    disabled?: boolean
}

// Input fields for a new subject.
export default function SubjectForm({ draft, onChange, disabled }: SubjectFormProps) {
    const set = (key: keyof SubjectDraft) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...draft, [key]: e.target.value })

    return (
        <div className="flex flex-col gap-[1rem]">
            <div className="flex items-center">
                <label htmlFor="subject-id" className="w-[6rem]">Subject ID</label>
                <input
                    id="subject-id"
                    type="text"
                    value={draft.subject_id}
                    onChange={set("subject_id")}
                    disabled={disabled}
                    className="w-[11rem]"
                />
            </div>

            <div className="flex items-center">
                <label htmlFor="subject-initials" className="w-[6rem]">Initials</label>
                <input
                    id="subject-initials"
                    type="text"
                    value={draft.initials}
                    onChange={set("initials")}
                    disabled={disabled}
                    className="w-[11rem]"
                />
            </div>

            <div className="flex justify-between">
                <div className="flex items-center">
                    <label htmlFor="subject-age" className="w-[2.5rem]">Age</label>
                    <input
                        id="subject-age"
                        type="text"
                        inputMode="numeric"
                        value={draft.age}
                        onChange={set("age")}
                        disabled={disabled}
                        className="w-[4rem]"
                    />
                </div>

                <div className="flex items-center">
                    <label htmlFor="subject-sex" className="w-[2.5rem]">Sex</label>
                    <select id="subject-sex" value={draft.sex} onChange={set("sex")} disabled={disabled}>
                        <option value="M">M</option>
                        <option value="F">F</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
            </div>

            <div className="flex items-center">
                <label htmlFor="subject-height" className="w-[6rem]">Height (m)</label>
                <input
                    id="subject-height"
                    type="text"
                    inputMode="decimal"
                    value={draft.height_m}
                    onChange={set("height_m")}
                    disabled={disabled}
                    className="w-[11rem]"
                />
            </div>

            <div className="flex items-center">
                <label htmlFor="subject-mass" className="w-[6rem]">Mass (kg)</label>
                <input
                    id="subject-mass"
                    type="text"
                    inputMode="decimal"
                    value={draft.mass_kg}
                    onChange={set("mass_kg")}
                    disabled={disabled}
                    className="w-[11rem]"
                />
            </div>

            <div className="flex items-center">
                <label htmlFor="subject-notes" className="w-[6rem]">Notes</label>
                <input
                    id="subject-notes"
                    type="text"
                    value={draft.notes}
                    onChange={set("notes")}
                    disabled={disabled}
                    className="w-[11rem]"
                />
            </div>
        </div>
    )
}
