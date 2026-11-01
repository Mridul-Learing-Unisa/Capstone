import { useEffect, useState } from 'react'
import ConnectedIcon from './icons/connected-icon'
import DisconnectedIcon from './icons/disconnected-icon'
import { SELECTION_CHANGED } from './project-selector'

const API = 'http://localhost:8000/api/projects'

type Freshness = { status: 'green' | 'red', age_seconds: number | null }

// "5 hours", "1 day", "3 days"
function formatAge(seconds: number) {
    const units: [string, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
    for (const [name, size] of units) {
        const n = Math.floor(seconds / size)
        if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'}`
    }
    return 'less than a minute'
}

// Green when the current project's latest calibration is from the last 24 hours, red otherwise.
export default function CalibrationStatus() {
    const [freshness, setFreshness] = useState<Freshness | null>(null)
    const [project, setProject] = useState<string | null>(null)

    useEffect(() => {
        const refresh = async () => {
            try {
                const selection = await (await fetch(API + '/selection')).json()
                setProject(selection.project)
                if (!selection.project) { setFreshness(null); return }
                const res = await fetch(`${API}/${encodeURIComponent(selection.project)}/calibration/freshness`)
                setFreshness(res.ok ? await res.json() : null)
            } catch {
                setProject(null)
                setFreshness(null)
            }
        }
        refresh()
        // Re-check every minute so the age keeps counting up, and right away when the project changes.
        const timer = setInterval(refresh, 60_000)
        window.addEventListener(SELECTION_CHANGED, refresh)
        return () => {
            clearInterval(timer)
            window.removeEventListener(SELECTION_CHANGED, refresh)
        }
    }, [])

    let text = 'No project selected'
    if (project) {
        text = freshness?.age_seconds == null
            ? 'No calibration'
            : `Calibration is ${formatAge(freshness.age_seconds)} old`
    }

    return (
        <div className="calibration-status">
            {freshness?.status === 'green' ? <ConnectedIcon /> : <DisconnectedIcon />}
            <span>{text}</span>
        </div>
    )
}