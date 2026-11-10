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
            <div className="flex flex-wrap items-center justify-between mb-[1rem]">
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setLoadType("calibration")}>
                        Load Calibration
                    </button>
                    <button type="button" onClick={() => setLoadType("intrinsics")}>
                        Load Intrinsics
                    </button>
                    <span className="text-small">
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

