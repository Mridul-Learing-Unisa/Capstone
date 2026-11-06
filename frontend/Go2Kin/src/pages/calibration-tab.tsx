<<<<<<< HEAD
// Calibration tab, replacing the tkinter CalibrationTab (code/GUI/calibration_tab.py).

import { useEffect, useState } from "react";
import CharucoConfig from "../components/calibration/charuco-config";
import { autoLoad, BUSY, getStatus } from "../components/calibration/calibration-api";
import IntrinsicCalibration from "../components/calibration/intrinsic-calibration";
import SceneUI from "../components/temp-ui-for-testing/scene-ui";
import ExtrinsicCalibration from "../components/calibration/extrinsic-calibration";
import SetOrigin from "../components/calibration/set-origin";

// Empty for now: the intrinsic / extrinsic / origin panels will go here.
export default function CalibrationTab() {
    const [loadKey, setLoadKey] = useState(0)   // bumped after a calibration is loaded

    // Like tkinter at startup: load the last calibration (else the project's latest), but only if the
    // server has nothing yet, so coming back to this tab never throws away calibration done this session.
    useEffect(() => {
        async function load() {
            const status = await getStatus()
            if (status.loaded_file || status.intrinsic_count > 0 || BUSY.includes(status.status)) return
            if (await autoLoad()) setLoadKey(k => k + 1)
        }
        load().catch(e => console.warn("Auto-load of the last calibration failed:", e))
    }, [])

    return (
        // flex-1 + min-h-0: take the height left over in <main> (and shrink when the camera footer is added)
        <div className="w-full flex-1 min-h-0 flex gap-[1.5rem] p-[1.5rem]">
            <div className="flex flex-col gap-[0.5rem] w-[45rem] shrink-0">
                <CharucoConfig reloadKey={loadKey} />
                <IntrinsicCalibration />
                <ExtrinsicCalibration />
                <SetOrigin />
            </div>

            <SceneUI />
        </div>
    )
}
=======
import { Suspense, useEffect, useState } from "react"
import LoadBar from "../components/calibration/load-bar"
import CharucoCard from "../components/calibration/charuco-card"
import IntrinsicCard from "../components/calibration/intrinsic-card"
import ExtrinsicCard from "../components/calibration/extrinsic-card"
import OriginCard from "../components/calibration/origin-card"
import CalibrationViewport from "../components/calibration/calibration-viewport"
import {
    autoLoadCalibration,
    getCalibrationStatus,
    type CalibrationStatus,
} from "../components/calibration/calibration-api"

export default function CalibrationTab() {
    const [status, setStatus] = useState<CalibrationStatus | null>(null)

    async function refreshStatus() {
        try {
            const data = await getCalibrationStatus()
            setStatus(data)
        } catch {
            // backend unreachable
        }
    }

    // Initial mount: auto-load latest calibration (as tkinter does), then poll status
    useEffect(() => {
        autoLoadCalibration()
            .then(refreshStatus)
            .catch(() => refreshStatus())

        const pollTimer = setInterval(refreshStatus, 1000)
        return () => clearInterval(pollTimer)
    }, [])

    return (
        <div className="flex flex-col flex-1 p-4 md:p-6 gap-4 max-w-[1600px] w-full mx-auto">
            {/* Top Toolbar: Load / Delete Actions */}
            <LoadBar loadedFile={status?.loaded_file ?? null} onReload={refreshStatus} />

            {/* Two-Column Grid: Pipeline on Left, 3D Viewport on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-1">
                {/* Left Column: Calibration Pipeline (cards) */}
                <div className="lg:col-span-5 xl:col-span-5 flex flex-col gap-3.5">
                    <CharucoCard />
                    <IntrinsicCard status={status} onReload={refreshStatus} />
                    <ExtrinsicCard status={status} onReload={refreshStatus} />
                    <OriginCard status={status} onReload={refreshStatus} />
                </div>

                {/* Right Column: 3D Camera Position Viewport */}
                <div className="lg:col-span-7 xl:col-span-7 flex flex-col h-full min-h-[500px]">
                    <Suspense
                        fallback={
                            <div className="flex-1 flex items-center justify-center bg-[#2A2B2E] rounded-xl border border-[#BBBBBB] text-white/50 text-sm">
                                Loading 3D Viewport...
                            </div>
                        }
                    >
                        <CalibrationViewport />
                    </Suspense>
                </div>
            </div>
        </div>
    )
}

>>>>>>> e53e591 (Calliberation tab)
