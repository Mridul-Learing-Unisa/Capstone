import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router"
import CalibrationTab from "./pages/calibration-tab.tsx"
import ProjectSelector from "./components/projects/project-selector.tsx"
import SubjectSelector from "./components/projects/subject-selector.tsx"
import CalibrationStatus from "./components/projects/calibration-status.tsx"
import RecordingTab from "./pages/recording-tab.tsx"
import Cameras from "./components/cameras/cameras.tsx"

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
        <NavLink to="/calibration" className={tabClass}>Calibration</NavLink>
        <NavLink to="/recording" className={tabClass}>Recording</NavLink>
      </nav>

      {/* min-h-0 lets pages fill exactly the space between the tabs and the footer; anything taller scrolls here */}
      <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/calibration" replace />} />
          <Route path="/calibration" element={<CalibrationTab />} />
          <Route path="/calliberation" element={<Navigate to="/calibration" replace />} />
          <Route path="/recording" element={<RecordingTab />} />
        </Routes>
      </main>

      <footer>
        <Cameras />
      </footer>
    </BrowserRouter>
  )
}

export default App
