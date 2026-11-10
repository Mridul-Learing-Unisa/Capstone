// Small helpers for the Pose2Sim processing endpoints (code/api/routers/processing.py)
import { request } from "../recording/recording-api"

export type RunState = "idle" | "running" | "stopping" | "complete" | "failed" | "cancelled"

export type StepStatus = "pending" | "processing" | "complete" | "failed" | "cancelled"
export type TrialStatus = "pending" | "processing" | "complete" | "failed" | "skipped" | "cancelled"

// what GET /status returns (only the fields the UI uses)
export type ProcessingStatus = {
    state: RunState
    current_trial: { index: number, total: number, name: string } | null
    current_step: { index: number, name: string } | null
    steps: { name: string, status: StepStatus }[]       // steps of the trial being processed
    trials: { name: string, session: string, status: TrialStatus, error: string | null }[]
}

export const ACTIVE_STATES: RunState[] = ["running", "stopping"]

export function getProcessingStatus(): Promise<ProcessingStatus> {
    return request("/api/processing/status")
}

// trials are processed in the order given; one that fails doesn't stop the rest
export function startProcessing(project: string, session: string, trialNames: string[]) {
    const trialPaths = trialNames.map(name => `${project}/sessions/${session}/${name}`)
    return request("/api/processing/start", "POST", { trial_paths: trialPaths })
}

export function stopProcessing() {
    return request("/api/processing/stop", "POST")
}
