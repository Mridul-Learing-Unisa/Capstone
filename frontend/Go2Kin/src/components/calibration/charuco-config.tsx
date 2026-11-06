import { useEffect, useState } from "react"
import DownArrowIcon from "../icons/down-arrow-icon"
import SuccessIcon from "../icons/success-icon"
import FailIcon from "../icons/fail-icon"
import ProcessingIcon from "../icons/processing-icon"
import {
    DEFAULT_CHARUCO, getBoardImage, getCharuco, getDictionaries, saveCharuco, type CharucoConfig,
} from "./calibration-api"

// The number inputs are kept as text so half-typed values like "11." still work while typing
type Draft = {
    columns: string
    rows: string
    square_size_cm: string
    aruco_scale: string
    dict_name: string
    inverted: boolean
}

function toDraft(c: CharucoConfig): Draft {
    return {
        columns: String(c.columns),
        rows: String(c.rows),
        square_size_cm: String(c.square_size_cm),
        aruco_scale: String(c.aruco_scale),
        dict_name: c.dict_name,
        inverted: c.inverted,
    }
}

// Turn the inputs back into a config, or say what's wrong with them (same limits as the tkinter spinboxes)
function parse(d: Draft): { config: CharucoConfig | null, problem: string } {
    // Number("") is 0, so empty boxes are checked separately
    const num = (s: string) => s.trim() === "" ? NaN : Number(s)
    const columns = num(d.columns), rows = num(d.rows)
    const square = num(d.square_size_cm), scale = num(d.aruco_scale)
    const boardSize = (n: number) => Number.isInteger(n) && n >= 3 && n <= 20
    let problem = ""
    if (!boardSize(columns) || !boardSize(rows)) {
        problem = "Columns and rows must be whole numbers from 3 to 20"
    } else if (!Number.isFinite(square) || square <= 0) {
        problem = "Square size must be a number above 0"
    } else if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) {
        problem = "ArUco scale must be between 0 and 1 (the marker has to fit inside the square)"
    }
    if (problem) return { config: null, problem }
    return {
        config: { columns, rows, square_size_cm: square, aruco_scale: scale, dict_name: d.dict_name, inverted: d.inverted },
        problem: "",
    }
}

function sameConfig(a: CharucoConfig, b: CharucoConfig) {
    return a.columns === b.columns && a.rows === b.rows && a.square_size_cm === b.square_size_cm
        && a.aruco_scale === b.aruco_scale && a.dict_name === b.dict_name && a.inverted === b.inverted
}

