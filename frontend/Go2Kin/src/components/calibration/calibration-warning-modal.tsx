import WarningIcon from "../icons/warning-icon"

type CalibrationWarningModalProps = {
    isOpen: boolean
    onClose: () => void
    onCalibrate: () => void
}

export default function CalibrationWarningModal({
    isOpen,
    onClose,
    onCalibrate,
}: CalibrationWarningModalProps) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4">
            <div className="bg-[#F5F5F5] border border-[#BBBBBB] rounded-2xl shadow-2xl w-full max-w-xs p-6 flex flex-col items-center text-center gap-3 animate-in fade-in zoom-in-95 duration-150">
                <div className="my-1">
                    <WarningIcon />
                </div>

                <h3 className="text-xl font-bold text-[#F83F23] tracking-wide">
                    WARNING!
                </h3>

                <div className="text-xs text-[#121212] font-medium leading-relaxed">
                    <p>Calibration is too old.</p>
                    <p>A new calibration is required.</p>
                </div>

                <div className="flex items-center justify-center gap-3 w-full mt-3">
                    <button
                        type="button"
                        onClick={onCalibrate}
                        className="flex-1 py-2 px-4 bg-[#00BE13] text-white rounded-lg text-sm font-semibold hover:opacity-90 shadow-sm cursor-pointer"
                    >
                        Calibrate
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-2 px-4 bg-[#EBEBEB] border border-[#BBBBBB] text-[#121212] rounded-lg text-sm font-semibold hover:bg-[#DDDDDD] shadow-sm cursor-pointer"
                    >
                        Later
                    </button>
                </div>
            </div>
        </div>
    )
}

