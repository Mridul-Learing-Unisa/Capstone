import { useEffect, useState } from 'react'
import { API, SELECTION_CHANGED } from './project-api'

// Fire this after a calibration is saved or loaded, so everything showing freshness re-checks at once.
export const CALIBRATION_CHANGED = 'calibration-changed'

// green = the current project's newest calibration is from the last 24 hours (server decides)
export type Freshness = { status: 'green' | 'orange' | 'red', age_seconds: number | null }

// "5 hours", "1 day", "3 days"
export function formatAge(seconds: number) {
    const units: [string, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
    for (const [name, size] of units) {
        const n = Math.floor(seconds / size)
        if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'}`
    }
    return 'less than a minute'
}

// The one calibration-freshness check, shared by the top bar and the Calibration tab so they always agree.
// Re-checks every minute (so the age keeps counting up), and right away when the project or calibration changes.
export function useCalibrationFreshness() {
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
        const timer = setInterval(refresh, 60_000)
        window.addEventListener(SELECTION_CHANGED, refresh)
        window.addEventListener(CALIBRATION_CHANGED, refresh)
        return () => {
            clearInterval(timer)
            window.removeEventListener(SELECTION_CHANGED, refresh)
            window.removeEventListener(CALIBRATION_CHANGED, refresh)
        }
    }, [])

    return {
        project,
        freshness,
        fresh: freshness?.status === 'green',   // same rule as the top bar's green/red dot
    }
}
