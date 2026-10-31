import { lazy, Suspense } from 'react'
import './App.css'
import ProjectUI from './components/temp-ui-for-testing/project-ui'
import CameraUI from './components/temp-ui-for-testing/camera-ui'
import CharucoUI from './components/temp-ui-for-testing/charuco-ui'
import IntrinsicUI from './components/temp-ui-for-testing/intrinsic-ui'
import ExtrinsicUI from './components/temp-ui-for-testing/extrinsic-ui'
import RecordingUI from './components/temp-ui-for-testing/recording-ui'
import ProcessingUI from './components/temp-ui-for-testing/processing-ui'

// Lazy so three.js / R3F download only when the 3D preview is shown, not with the rest of the app.
const SceneUI = lazy(() => import('./components/temp-ui-for-testing/scene-ui'))

function App() {
  return (
    <main>
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
    </main>
  )
}

export default App
