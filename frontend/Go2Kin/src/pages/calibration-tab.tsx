import { lazy, Suspense, useEffect, useState } from "react"
import LoadBar from "../components/calibration/load-bar"
import CharucoConfig from "../components/calibration/charuco-config"
import IntrinsicCalibration from "../components/calibration/intrinsic-calibration"
import ExtrinsicCalibration from "../components/calibration/extrinsic-calibration"
import SetOrigin from "../components/calibration/set-origin"
import { autoLoad, BUSY, getStatus, type CalibrationStatus } from "../components/calibration/calibration-api"

const SceneUI = lazy(() => import("../components/temp-ui-for-testing/scene-ui"))

export default function CalibrationTab() {
    const [status, setStatus] = useState<CalibrationStatus | null>(null)
    const [loadKey, setLoadKey] = useState(0)

    async function refreshStatus() {
        try {
            const data = await getStatus()
            setStatus(data)
        } catch {
            // backend unreachable
        }
    }

    useEffect(() => {
        async function load() {
            const s = await getStatus()
            setStatus(s)
            if (s.loaded_file || s.intrinsic_count > 0 || BUSY.includes(s.status)) return
            if (await autoLoad()) {
                setLoadKey(k => k + 1)
                refreshStatus()
            }
        }
        load().catch(e => console.warn("Auto-load of the last calibration failed:", e))

        const timer = setInterval(refreshStatus, 1000)
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="w-full flex-1 min-h-0 flex flex-col gap-[1rem] p-[1.5rem]">
            <LoadBar loadedFile={status?.loaded_file ?? null} onReload={refreshStatus} />

            <div className="w-full flex-1 min-h-0 flex gap-[1.5rem]">
                <div className="flex flex-col gap-[0.5rem] w-[45rem] shrink-0 overflow-y-auto pr-1">
                    <CharucoConfig reloadKey={loadKey} />
                    <IntrinsicCalibration />
                    <ExtrinsicCalibration />
                    <SetOrigin />
                </div>

                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-small">Loading 3D scene...</div>}>
                    <SceneUI />
                </Suspense>
            </div>
        </div>
    )
}
