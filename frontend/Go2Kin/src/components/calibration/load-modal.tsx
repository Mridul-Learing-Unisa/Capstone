import { useEffect, useState } from "react"
import { listCalibrationFiles, type CalibrationFile } from "./calibration-api"

type LoadModalProps = {
    isOpen: boolean
    title: string
    onClose: () => void
    onSelect: (fileName: string) => Promise<void>
}

export default function LoadModal({ isOpen, title, onClose, onSelect }: LoadModalProps) {
    const [files, setFiles] = useState<CalibrationFile[]>([])
    const [selected, setSelected] = useState<string>("")
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!isOpen) return
        setLoading(true)
        setError(null)
        listCalibrationFiles()
            .then(res => {
                setFiles(res)
                if (res.length > 0) setSelected(res[0].name)
            })
            .catch(e => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false))
    }, [isOpen])

    if (!isOpen) return null

    const handleConfirm = async () => {
        if (!selected) return
        setSubmitting(true)
        setError(null)
        try {
            await onSelect(selected)
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4 text-left">
                <div className="flex justify-between items-center border-b border-[#BBBBBB] pb-2">
                    <h3 className="font-semibold text-lg text-[#121212]">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[#666666] hover:text-black text-xl font-bold px-2 py-0.5 rounded cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                {error && (
                    <div className="p-3 bg-red-100 border border-red-300 text-red-800 text-sm rounded-md">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="text-center py-6 text-sm text-[#666666]">Loading saved calibrations...</div>
                ) : files.length === 0 ? (
                    <div className="text-center py-6 text-sm text-[#666666]">
                        No saved calibrations found in the current project.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                        {files.map(f => (
                            <label
                                key={f.name}
                                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                                    selected === f.name
                                        ? "bg-white border-[#00BE13] ring-1 ring-[#00BE13]"
                                        : "bg-[#EBEBEB] border-[#BBBBBB] hover:bg-white"
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <input
                                        type="radio"
                                        name="calib-file"
                                        checked={selected === f.name}
                                        onChange={() => setSelected(f.name)}
                                        className="accent-[#00BE13]"
                                    />
                                    <span className="font-mono text-sm font-medium text-[#121212]">{f.name}</span>
                                </div>
                                <span className="text-xs text-[#666666]">
                                    {new Date(f.modified * 1000).toLocaleDateString()} {new Date(f.modified * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </label>
                        ))}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2 border-t border-[#BBBBBB]">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 border border-[#BBBBBB] rounded-lg text-sm bg-white hover:bg-gray-100 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting || !selected || files.length === 0}
                        className="px-4 py-2 bg-[#00BE13] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                        {submitting ? "Loading..." : "Load"}
                    </button>
                </div>
            </div>
        </div>
    )
}

