import { useEffect, useState } from 'react'
import DownArrowIcon from './icons/down-arrow-icon'
import { SELECTION_CHANGED } from './project-selector'

const API = 'http://localhost:8000/api/projects'

export default function SubjectSelector() {
    // The subject currently selected on the server (not last_participant saved in go2kin_config.json)
    const [subjectId, setSubjectId] = useState<string | null>(null)

    useEffect(() => {
        const refresh = () => fetch(API + '/selection')
            .then(r => r.json())
            .then(sel => setSubjectId(sel.subject_id ?? null))
            .catch(() => setSubjectId(null))
        refresh()
        window.addEventListener(SELECTION_CHANGED, refresh)
        return () => window.removeEventListener(SELECTION_CHANGED, refresh)
    }, [])

    return (
        <button className="subject-selector w-[12.5rem]">
            
            <h2>{subjectId ?? 'No subject'}</h2>
            <span className="ml-auto">
                <DownArrowIcon />
            </span>
        </button>
    )
}
