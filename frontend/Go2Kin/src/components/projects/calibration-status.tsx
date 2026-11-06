import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import ConnectedIcon from '../icons/connected-icon'
import DisconnectedIcon from '../icons/disconnected-icon'
import CalibrationWarningModal from '../calibration/calibration-warning-modal'
import { formatAge, useCalibrationFreshness } from './calibration-freshness'

export const OPEN_CALIBRATION_WARNING = 'open-calibration-warning'

// Green when the current project's latest calibration is from the last 24 hours, red/orange otherwise.
export default function CalibrationStatus() {
    const { project, freshness, fresh } = useCalibrationFreshness()
    const [isWarningOpen, setIsWarningOpen] = useState(false)
    const navigate = useNavigate()

    const isTooOld = Boolean(
        freshness &&
        freshness.age_seconds !== null &&
        (!fresh || freshness.age_seconds >= 86400)
    )

    useEffect(() => {
        if (!project || !freshness) return
        const isOld = freshness.age_seconds !== null && (!fresh || freshness.age_seconds >= 86400)
        const alreadyDismissed = sessionStorage.getItem(`calib_warning_dismissed_${project}`)
        if (isOld && !alreadyDismissed) {
            setIsWarningOpen(true)
        }
    }, [project, freshness, fresh])

    useEffect(() => {
        const handleOpenWarning = () => setIsWarningOpen(true)
        window.addEventListener(OPEN_CALIBRATION_WARNING, handleOpenWarning)
        return () => window.removeEventListener(OPEN_CALIBRATION_WARNING, handleOpenWarning)
    }, [])

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
        <>
            <div
                onClick={handleClick}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && handleClick()}
                className="calibration-status hover:opacity-80 transition-opacity cursor-pointer select-none"
                title={isTooOld ? "Calibration is too old! Click to view warning" : "View Calibration"}
            >
                {fresh ? <ConnectedIcon /> : <DisconnectedIcon />}
                <span>{text}</span>
            </div>

            <CalibrationWarningModal
                isOpen={isWarningOpen}
                onClose={handleDismissLater}
                onCalibrate={handleCalibrate}
            />
        </>
    )
}
