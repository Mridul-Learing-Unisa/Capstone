import { useEffect, useState } from "react"
import SuccessIcon from "../icons/success-icon"
import {
    downloadBoardImage,
    getCharucoConfig,
    getCharucoDictionaries,
    saveCharucoConfig,
    DEFAULT_CHARUCO,
    type CharucoConfig,
} from "./calibration-api"

export default function CharucoCard() {
    const [expanded, setExpanded] = useState(false)
    const [config, setConfig] = useState<CharucoConfig>(DEFAULT_CHARUCO)
    const [dictionaries, setDictionaries] = useState<string[]>([DEFAULT_CHARUCO.dict_name])
    const [saving, setSaving] = useState(false)
    const [statusText, setStatusText] = useState<string | null>(null)

    useEffect(() => {
        getCharucoConfig()
            .then(c => { if (c) setConfig(c) })
            .catch(() => { })
        getCharucoDictionaries()
            .then(d => { if (d.length) setDictionaries(d) })
            .catch(() => { })
    }, [])

    function update<K extends keyof CharucoConfig>(key: K, value: CharucoConfig[K]) {
        setConfig(c => ({ ...c, [key]: value }))
    }

    async function handleSaveConfig() {
        setSaving(true)
        setStatusText(null)
        try {
            await saveCharucoConfig(config)
            setStatusText("Saved board configuration successfully.")
        } catch (e) {
            setStatusText(e instanceof Error ? e.message : String(e))
        } finally {
            setSaving(false)
        }
    }

    async function handleDownloadImage() {
        setStatusText(null)
        try {
            await downloadBoardImage(config)
            setStatusText("Downloaded board image.")
        } catch (e) {
            setStatusText(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-xl shadow-xs overflow-hidden transition-all">
            {/* Header row / Collapsible trigger */}
            <div
                onClick={() => setExpanded(e => !e)}
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-[#EBEBEB] select-none transition-colors"
            >
                <div className="flex items-center gap-3">
                    <SuccessIcon />
                    <div className="text-left">
                        <h4 className="font-semibold text-sm text-[#121212]">Charuco Board Configuration</h4>
                        <span className="text-xs text-[#666666]">
                            {config.rows}x{config.columns}, {config.square_size_cm}cm
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
                <div className="p-4 pt-2 border-t border-[#BBBBBB] flex flex-col gap-4 bg-white/50 text-left">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                            <label className="block text-[#666666] mb-1">Columns</label>
                            <input
                                type="number"
                                min={3}
                                max={20}
                                value={config.columns}
                                onChange={e => update("columns", Number(e.target.value))}
                                className="w-full bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1"
                            />
                        </div>
                        <div>
                            <label className="block text-[#666666] mb-1">Rows</label>
                            <input
                                type="number"
                                min={3}
                                max={20}
                                value={config.rows}
                                onChange={e => update("rows", Number(e.target.value))}
                                className="w-full bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1"
                            />
                        </div>
                        <div>
                            <label className="block text-[#666666] mb-1">Square size (cm)</label>
                            <input
                                type="number"
                                step={0.01}
                                min={0}
                                value={config.square_size_cm}
                                onChange={e => update("square_size_cm", Number(e.target.value))}
                                className="w-full bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1"
                            />
                        </div>
                        <div>
                            <label className="block text-[#666666] mb-1">ArUco scale</label>
                            <input
                                type="number"
                                step={0.05}
                                min={0}
                                max={1}
                                value={config.aruco_scale}
                                onChange={e => update("aruco_scale", Number(e.target.value))}
                                className="w-full bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-center">
                        <div>
                            <label className="block text-[#666666] mb-1">Dictionary</label>
                            <select
                                value={config.dict_name}
                                onChange={e => update("dict_name", e.target.value)}
                                className="w-full bg-[#EBEBEB] border border-[#BBBBBB] rounded-md px-2 py-1 text-xs"
                            >
                                {dictionaries.map(d => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center pt-4">
                            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[#121212]">
                                <input
                                    type="checkbox"
                                    checked={config.inverted}
                                    onChange={e => update("inverted", e.target.checked)}
                                    className="accent-[#00BE13] w-4 h-4 rounded cursor-pointer"
                                />
                                Inverted (white squares on black)
                            </label>
                        </div>
                    </div>

                    {statusText && (
                        <p className="text-xs text-[#666666] italic bg-white p-2 rounded border border-[#BBBBBB]">
                            {statusText}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleDownloadImage}
                            className="px-3 py-1.5 bg-white border border-[#BBBBBB] rounded-md text-xs font-medium text-[#121212] hover:bg-gray-50 shadow-xs cursor-pointer"
                        >
                            Save Board Image
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveConfig}
                            disabled={saving}
                            className="px-3 py-1.5 bg-[#00BE13] text-white rounded-md text-xs font-medium hover:opacity-90 shadow-xs cursor-pointer disabled:opacity-50"
                        >
                            {saving ? "Saving..." : "Save Config"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

