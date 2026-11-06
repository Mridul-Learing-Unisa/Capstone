import { useRef, useState } from "react"
import SuccessIcon from "../icons/success-icon"
import ProcessingIcon from "../icons/processing-icon"
import DisabledIcon from "../icons/disabled-icon"
import QualityModal from "./quality-modal"
import {
    startExtrinsicRecord,
    stopExtrinsicRecord,
    type CalibrationStatus,
} from "./calibration-api"

type ExtrinsicCardProps = {
    status: CalibrationStatus | null
    onReload: () => void
}

const BUSY_STATES = ["recording", "downloading", "syncing", "processing"]

export default function ExtrinsicCard({ status, onReload }: ExtrinsicCardProps) {
    const [delay, setDelay] = useState("0.0")
    const [countdown, setCountdown] = useState<number | null>(null)
    const [showQualityModal, setShowQualityModal] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const isRecording = status?.status === "recording" && status?.recording?.type === "extrinsic"
    const isBusy = status !== null && BUSY_STATES.includes(status.status) && !isRecording
    const hasExtrinsics = !!status?.has_extrinsics || (status?.extrinsic !== null && status?.extrinsic !== undefined)

    const handleStartCalibration = () => {
        setActionError(null)
        const delaySec = Math.max(0, parseFloat(delay) || 0)

        if (delaySec === 0) {
            startExtrinsicRecord()
                .then(onReload)
                .catch(e => setActionError(e instanceof Error ? e.message : String(e)))
            return
        }

        setCountdown(Math.ceil(delaySec))
        timerRef.current = setInterval(() => {
            setCountdown(prev => {
                if (!prev || prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current)
                    timerRef.current = null
                    startExtrinsicRecord()
                        .then(onReload)
                        .catch(e => setActionError(e instanceof Error ? e.message : String(e)))
                    return null
                }
                return prev - 1
            })
        }, 1000)
    }

    const handleCancelCountdown = () => {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        setCountdown(null)
    }

    const handleStopRecording = () => {
        setActionError(null)
        stopExtrinsicRecord()
            .then(onReload)
            .catch(e => setActionError(e instanceof Error ? e.message : String(e)))
    }

    const handleActionClick = () => {
        if (countdown !== null) {
            handleCancelCountdown()
        } else if (isRecording) {
            handleStopRecording()
        } else {
            handleStartCalibration()
        }
    }

    // Determine status icon
    const icon = isBusy || isRecording ? (
        <ProcessingIcon />
    ) : hasExtrinsics ? (
        <SuccessIcon />
    ) : (
        <DisabledIcon />
    )

    // Button label and styles
    let buttonLabel = "Process"
    let buttonBg = "bg-[#00BE13] text-white hover:opacity-90"

    if (countdown !== null) {
        buttonLabel = `Cancel (${countdown}s)`
        buttonBg = "bg-[#F83F23] text-white hover:opacity-90"
    } else if (isRecording) {
        buttonLabel = "STOP"
        buttonBg = "bg-[#F83F23] text-white animate-pulse"
    } else if (isBusy) {
        buttonLabel = "Processing"
        buttonBg = "bg-[#E8BC38] text-white cursor-wait"
    }

    return (
        <>
            <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-xs p-4 flex flex-col gap-3 text-left">
                {/* Header */}
                <div className="flex items-center gap-3">
                    {icon}
                    <div>
                        <h4 className="font-semibold text-sm text-[#121212]">Extrinsic Calibration</h4>
                        <span className="text-xs text-[#666666]">
                            Tip: clap near the centre of the camera volume
                        </span>
                    </div>
                </div>

                {actionError && (
                    <div className="p-2 text-xs bg-red-100 border border-red-300 text-red-800 rounded">
                        {actionError}
                    </div>
                )}

                {/* Controls row */}
                <div className="flex flex-wrap items-center gap-4 pt-1">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-[#666666] font-medium">Record Delay (s):</span>
                        <input
                            type="number"
                            step={0.5}
                            min={0}
                            value={delay}
                            disabled={countdown !== null || isRecording || isBusy}
                            onChange={e => setDelay(e.target.value)}
                            className="w-16 bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1 text-center font-mono text-xs"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={handleActionClick}
                        disabled={!status?.can_extrinsic && !isRecording && countdown === null}
                        className={`min-w-[110px] px-5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 ${buttonBg}`}
                    >
                        {buttonLabel}
                    </button>

                    <button
                        type="button"
                        onClick={() => setShowQualityModal(true)}
                        className="px-4 py-2 bg-white border border-[#BBBBBB] rounded-lg text-xs font-medium text-[#121212] hover:bg-gray-100 shadow-xs cursor-pointer"
                    >
                        Check Quality
                    </button>
                </div>

                {/* Progress / Status feedback */}
                {status?.message && status.stage === "extrinsic" && (
                    <p className="text-xs text-[#666666] italic bg-white/70 p-2 rounded border border-[#BBBBBB]">
                        {status.message}
                    </p>
                )}

                {status?.extrinsic && !isBusy && !isRecording && (
                    <div className="text-xs text-[#666666] flex items-center gap-2">
                        <span
                            className={`w-2 h-2 rounded-full ${
                                status.extrinsic.level === "green"
                                    ? "bg-[#00BE13]"
                                    : status.extrinsic.level === "amber"
                                    ? "bg-[#E8BC38]"
                                    : "bg-[#F83F23]"
                            }`}
                        />
                        <span>
                            {status.extrinsic.n_cameras} cameras posed
                            {status.extrinsic.rmse !== null ? `, RMSE ${status.extrinsic.rmse.toFixed(3)}px` : ""}
                            {status.extrinsic.n_points !== null ? ` (${status.extrinsic.n_points} points)` : ""}
                        </span>
                    </div>
                )}
            </div>

            <QualityModal
                isOpen={showQualityModal}
                onClose={() => setShowQualityModal(false)}
                extrinsic={status?.extrinsic ?? null}
                syncIssue={status?.sync_issue ?? null}
            />
        </>
    )
}

