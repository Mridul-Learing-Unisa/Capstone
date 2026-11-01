import { useEffect, useState } from 'react'
import DownArrowIcon from './icons/down-arrow-icon'
import FolderIcon from './icons/folder-icon'

const API = 'http://localhost:8000/api/projects'

// Fired after anything changes the server-side selection, so the selector re-reads it.
export const SELECTION_CHANGED = 'selection-changed'

type Selection = { project: string | null, session: string | null }

export default function ProjectSelector() {
    // The selection currently open on the server (not the last_project/last_session saved in go2kin_config.json)
    const [selection, setSelection] = useState<Selection | null>(null)

    useEffect(() => {
        const refresh = () => fetch(API + '/selection')
            .then(r => r.json())
            .then(setSelection)
            .catch(() => setSelection(null))
        refresh()
        window.addEventListener(SELECTION_CHANGED, refresh)
        return () => window.removeEventListener(SELECTION_CHANGED, refresh)
    }, [])

    return (
        <button className="project-selector w-[22.5rem]">
            <FolderIcon />
            <h2>{selection?.project ?? 'No project'}</h2>
            <span>/</span>
            <FolderIcon />
            <h2>{selection?.session ?? 'No session'}</h2>
            <span className="ml-auto">
                <DownArrowIcon />
            </span>
        </button>
    )
}
