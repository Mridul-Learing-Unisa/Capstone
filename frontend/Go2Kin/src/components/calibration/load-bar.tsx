import { useState } from "react"
import LoadModal from "./load-modal"
import { deleteTempVideos, loadCalibration, loadIntrinsics } from "./calibration-api"

type LoadBarProps = {
    loadedFile: string | null
    onReload: () => void
}

export default function LoadBar({ loadedFile, onReload }: LoadBarProps) {
    const [loadType, setLoadType] = useState<"calibration" | "intrinsics" | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const [statusMsg, setStatusMsg] = useState<string | null>(null)

    const handleSelectFile = async (name: string) => {
        if (loadType === "calibration") {
            await loadCalibration(name)
            setStatusMsg(`Loaded calibration: ${name}`)
        } else if (loadType === "intrinsics") {
            await loadIntrinsics(name)
            setStatusMsg(`Loaded intrinsics from: ${name}`)
        }
        onReload()
    }

    const handleDeleteVideos = async () => {
        if (!confirm("Are you sure you want to delete temporary calibration videos?")) return
        setIsDeleting(true)
        try {
            const res = await deleteTempVideos()
            setStatusMsg(`Deleted ${res.deleted ?? 0} temporary video(s)`)
            onReload()
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : String(e))
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 py-2 px-1">
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setLoadType("calibration")}
                        className="px-3 py-1.5 bg-white border border-[#BBBBBB] rounded-md text-xs font-medium text-[#121212] hover:bg-gray-50 shadow-xs cursor-pointer"
                    >
                        Load Calibration
                    </button>
                    <button
                        type="button"
                        onClick={() => setLoadType("intrinsics")}
                        className="px-3 py-1.5 bg-white border border-[#BBBBBB] rounded-md text-xs font-medium text-[#121212] hover:bg-gray-50 shadow-xs cursor-pointer"
                    >
                        Load Intrinsics
                    </button>
                    <span className="text-xs text-[#666666] font-mono truncate max-w-xs md:max-w-md">
                        {statusMsg
                            ? statusMsg
                            : loadedFile
                            ? `Loaded: ${loadedFile}.json`
                            : "No calibration loaded"}
                    </span>
                </div>

                <div>
                    <button
                        type="button"
                        onClick={handleDeleteVideos}
                        disabled={isDeleting}
                        className="px-3 py-1.5 bg-white border border-[#BBBBBB] rounded-md text-xs font-medium text-[#121212] hover:bg-gray-50 shadow-xs cursor-pointer disabled:opacity-50"
                    >
                        {isDeleting ? "Deleting..." : "Delete Videos"}
                    </button>
                </div>
            </div>

            <LoadModal
                isOpen={loadType !== null}
                title={loadType === "calibration" ? "Load Calibration" : "Load Intrinsics"}
                onClose={() => setLoadType(null)}
                onSelect={handleSelectFile}
            />
        </>
    )
}

