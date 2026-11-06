import { useState } from "react"
import SuccessIcon from "../icons/success-icon"
import ProcessingIcon from "../icons/processing-icon"
import DisabledIcon from "../icons/disabled-icon"
import {
    calibrateIntrinsic,
    startIntrinsicRecord,
    stopIntrinsicRecord,
    type CalibrationStatus,
    type IntrinsicCam,
} from "./calibration-api"

type IntrinsicCardProps = {
    status: CalibrationStatus | null
    onReload: () => void
}

export default function IntrinsicCard({ status, onReload }: IntrinsicCardProps) {
    const [expanded, setExpanded] = useState(false)
    const [customPaths, setCustomPaths] = useState<Record<string, string>>({})
    const [actionMsg, setActionMsg] = useState<string | null>(null)

    const intrinsics = status?.intrinsics ?? []
    const total = intrinsics.length
    const calibratedCount = intrinsics.filter(i => i.calibrated).length
    const isAllDone = total > 0 && calibratedCount === total

    const isRecordingCam = (serial: string) =>
        status?.status === "recording" &&
        status?.recording?.type === "intrinsic" &&
        status?.recording?.serials.includes(serial)

    const handleRecordToggle = async (cam: IntrinsicCam) => {
        setActionMsg(null)
        try {
            if (isRecordingCam(cam.serial)) {
                await stopIntrinsicRecord(cam.serial)
            } else {
                await startIntrinsicRecord(cam.serial)
            }
            onReload()
        } catch (e) {
            setActionMsg(e instanceof Error ? e.message : String(e))
        }
    }

    const handleCalibrate = async (cam: IntrinsicCam) => {
        setActionMsg(null)
        try {
            const custom = customPaths[cam.serial]?.trim()
            await calibrateIntrinsic(cam.serial, custom || undefined)
            onReload()
        } catch (e) {
            setActionMsg(e instanceof Error ? e.message : String(e))
        }
    }

    const icon = isAllDone ? (
        <SuccessIcon />
    ) : status?.status === "recording" && status.recording?.type === "intrinsic" ? (
        <ProcessingIcon />
    ) : (
        <DisabledIcon />
    )

    return (
        <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-xs overflow-hidden transition-all">
            {/* Header row / Collapsible trigger */}
            <div
                onClick={() => setExpanded(e => !e)}
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-[#EBEBEB] select-none transition-colors"
            >
                <div className="flex items-center gap-3">
                    {icon}
                    <div className="text-left">
                        <h4 className="font-semibold text-sm text-[#121212]">Intrinsic Calibration</h4>
                        <span className="text-xs text-[#666666]">
                            {calibratedCount}/{total || 4} Cameras
                        </span>
                    </div>
                </div>

                <div className="text-[#666666] text-sm p-1">
                    <svg
                        className={`w-4 h-4 transform transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {/* Expanded Content */}
            {expanded && (
                <div className="p-4 pt-2 border-t border-[#BBBBBB] flex flex-col gap-3 bg-white/50 text-left">
                    {actionMsg && (
                        <div className="p-2 text-xs bg-red-100 border border-red-300 text-red-800 rounded">
                            {actionMsg}
                        </div>
                    )}

                    {intrinsics.length === 0 ? (
                        <div className="text-xs text-[#666666] py-2 text-center">
                            No cameras detected. Connect cameras using the footer bar.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {intrinsics.map(cam => {
                                const recording = isRecordingCam(cam.serial)
                                return (
                                    <div
                                        key={cam.serial}
                                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white border border-[#BBBBBB] rounded-lg text-xs"
                                    >
                                        <div className="flex items-center gap-2 min-w-[100px]">
                                            <span
                                                className={`w-2 h-2 rounded-full ${
                                                    cam.calibrated ? "bg-[#00BE13]" : "bg-[#BBBBBB]"
                                                }`}
                                            />
                                            <span className="font-semibold text-[#121212]">{cam.name}</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleRecordToggle(cam)}
                                                className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer shadow-xs ${
                                                    recording
                                                        ? "bg-[#F83F23] text-white animate-pulse"
                                                        : "bg-white border border-[#BBBBBB] text-[#121212] hover:bg-gray-100"
                                                }`}
                                            >
                                                {recording ? "Stop" : "Record"}
                                            </button>

                                            <input
                                                type="text"
                                                placeholder={cam.video ?? "Recorded video path"}
                                                value={customPaths[cam.serial] ?? ""}
                                                onChange={e =>
                                                    setCustomPaths({ ...customPaths, [cam.serial]: e.target.value })
                                                }
                                                className="bg-[#EBEBEB] border border-[#BBBBBB] rounded px-2 py-1 text-xs w-36 sm:w-48 font-mono truncate"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => handleCalibrate(cam)}
                                                className="px-3 py-1 bg-[#00BE13] text-white rounded text-xs font-semibold hover:opacity-90 shadow-xs cursor-pointer"
                                            >
                                                Calibrate
                                            </button>
                                        </div>

                                        <div className="text-right min-w-[130px]">
                                            {cam.calibrated ? (
                                                <span className="text-[#00BE13] font-medium">
                                                    RMSE {cam.rmse !== null ? `${cam.rmse.toFixed(3)}px` : "done"}
                                                    {cam.frames_used ? ` (${cam.frames_used}f)` : ""}
                                                </span>
                                            ) : (
                                                <span className="text-[#666666]">Not calibrated</span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

