import type { Subject } from "./project-api"

// Fields kept as typed strings; converted on Confirm so a half-typed number isn't silently stored.
export type SubjectDraft = Record<"subject_id" | "initials" | "age" | "sex" | "height_m" | "mass_kg" | "notes", string>

export const EMPTY_DRAFT: SubjectDraft = {
    subject_id: "", initials: "", age: "", sex: "M", height_m: "", mass_kg: "", notes: "",
}

// Same rules as SubjectData in code/api/schemas.py. Returns the subject, or the first problem found.
export function parseDraft(d: SubjectDraft, existingIds: string[]): Subject | string {
    const subject_id = d.subject_id.trim()
    const initials = d.initials.trim()
    const age = Number(d.age)
    const height_m = Number(d.height_m)
    const mass_kg = Number(d.mass_kg)

    if (!subject_id) return "Subject ID is required"
    if (existingIds.includes(subject_id)) return `Subject already exists: ${subject_id}`
    if (!initials) return "Initials are required"
    if (d.age.trim() === "" || !Number.isInteger(age) || age < 0 || age > 120) return "Age must be a whole number from 0 to 120"
    if (d.height_m.trim() === "" || !(height_m > 0 && height_m <= 3)) return "Height must be between 0 and 3 m"
    if (d.mass_kg.trim() === "" || !(mass_kg > 0 && mass_kg <= 500)) return "Mass must be between 0 and 500 kg"

    return { subject_id, initials, age, sex: d.sex as Subject["sex"], height_m, mass_kg, notes: d.notes.trim() }
}
