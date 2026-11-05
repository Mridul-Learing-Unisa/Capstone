import { useEffect, useState } from 'react'
import DownArrowIcon from '../icons/down-arrow-icon'
import SubjectIcon from '../icons/subject-icon'
import SubjectDialog from './subject-dialog'
import { API, SELECTION_CHANGED, type Selection } from './project-api'

export default function SubjectSelector() {
    // The selection currently open on the server (not last_participant saved in go2kin_config.json)
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

    // Open subject dialog when button gets clicked
    const [isOpened, setIsOpened] = useState<boolean>(false)

    return (
        <div className="relative">
            <button
                className="subject-selector w-[12.5rem]"
                onClick={() => setIsOpened(true)}
            >
                <SubjectIcon />
                <h2>{selection?.subject_id ?? 'No subject'}</h2>
                <span className="ml-auto">
                    <DownArrowIcon />
                </span>
            </button>

            {/* Subject dialog */}
            {isOpened && (
                <SubjectDialog
                    current={selection}
                    onClose={() => setIsOpened(false)}
                />
            )}
        </div>
    )
}
