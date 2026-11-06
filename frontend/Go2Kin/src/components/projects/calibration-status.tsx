import ConnectedIcon from '../icons/connected-icon'
import DisconnectedIcon from '../icons/disconnected-icon'
import { formatAge, useCalibrationFreshness } from './calibration-freshness'

// Green when the current project's latest calibration is from the last 24 hours, red otherwise.
export default function CalibrationStatus() {
    const { project, freshness, fresh } = useCalibrationFreshness()

    let text = 'No project selected'
    if (project) {
        text = freshness?.age_seconds == null
            ? 'No calibration'
            : `Calibration is ${formatAge(freshness.age_seconds)} old`
    }

    return (
        <div className="calibration-status">
            {fresh ? <ConnectedIcon /> : <DisconnectedIcon />}
            <span>{text}</span>
        </div>
    )
}
