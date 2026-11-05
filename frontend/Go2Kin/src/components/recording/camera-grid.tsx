import { useState } from "react"
import { previewUrl, startPreview, stopPreview, type Camera } from "./recording-api"

type Props = {
    cameras: Camera[]
    disabled: boolean   // true while recording, the server kills previews then anyway
}

// 2x2 grid of camera tiles on the right of the Recording tab.
// The server can only stream one camera at a time (one firewall port),
// so you pick which tile goes live.
export default function CameraGrid({ cameras, disabled }: Props) {
    const [live, setLive] = useState<string | null>(null)        // serial that's previewing
    const [starting, setStarting] = useState<string | null>(null)
    const [error, setError] = useState("")

    // don't show a stream that the server has stopped or whose camera dropped out
    const liveCam = cameras.find(c => c.serial === live && c.status === "connected")
    const showing = disabled || !liveCam ? null : live

    async function handlePreview(serial: string) {
        setStarting(serial)
        setError("")
        try {
            await startPreview(serial)   // takes a few seconds
            setLive(serial)
        } catch (e) {
            setError((e as Error).message)
        }
        setStarting(null)
    }

    async function handleStop(serial: string) {
        setLive(null)
        try { await stopPreview(serial) } catch { /* it's gone already, fine */ }
    }

    return (
        <section className="flex-1 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 flex-1">
                {[0, 1, 2, 3].map(i => {
                    // always draw 4 boxes, even if the API has fewer cameras set up
                    const cam = cameras[i] ?? { serial: `empty-${i}`, name: `GoPro ${i + 1}`, status: "not set up" }
                    const connected = cam.status === "connected"
                    const isLive = showing === cam.serial
                    return (
                        <div key={i} className="relative bg-[#333] text-white rounded min-h-48 flex items-center justify-center overflow-hidden">
                            {isLive ? (
                                <img
                                    src={previewUrl(cam.serial)}
                                    alt={`${cam.name} live preview`}
                                    className="absolute inset-0 w-full h-full object-contain"
                                    onError={() => setLive(null)}
                                />
                            ) : (
                                <span className="text-large font-semibold">Cam {i + 1}</span>
                            )}

                            {/* name + connection dot, top left */}
                            <div className="absolute top-3 left-3 flex items-center gap-2 text-small text-white!">
                                <span className={`w-3 h-3 rounded-full ${connected ? "bg-success" : "bg-error"}`} />
                                {cam.name}
                            </div>

                            {/* bottom right: Live badge or the preview button */}
                            <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                {isLive && (
                                    <span className="flex items-center gap-2 text-small text-white!">
                                        <span className="w-3 h-3 rounded-full bg-error" /> Live
                                    </span>
                                )}
                                {connected && (
                                    <button
                                        type="button"
                                        className="text-text-primary"
                                        disabled={disabled || starting !== null}
                                        onClick={() => isLive ? handleStop(cam.serial) : handlePreview(cam.serial)}
                                    >
                                        {starting === cam.serial ? "Starting..." : isLive ? "Stop" : "Preview"}
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {cameras.length === 0 && (
                <p className="text-small">No cameras set up. Is the API running, and are the serials in go2kin_config.json?</p>
            )}
            {disabled && <p className="text-small">Previews are off while recording.</p>}
            {error && <p className="text-error">{error}</p>}
        </section>
    )
}