// "Charuco Board Configuration" box at the top of the Calibration tab.
// Loads the saved board, so it normally stays collapsed and only needs opening to change the board.
export default function CharucoConfigPanel() {
    const [open, setOpen] = useState(false)
    const [saved, setSaved] = useState<CharucoConfig | null>(null)   // what the server uses for calibration
    const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_CHARUCO))
    const [dictionaries, setDictionaries] = useState<string[]>([DEFAULT_CHARUCO.dict_name])
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const [error, setError] = useState("")

    // load the saved board + the dictionary list once
    useEffect(() => {
        getCharuco()
            .then(config => { setSaved(config); setDraft(toDraft(config)) })
            .catch(e => setError(`Couldn't load the saved board: ${(e as Error).message}`))
        getDictionaries()
            .then(list => { if (list.length) setDictionaries(list) })
            .catch(() => { /* keep the default so the select still works */ })
    }, [])

    const { config, problem } = parse(draft)
    const unsaved = config !== null && saved !== null && !sameConfig(config, saved)

    // icon left of the title: saved board in use / unsaved edits / something wrong
    let icon = <SuccessIcon />
    let iconTitle = "Saved board in use"
    if (problem || (saved === null && error)) { icon = <FailIcon />; iconTitle = problem || error }
    else if (unsaved) { icon = <ProcessingIcon />; iconTitle = "Unsaved changes, calibration still uses the saved board" }
    else if (saved === null) { icon = <ProcessingIcon />; iconTitle = "Loading..." }

    function update<K extends keyof Draft>(key: K, value: Draft[K]) {
        setDraft(d => ({ ...d, [key]: value }))
        setMessage("")
    }

    async function handleSave() {
        if (!config) return
        setBusy(true)
        setError("")
        try {
            const result = await saveCharuco(config)
            setSaved(result)
            setDraft(toDraft(result))
            setMessage("Config saved")
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy(false)
    }

    // renders the board for the current inputs (saved or not) and downloads it as a PNG to print
    async function handleBoardImage() {
        if (!config) return
        setBusy(true)
        setError("")
        try {
            const url = URL.createObjectURL(await getBoardImage(config))
            const a = document.createElement("a")
            a.href = url
            a.download = `charuco_${config.columns}x${config.rows}_${config.dict_name}${config.inverted ? "_inverted" : ""}.png`
            a.click()
            URL.revokeObjectURL(url)
            setMessage(`Downloaded ${a.download}`)
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy(false)
    }

    // short summary shown in the header while collapsed, so the board can be checked without opening it
    const summary = saved
        ? `${saved.columns}×${saved.rows}, ${saved.square_size_cm} cm, ${saved.dict_name}${saved.inverted ? ", inverted" : ""}`
        : ""

    return (
        <section className="charuco-config flex flex-col gap-[1rem] w-full">
            {/* click the header to expand / collapse */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => setOpen(o => !o)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o) } }}
            >
                <div className="flex items-center gap-[0.5rem]" title={iconTitle}>
                    {icon}
                    <h2>Charuco Board Configuration</h2>
                </div>
                <div className="flex items-center gap-[1rem]">
                    {!open && <span className="text-small">{summary}</span>}
                    <span className={`transition-transform ${open ? "rotate-180" : ""}`}><DownArrowIcon /></span>
                </div>
            </div>

            {open && (
                <>
                    <div className="flex">
                        <div className="flex flex-col gap-[1rem]">
                            <label>
                                <span>Columns:</span>
                                <input type="text" inputMode="numeric" className="data" value={draft.columns} disabled={busy}
                                    onChange={e => update("columns", e.target.value)} />
                            </label>
                            <label>
                                <span>Square Size (cm):</span>
                                <input type="text" inputMode="decimal" className="data" value={draft.square_size_cm} disabled={busy}
                                    onChange={e => update("square_size_cm", e.target.value)} />
                            </label>
                            <label>
                                <span>Dictionary:</span>
                                <select className="w-[11rem]" value={draft.dict_name} disabled={busy}
                                    onChange={e => update("dict_name", e.target.value)}>
                                    {dictionaries.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </label>
                        </div>

                        <div className="flex flex-col gap-[1rem]">
                            <label>
                                <span>Rows:</span>
                                <input type="text" inputMode="numeric" className="data" value={draft.rows} disabled={busy}
                                    onChange={e => update("rows", e.target.value)} />
                            </label>
                            <label>
                                <span>ArUco Scale:</span>
                                <input type="text" inputMode="decimal" className="data" value={draft.aruco_scale} disabled={busy}
                                    onChange={e => update("aruco_scale", e.target.value)} />
                            </label>
                            <label className="flex !gap-[1rem]">
                                <input type="checkbox" className="!w-[1rem] ml-[4rem]" checked={draft.inverted} disabled={busy}
                                    onChange={e => update("inverted", e.target.checked)} />
                                <span className="!w-[5rem] !text-left">Inverted</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex items-center gap-[1rem]">
                        <button type="button" disabled={busy || !config} onClick={handleBoardImage}>Save Board Image</button>
                        <button type="button" disabled={busy || !config || !unsaved} onClick={handleSave}>Save Config</button>
                        <p className="text-small text-left">
                            {problem
                                ? <span className="text-error!">{problem}</span>
                                : error
                                    ? <span className="text-error!">{error}</span>
                                    : unsaved ? "Unsaved changes" : message}
                        </p>
                    </div>
                </>
            )}
        </section>
    )
}
