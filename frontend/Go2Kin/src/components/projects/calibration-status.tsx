<<<<<<< HEAD
import ConnectedIcon from '../icons/connected-icon'
import DisconnectedIcon from '../icons/disconnected-icon'
import { formatAge, useCalibrationFreshness } from './calibration-freshness'
=======
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import ConnectedIcon from '../icons/connected-icon'
import DisconnectedIcon from '../icons/disconnected-icon'
import CalibrationWarningModal from '../calibration/calibration-warning-modal'
import { SELECTION_CHANGED } from './project-api'

const API = 'http://localhost:8000/api/projects'
export const OPEN_CALIBRATION_WARNING = 'open-calibration-warning'

type Freshness = {
    status: 'green' | 'orange' | 'red'
    age_seconds: number | null
    age_days?: number | null
    calibration?: string | null
    label?: string
}

// "5 hours", "1 day", "3 days"
function formatAge(seconds: number) {
    const units: [string, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
    for (const [name, size] of units) {
        const n = Math.floor(seconds / size)
        if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'}`
    }
    return 'less than a minute'
}
>>>>>>> e53e591 (Calliberation tab)

// Green when the current project's latest calibration is from the last 24 hours, red/orange otherwise.
export default function CalibrationStatus() {
<<<<<<< HEAD
    const { project, freshness, fresh } = useCalibrationFreshness()
=======
    const [freshness, setFreshness] = useState<Freshness | null>(null)
    const [project, setProject] = useState<string | null>(null)
    const [isWarningOpen, setIsWarningOpen] = useState(false)
    const navigate = useNavigate()

    const isTooOld = Boolean(
        freshness &&
        freshness.age_seconds !== null &&
        (freshness.status !== 'green' || freshness.age_seconds >= 86400)
    )

    useEffect(() => {
        const refresh = async () => {
            try {
                const selection = await (await fetch(API + '/selection')).json()
                setProject(selection.project)
                if (!selection.project) {
                    setFreshness(null)
                    return
                }
                const res = await fetch(`${API}/${encodeURIComponent(selection.project)}/calibration/freshness`)
                if (res.ok) {
                    const data: Freshness = await res.json()
                    setFreshness(data)
                    // If calibration is older than 24h and hasn't been dismissed in this session, show warning
                    const isOld = data.age_seconds !== null && (data.status !== 'green' || data.age_seconds >= 86400)
                    const alreadyDismissed = sessionStorage.getItem(`calib_warning_dismissed_${selection.project}`)
                    if (isOld && !alreadyDismissed) {
                        setIsWarningOpen(true)
                    }
                } else {
                    setFreshness(null)
                }
            } catch {
                setProject(null)
                setFreshness(null)
            }
        }

        refresh()
        // Re-check every minute so the age keeps counting up, and right away when the project changes.
        const timer = setInterval(refresh, 60_000)
        window.addEventListener(SELECTION_CHANGED, refresh)

        const handleOpenWarning = () => setIsWarningOpen(true)
        window.addEventListener(OPEN_CALIBRATION_WARNING, handleOpenWarning)

        return () => {
            clearInterval(timer)
            window.removeEventListener(SELECTION_CHANGED, refresh)
            window.removeEventListener(OPEN_CALIBRATION_WARNING, handleOpenWarning)
        }
    }, [])
>>>>>>> e53e591 (Calliberation tab)

    let text = 'No project selected'
    if (project) {
        text = freshness?.age_seconds == null
            ? 'No calibration'
            : `Calibration is ${formatAge(freshness.age_seconds)} old`
    }

    const handleClick = () => {
        if (isTooOld) {
            setIsWarningOpen(true)
        } else {
            navigate('/calibration')
        }
    }

    const handleCalibrate = () => {
        setIsWarningOpen(false)
        navigate('/calibration')
    }

    const handleDismissLater = () => {
        setIsWarningOpen(false)
        if (project) {
            sessionStorage.setItem(`calib_warning_dismissed_${project}`, 'true')
        }
    }

    return (
<<<<<<< HEAD
        <div className="calibration-status">
            {fresh ? <ConnectedIcon /> : <DisconnectedIcon />}
            <span>{text}</span>
        </div>
=======
        <>
            <div
                onClick={handleClick}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && handleClick()}
                className="calibration-status hover:opacity-80 transition-opacity cursor-pointer select-none"
                title={isTooOld ? "Calibration is too old! Click to view warning" : "View Calibration"}
            >
                {freshness?.status === 'green' ? <ConnectedIcon /> : <DisconnectedIcon />}
                <span>{text}</span>
            </div>

            <CalibrationWarningModal
                isOpen={isWarningOpen}
                onClose={handleDismissLater}
                onCalibrate={handleCalibrate}
            />
        </>
>>>>>>> e53e591 (Calliberation tab)
    )
}
