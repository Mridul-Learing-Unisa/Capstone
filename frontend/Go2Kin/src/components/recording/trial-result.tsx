import { FINISHED, type Job } from "./recording-api"

// friendlier wording for the job status
const STATUS_TEXT: Record<string, string> = {
    pending: "Waiting to start...",
    downloading: "Downloading videos from the cameras...",
    syncing: "Syncing videos using the clap...",
    complete: "Done, videos are synced",
    failed: "Failed",
}

type Props = { job: Job | null, trialName: string }

// Right-hand panel: what happened to the last take
export default function TrialResult({ job, trialName }: Props) {
    if (!job) {
        return (
            <section className="flex-1 flex flex-col gap-2">
                <h2 className="text-large">Last Trial</h2>
                <p className="text-small">Nothing recorded yet. Clap twice after you press Record so the videos can be synced.</p>
            </section>
        )
    }

    const done = FINISHED.includes(job.status)
    const cameraErrors = Object.entries(job.errors ?? {})

    return (
        <section className="flex-1 flex flex-col gap-4">
            <h2 className="text-large">Last Trial: <span className="data">{trialName}</span></h2>

            <p className={job.status === "failed" ? "text-error" : job.status === "complete" ? "text-success" : "text-processing"}>
                {STATUS_TEXT[job.status] ?? job.status}
                {job.error && ` - ${job.error}`}
            </p>

            {cameraErrors.length > 0 && (
                <div>
                    <p className="font-semibold">Camera problems</p>
                    {cameraErrors.map(([serial, msg]) => (
                        <p key={serial} className="text-small">{serial}: {msg}</p>
                    ))}
                </div>
            )}

            {job.results && (
                <div className="flex flex-col gap-2">
                    <p className={job.results.passed ? "text-success" : "text-error"}>
                        Sync check {job.results.passed ? "passed" : "failed, videos weren't synced"}
                    </p>

                    {/* how far each video had to be shifted to line up */}
                    <table className="data text-left">
                        <thead>
                            <tr className="text-small">
                                <th className="pr-6">Video</th>
                                <th className="pr-6">Offset</th>
                                <th>Clap</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(job.results.offsets).map(([file, o]) => (
                                <tr key={file}>
                                    <td className="pr-6">{file}</td>
                                    <td className="pr-6">{(o.offset_seconds * 1000).toFixed(1)} ms</td>
                                    <td>{o.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {job.results.reasons.length > 0 && (
                        <ul className="list-disc pl-6 text-error">
                            {job.results.reasons.map(reason => <li key={reason}>{reason}</li>)}
                        </ul>
                    )}
                </div>
            )}

            {!done && <p className="text-small">This can take a minute for long or high-fps trials.</p>}
        </section>
    )
}
