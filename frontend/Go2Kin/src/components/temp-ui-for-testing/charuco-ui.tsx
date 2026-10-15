import { useEffect, useState } from 'react'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/calibration/charuco'

type CharucoConfig = {
    columns: number
    rows: number
    square_size_cm: number
    aruco_scale: number
    dict_name: string
    inverted: boolean
}

// Same defaults as the tkinter charuco inputs; replaced by the saved config on load.
const DEFAULT_CONFIG: CharucoConfig = {
    columns: 5, rows: 7, square_size_cm: 11.7, aruco_scale: 0.75, dict_name: 'DICT_4X4_50', inverted: false,
}

// Temporary, unstyled UI for poking the charuco board config API by hand.
function CharucoUI() {
    const [config, setConfig] = useState<CharucoConfig>(DEFAULT_CONFIG)
    const [dictionaries, setDictionaries] = useState<string[]>([DEFAULT_CONFIG.dict_name])
    const [log, setLog] = useState('')

    // On an error response keep the defaults: an error body is not a config/dictionary list.
    useEffect(() => {
        fetch(API)
            .then(async r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                setConfig(await r.json())
            })
            .catch(e => setLog(`GET /api/calibration/charuco failed: ${e}`))
        fetch(API + '/dictionaries')
            .then(async r => {
                const d = r.ok ? await r.json() : null
                if (Array.isArray(d?.dictionaries) && d.dictionaries.length) setDictionaries(d.dictionaries)
            })
            .catch(() => { })
    }, [])

    function update<K extends keyof CharucoConfig>(key: K, value: CharucoConfig[K]) {
        setConfig(c => ({ ...c, [key]: value }))
    }

    async function saveConfig() {
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            })
            const data = await res.json().catch(() => null)
            setLog(`POST /api/calibration/charuco -> ${res.status}\n` + JSON.stringify(data, null, 2))
        } catch (e) {
            setLog(`POST /api/calibration/charuco -> request failed: ${e}`)
        }
    }

    // Renders the board for the current (possibly unsaved) inputs and downloads it as a PNG.
    async function saveBoardImage() {
        try {
            const res = await fetch(API + '/board-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            })
            if (!res.ok) {
                setLog(`POST /api/calibration/charuco/board-image -> ${res.status}\n` + JSON.stringify(await res.json().catch(() => null), null, 2))
                return
            }
            const url = URL.createObjectURL(await res.blob())
            const a = document.createElement('a')
            a.href = url
            a.download = `charuco_${config.columns}x${config.rows}_${config.dict_name}.png`
            a.click()
            URL.revokeObjectURL(url)
            setLog(`POST /api/calibration/charuco/board-image -> ${res.status} (downloaded ${a.download})`)
        } catch (e) {
            setLog(`POST /api/calibration/charuco/board-image -> request failed: ${e}`)
        }
    }

    return (
        <div>
            <h3>Charuco board API test</h3>

            <div>
                Columns:{' '}
                <input type="number" min={3} max={20} style={{ width: 50 }} value={config.columns}
                    onChange={e => update('columns', Number(e.target.value))} />
                {' '}Rows:{' '}
                <input type="number" min={3} max={20} style={{ width: 50 }} value={config.rows}
                    onChange={e => update('rows', Number(e.target.value))} />
            </div>

            <div>
                Square size (cm):{' '}
                <input type="number" step={0.01} min={0} style={{ width: 70 }} value={config.square_size_cm}
                    onChange={e => update('square_size_cm', Number(e.target.value))} />
                {' '}ArUco scale:{' '}
                <input type="number" step={0.05} min={0} max={1} style={{ width: 70 }} value={config.aruco_scale}
                    onChange={e => update('aruco_scale', Number(e.target.value))} />
            </div>

            <div>
                Dictionary:{' '}
                <select value={config.dict_name} onChange={e => update('dict_name', e.target.value)}>
                    {dictionaries.map(d => <option key={d}>{d}</option>)}
                </select>
                {' '}
                <label>
                    <input type="checkbox" checked={config.inverted}
                        onChange={e => update('inverted', e.target.checked)} />
                    Inverted
                </label>
            </div>

            <div>
                <button onClick={saveBoardImage}>Save Board Image</button>
                <button onClick={saveConfig}>Save Config</button>
            </div>

            <pre>{log}</pre>
        </div>
    )
}

export default CharucoUI
