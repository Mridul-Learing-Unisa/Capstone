import { useState } from "react"
import SuccessIcon from "../icons/success-icon"
import ProcessingIcon from "../icons/processing-icon"
import DisabledIcon from "../icons/disabled-icon"
import {
    startOriginRecord,
    stopOriginRecord,
    type CalibrationStatus,
} from "./calibration-api"

type OriginCardProps = {
    status: CalibrationStatus | null
    onReload: () => void
}

export default function OriginCard({ status, onReload }: OriginCardProps) {
    const [actionError, setActionError] = useState<string | null>(null)

    const isRecording = status?.status === "recording" && status?.recording?.type === "origin"
    const isBusy = status?.status === "processing" && status?.stage === "origin"
    const isOriginSet = !!status?.origin_set

    const handleActionClick = async () => {
        setActionError(null)
        try {
            if (isRecording) {
                await stopOriginRecord()
            } else {
                await startOriginRecord()
            }
            onReload()
        } catch (e) {
            setActionError(e instanceof Error ? e.message : String(e))
        }
    }

    const icon = isOriginSet ? (
        <SuccessIcon />
    ) : isRecording || isBusy ? (
        <ProcessingIcon />
    ) : (
        <DisabledIcon />
    )

    return (
        <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-xs p-4 flex flex-col gap-3 text-left">
            <div className="flex items-center gap-3">
                {icon}
                <div className="flex-1">
                    <h4 className="font-semibold text-sm text-[#121212]">Set Origin</h4>
                </div>
            </div>

            {actionError && (
                <div className="p-2 text-xs bg-red-100 border border-red-300 text-red-800 rounded">
                    {actionError}
                </div>
            )}

            <div className="flex items-center gap-4 pt-1">
                <button
                    type="button"
                    onClick={handleActionClick}
                    disabled={!status?.can_origin && !isRecording}
                    className={`min-w-[110px] px-6 py-2 rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 ${
                        isRecording
                            ? "bg-[#F83F23] text-white animate-pulse"
                            : isBusy
                            ? "bg-[#E8BC38] text-white cursor-wait"
                            : "bg-[#00BE13] text-white hover:opacity-90"
                    }`}
                >
                    {isRecording ? "STOP" : isBusy ? "Processing" : "Start"}
                </button>

                {isOriginSet && (
                    <span className="text-xs text-[#00BE13] font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#00BE13]" />
                        Origin set
                    </span>
                )}

                {status?.message && status.stage === "origin" && (
                    <span className="text-xs text-[#666666] italic">{status.message}</span>
                )}
            </div>
        </div>
    )
}

