import type { ExtrinsicReport, SyncIssue } from "./calibration-api"

type QualityModalProps = {
    isOpen: boolean
    onClose: () => void
    extrinsic: ExtrinsicReport | null
    syncIssue: SyncIssue | null
}

export default function QualityModal({ isOpen, onClose, extrinsic, syncIssue }: QualityModalProps) {
    if (!isOpen) return null

    const levelColor = extrinsic?.level === "green"
        ? "text-[#00BE13] bg-green-50 border-green-200"
        : extrinsic?.level === "amber"
        ? "text-[#E8BC38] bg-yellow-50 border-yellow-200"
        : "text-[#F83F23] bg-red-50 border-red-200"

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-xl w-full max-w-lg p-6 flex flex-col gap-4 text-left">
                <div className="flex justify-between items-center border-b border-[#BBBBBB] pb-2">
                    <h3 className="font-semibold text-lg text-[#121212]">Calibration Quality Report</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[#666666] hover:text-black text-xl font-bold px-2 py-0.5 rounded cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                {extrinsic ? (
                    <div className="flex flex-col gap-4">
                        <div className={`p-4 rounded-lg border flex items-center justify-between ${levelColor}`}>
                            <div>
                                <span className="text-xs uppercase font-bold tracking-wider">Quality Status</span>
                                <h4 className="text-xl font-bold capitalize">{extrinsic.level || "Good"}</h4>
                            </div>
                            <div className="text-right">
                                <span className="text-xs uppercase font-bold tracking-wider">Reprojection Error</span>
                                <p className="text-2xl font-mono font-bold">
                                    {extrinsic.rmse !== null ? `${extrinsic.rmse.toFixed(3)} px` : "--"}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white border border-[#BBBBBB] rounded-lg p-3">
                                <span className="text-xs text-[#666666]">Cameras Posed</span>
                                <p className="text-lg font-bold text-[#121212]">{extrinsic.n_cameras}</p>
                            </div>
                            <div className="bg-white border border-[#BBBBBB] rounded-lg p-3">
                                <span className="text-xs text-[#666666]">3D Points Triangulated</span>
                                <p className="text-lg font-bold text-[#121212]">{extrinsic.n_points ?? "--"}</p>
                            </div>
                        </div>

                        <div className="text-xs text-[#666666] bg-white p-3 rounded-lg border border-[#BBBBBB]">
                            <p className="font-medium text-[#121212] mb-1">Interpretation Guide:</p>
                            <ul className="list-disc pl-4 space-y-0.5">
                                <li><b>&lt; 0.5 px:</b> Excellent calibration accuracy.</li>
                                <li><b>0.5 - 1.0 px:</b> Acceptable for most biomechanical tracking.</li>
                                <li><b>&gt; 1.0 px:</b> Re-calibration recommended for accurate 3D kinematics.</li>
                            </ul>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-6 text-sm text-[#666666]">
                        No extrinsic calibration data available yet. Please run extrinsic calibration first.
                    </div>
                )}

                {syncIssue && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 mt-2">
                        <p className="font-bold">{syncIssue.heading}</p>
                        <p>{syncIssue.subtext}</p>
                        <ul className="list-disc pl-4 mt-1">
                            {syncIssue.reasons.map((r, i) => (
                                <li key={i}>{r}</li>
                            ))}
                        </ul>
                        {syncIssue.table && (
                            <pre className="mt-2 p-2 bg-white rounded border overflow-x-auto text-[10px] font-mono">
                                {syncIssue.table}
                            </pre>
                        )}
                    </div>
                )}

                <div className="flex justify-end pt-2 border-t border-[#BBBBBB]">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-[#00BE13] text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

