// Calibration tab, replacing the tkinter CalibrationTab (code/GUI/calibration_tab.py).

import DownArrowIcon from "../components/icons/down-arrow-icon";
import SceneUI from "../components/temp-ui-for-testing/scene-ui";

// Empty for now: the intrinsic / extrinsic / origin panels will go here.
export default function CalibrationTab() {
    return (
        // flex-1 + min-h-0: take the height left over in <main> (and shrink when the camera footer is added)
        <div className="w-full flex-1 min-h-0 flex gap-[1.5rem] p-[1.5rem]">
            <div className="flex flex-col gap-[0.5rem] w-[38rem] shrink-0">
                <section className="w-full text-left">
                    <div className="flex items-center justify-between">
                        <h2>Charuco Board Configuration</h2>
                        <DownArrowIcon />
                    </div>
                </section>
                <section className="w-full text-left">
                    <div className="flex items-center justify-between">
                        <h2>Intrinsic Calibration</h2>
                        <DownArrowIcon />
                    </div>
                </section>
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
