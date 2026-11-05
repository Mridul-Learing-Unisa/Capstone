import { lazy, Suspense } from "react"
import { BrowserRouter, NavLink, Route, Routes } from "react-router"
import TempUIForStyling from "./components/temp-ui-for-styling/temp-ui-for-styling.tsx"
import ProjectUI from "./components/temp-ui-for-testing/project-ui"
import CameraUI from "./components/temp-ui-for-testing/camera-ui"
import CharucoUI from "./components/temp-ui-for-testing/charuco-ui"
import IntrinsicUI from "./components/temp-ui-for-testing/intrinsic-ui"
import ExtrinsicUI from "./components/temp-ui-for-testing/extrinsic-ui"
import RecordingUI from "./components/temp-ui-for-testing/recording-ui"
import ProcessingUI from "./components/temp-ui-for-testing/processing-ui"
import ProjectSelector from "./components/project-control/project-selector.tsx"
import SubjectSelector from "./components/project-control/subject-selector.tsx"
import CalibrationStatus from "./components/project-control/calibration-status.tsx"
import CalibrationTab from "./pages/calibration-tab.tsx"
import RecordingTab from "./pages/recording-tab.tsx"

const SceneUI = lazy(() => import("./components/temp-ui-for-testing/scene-ui"))

// the temp panels for poking each API by hand, kept on the home page for now
function TestingUI() {
  return (
    <>
      <CameraUI />
      <ProjectUI />
      <CharucoUI />
      <IntrinsicUI />
      <ExtrinsicUI />
      <Suspense fallback={<p>Loading 3D preview...</p>}>
        <SceneUI />
      </Suspense>
      <RecordingUI />
      <ProcessingUI />
      <TempUIForStyling />
    </>
  )
}

// grey background on the tab you're on, like the Figma tabs
function tabClass({ isActive }: { isActive: boolean }) {
  return `px-4 py-1 rounded-t ${isActive ? "bg-bg-tertiary" : ""}`
}

function App() {
  return (
    <BrowserRouter>
      <header>
        <ProjectSelector />
        <SubjectSelector />
        <CalibrationStatus />
      </header>

      <nav className="flex gap-2 px-6 pt-2 border-b border-[#BBBBBB]">
        <NavLink to="/" end className={tabClass}>Testing UI</NavLink>
        <NavLink to="/calibration" className={tabClass}>Calibration</NavLink>
        <NavLink to="/recording" className={tabClass}>Recording</NavLink>
      </nav>

      <main className="flex flex-col flex-1">
        <Routes>
          <Route path="/" element={<TestingUI />} />
          <Route path="/calibration" element={<CalibrationTab />} />
          <Route path="/recording" element={<RecordingTab />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App
