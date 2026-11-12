import { useEffect, useRef, useState } from "react"

type Props = {
    graphUrl: string | null   // the last trial's clap graph, null if there isn't one yet
    logLines: string[]
}

// "Audio Graph" + "Log" boxes under Record Trial, from the Figma design.
// The graph is the picture the sync step saves (each camera's sound with the 2 claps marked),
// the log is what tkinter used to print in the terminal while it downloads and syncs.
export default function AudioGraphLog({ graphUrl, logLines }: Props) {
    const logBox = useRef<HTMLDivElement>(null)

    // keep the newest line in view, like a terminal
    useEffect(() => {
        if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
    }, [logLines])

    return (
        <section className="flex gap-4 text-left">
            <div className="flex-1 flex flex-col gap-2 min-w-0">
                <h2>Audio Graph</h2>
                <div className="h-56 bg-[#111] rounded flex items-center justify-center overflow-hidden">
                    {graphUrl
                        // key makes a fresh Graph for each new url, so an old error doesn't stick around
                        ? <Graph key={graphUrl} url={graphUrl} />
                        : <p className="text-small text-center px-4">The clap graph shows up here after a trial is synced</p>}
                </div>
            </div>

            <div className="flex-1 flex flex-col gap-2 min-w-0">
                <h2>Log</h2>
                <div ref={logBox} className="h-56 bg-[#111] rounded p-3 overflow-y-auto text-center">
                    {logLines.length === 0
                        ? <p className="text-small">Nothing yet, press Record to start</p>
                        : logLines.map((line, i) => (
                            <p key={i} className="font-mono text-xs text-[#ddd] whitespace-pre-wrap break-words">{line}</p>
                        ))}
                </div>
            </div>
        </section>
    )
}

// the graph picture, or a message if the server has none (e.g. no clap was found)
function Graph({ url }: { url: string }) {
    const [missing, setMissing] = useState(false)

    if (missing) {
        return <p className="text-small text-center px-4">No graph for this trial, check the log for why</p>
    }

    return (
        // click to open it full size in a new tab, it's a big picture squeezed into a small box
        <a href={url} target="_blank" rel="noreferrer" className="w-full h-full" title="Open full size">
            <img
                src={url}
                alt="Each camera's audio with the two detected claps marked"
                className="w-full h-full object-contain bg-white"
                onError={() => setMissing(true)}
            />
        </a>
    )
}
