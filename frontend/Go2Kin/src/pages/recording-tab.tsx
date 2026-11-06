import { useEffect, useState } from "react"
import RecordTrial from "../components/recording/record-trial"
// import SessionTrials from "../components/recording/session-trials"
// import CameraGrid from "../components/recording/camera-grid"
import {
    FINISHED, getCameras, getJob, getRecordingStatus, getSavedSoundSource, getSelection, nextTrialName,
    startRecording, stopRecording, type Camera, type Job, type Selection,
} from "../components/recording/recording-api"
import TrialsList from "../components/recording/trials-list"
import ProcessTrials from "../components/processing/process-trials"

// what to show under the Record button while the job runs
const JOB_TEXT: Record<string, string> = {
    pending: "Getting ready to download...",
    downloading: "Downloading videos from the cameras...",
    syncing: "Syncing videos using the clap...",
}

// Recording tab from the V1 Figma design.
// Left: trial setup, the session's trials and the record button. Right: camera tiles.
// It records with every connected camera, same as the tkinter app.
export default function RecordingTab() {
    const [trialName, setTrialName] = useState("TEMP")
    const [sound, setSound] = useState(["0.0", "0.0", "0.0"])   // replaced by the last used one on load

    const [cameras, setCameras] = useState<Camera[]>([])
    const [selection, setSelection] = useState<Selection>({ project: null, session: null })
    const [apiDown, setApiDown] = useState(false)

    const [startedAt, setStartedAt] = useState<number | null>(null)   // null = not recording
    const [recordingCams, setRecordingCams] = useState<string[]>([])  // cameras that actually started
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    const [job, setJob] = useState<Job | null>(null)       // download + sync after stopping
    const [jobTrial, setJobTrial] = useState("")            // the trial that job belongs to
    const [trialsVersion, setTrialsVersion] = useState(0)   // bump to reload the trials list
    // trials ticked in TrialsList (for Process), remembered with the session they belong to
    const [picked, setPicked] = useState({ session: "", names: [] as string[] })

    // check cameras and the selected project/session every 3s
    useEffect(() => {
        async function refresh() {
            try {
                const [cams, sel] = await Promise.all([getCameras(), getSelection()])
                setCameras(cams)
                setSelection(sel)
                setApiDown(false)
            } catch {
                setApiDown(true)
            }
        }
        refresh()
        const timer = setInterval(refresh, 3000)
        return () => clearInterval(timer)
    }, [])

    // start from the last sound source used (like tkinter), and if the page gets
    // refreshed mid-take, pick up where the server is at
    useEffect(() => {
        async function load() {
            const saved = await getSavedSoundSource().catch(() => null)
            if (saved) setSound(saved)

            const status = await getRecordingStatus()
            if (status.state === "idle" || !status.trial_name) return
            setTrialName(status.trial_name)
            if (status.sound_source_position?.length === 3) {
                setSound(status.sound_source_position.map(String))
            }
            if (status.state === "recording" && status.started_at) {
                setRecordingCams(status.cameras_used ?? [])
                setStartedAt(status.started_at * 1000)
            } else if (status.task_id) {
                setJobTrial(status.trial_name)
                setJob({ task_id: status.task_id, status: status.job_status ?? "pending", results: null })
            }
        }
        load().catch(() => { /* API is down, the refresh above already shows that */ })
    }, [])

    // keep checking the job every second until it's finished
    const jobId = job?.task_id
    const jobRunning = job !== null && !FINISHED.includes(job.status)
    useEffect(() => {
        if (!jobId || !jobRunning) return
        const timer = setInterval(async () => {
            try {
                const latest = await getJob(jobId)
                setJob(latest)
                if (FINISHED.includes(latest.status)) {
                    // the trial folder is used up either way, so move to the next name
                    setTrialName(name => nextTrialName(name))
                    setTrialsVersion(v => v + 1)
                }
            } catch { /* try again next tick */ }
        }, 1000)
        return () => clearInterval(timer)
    }, [jobId, jobRunning])

    const recording = startedAt !== null
    const connected = cameras.filter(c => c.status === "connected")
    // Number("") is 0 and Number("Infinity") is Infinity, so check both
    const soundOk = sound.every(v => v.trim() !== "" && Number.isFinite(Number(v)))
    const hasSession = !!selection.project && !!selection.session

    // work out the hint under the button, first problem wins
    let message = "Press Record to start recording"
    let canStart = false
    if (busy) message = recording ? "Stopping the cameras..." : "Starting the cameras..."
    else if (recording) message = `Recording with ${recordingCams.length} camera(s)... clap twice!`
    else if (jobRunning) message = JOB_TEXT[job.status] ?? job.status
    else if (apiDown) message = "Can't reach the API, is the server running?"
    else if (!hasSession) message = "Pick a project and session first"
    else if (connected.length === 0) message = "Connect at least one camera"
    else if (trialName.trim() === "") message = "Give the trial a name"
    else if (!soundOk) message = "Sound source X, Y and Z need to be numbers"
    else {
        canStart = true
        if (job?.status === "complete") message = `${jobTrial} saved and synced. Ready for the next one`
    }

    // explain why the last trial failed (sync check reasons or a server error)
    let jobError = ""
    if (job?.status === "failed") {
        const reasons = job.results?.reasons ?? []
        jobError = `${jobTrial} wasn't synced: ${job.error ?? (reasons.join("; ") || "unknown error")}`
    }

    async function handleStart() {
        setBusy(true)
        setError("")
        try {
            const result = await startRecording(trialName.trim(), connected.map(c => c.serial), sound.map(Number))
            // the server carries on with the cameras that did start, so just warn about the rest
            const failed = Object.keys(result.failed ?? {})
            if (failed.length > 0) {
                const names = failed.map(serial => cameras.find(c => c.serial === serial)?.name ?? serial)
                setError(`Not recording on: ${names.join(", ")}`)
            }
            setRecordingCams(result.cameras_used)
            setJob(null)
            setStartedAt(Date.now())
            setTrialsVersion(v => v + 1)   // start makes the trial folder, so show it
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy(false)
    }

    async function handleStop() {
        setBusy(true)
        setError("")
        try {
            const result = await stopRecording()
            setStartedAt(null)
            setJobTrial(trialName.trim())
            setJob({ ...result, results: null })
            // stop can fail straight away if no camera could stop
            if (FINISHED.includes(result.status)) setTrialName(name => nextTrialName(name))
        } catch (e) {
            setError((e as Error).message)
        }
        setBusy(false)
    }

    // ticks from another session don't count, so switching session clears them
    const sessionKey = `${selection.project}/${selection.session}`
    const selectedTrials = picked.session === sessionKey ? picked.names : []

    let activeTrial: string | null = null
    if (recording) activeTrial = trialName.trim()
    else if (jobRunning) activeTrial = jobTrial

    return (
        // fill the height between the tabs and the footer, so the trials list can run full height.
        // pb is 1rem because the footer adds its own 0.5rem, making the gap 1.5rem top and bottom.
        <div className="w-full flex-1 min-h-0 flex gap-[1.5rem] px-[1.5rem] pt-[1.5rem] pb-[1rem]">
            <div className="w-[38rem] flex flex-col gap-6 shrink-0">
                <RecordTrial
                    trialName={trialName}
                    sound={sound}
                    locked={recording || busy || jobRunning}
                    onTrialNameChange={setTrialName}
                    onSoundChange={setSound}
                    startedAt={startedAt}
                    canStart={canStart}
                    busy={busy}
                    message={message}
                    error={error || jobError}
                    onStart={handleStart}
                    onStop={handleStop}
                />
                <ProcessTrials />
            </div>

            <TrialsList
                selection={selection}
                activeTrial={activeTrial}
                refreshKey={trialsVersion}
                selected={selectedTrials}
                onSelectedChange={names => setPicked({ session: sessionKey, names })}
            />
            {/* <CameraGrid cameras={cameras} disabled={recording || busy} /> */}
        </div>
    )
}
