// Calibration tab, replacing the tkinter CalibrationTab (code/GUI/calibration_tab.py).

import { useEffect, useState } from "react";
import CharucoConfig from "../components/calibration/charuco-config";
import { autoLoad, BUSY, getStatus } from "../components/calibration/calibration-api";
import IntrinsicCalibration from "../components/calibration/intrinsic-calibration";
import SceneUI from "../components/temp-ui-for-testing/scene-ui";

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
                <section className="w-full text-left">
                    <h2>Extrinsic Calibration</h2>
                </section>
                <section className="w-full text-left">
                    <h2>Set Origin</h2>
                </section>
            </div>

            <SceneUI />
        </div>
    )
}
