import './App.css'
import ProjectUI from './components/temp-ui-for-testing/project-ui'
import CameraUI from './components/temp-ui-for-testing/camera-ui'
import CharucoUI from './components/temp-ui-for-testing/charuco-ui'
import IntrinsicUI from './components/temp-ui-for-testing/intrinsic-ui'
import ExtrinsicUI from './components/temp-ui-for-testing/extrinsic-ui'

function App() {
  return (
    <main>
      <CameraUI />
      <ProjectUI />
      <CharucoUI />
      <IntrinsicUI />
      <ExtrinsicUI />
    </main>
  )
}

export default App
