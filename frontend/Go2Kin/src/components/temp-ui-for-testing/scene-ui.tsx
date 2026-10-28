import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Kept light on purpose: no drei, plain 1px lines, and frameloop="demand" so nothing is
// drawn unless the view or data changes. App.jsx lazy-loads this file, so three.js only
// downloads when the preview is shown.

const HOST = 'http://localhost:8000'
const API = HOST + '/api/calibration'

type Vec3 = [number, number, number]

type SceneCamera = {
    id: number
    position: Vec3
    rotation: number[][]           // world -> camera (OpenCV)
    size: [number, number] | null  // [width, height] px
    fov_y_deg: number | null
}

type Scene = { source: 'live' | 'saved'; cameras: SceneCamera[] }

type Label = { text: string; position: Vec3; color: string; pill: boolean }

// Muted per-camera colours (matplotlib's default cycle, toned down).
const CAM_COLORS = ['#4C78A8', '#E0893A', '#59A14F', '#B07AA1']
const AXES: [string, Vec3, string][] = [['X', [1, 0, 0], '#D9544D'], ['Y', [0, 1, 0], '#4FA36C'], ['Z', [0, 0, 1], '#4A7FD0']]
const BG = '#F6F6F4'

// World frame from the API is Z up, so the three.js camera is set Z up too and no axis swap is needed.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

// Same framing as the tkinter viewer: equal-aspect cube around the cameras, at least 0.5m half-range.
function bounds(cams: SceneCamera[]) {
    const box = new THREE.Box3().setFromPoints(cams.map(c => new THREE.Vector3(...c.position)))
    const size = box.getSize(new THREE.Vector3())
    const halfRange = Math.max(Math.max(size.x, size.y, size.z) / 2 * 1.1, 0.5)
    return { center: box.getCenter(new THREE.Vector3()), halfRange }
}

// Camera-local (OpenCV: x right, y down, z forward) point -> world, via R^T.
function toWorld(cam: SceneCamera, [x, y, z]: Vec3): Vec3 {
    const R = cam.rotation
    return [
        cam.position[0] + R[0][0] * x + R[1][0] * y + R[2][0] * z,
        cam.position[1] + R[0][1] * x + R[1][1] * y + R[2][1] * z,
        cam.position[2] + R[0][2] * x + R[1][2] * y + R[2][2] * z,
    ]
}

// Wireframe frustum (apex -> image plane) plus a small "up" notch, as line-segment pairs.
function frustumSegments(cam: SceneCamera, depth: number): Vec3[] {
    const h = Math.tan(THREE.MathUtils.degToRad(cam.fov_y_deg ?? 60) / 2) * depth
    const w = h * (cam.size ? cam.size[0] / cam.size[1] : 16 / 9)
    const corners = ([[-w, -h, depth], [w, -h, depth], [w, h, depth], [-w, h, depth]] as Vec3[]).map(p => toWorld(cam, p))
    const up = toWorld(cam, [0, -h * 1.35, depth])   // -y is up in OpenCV
    return [
        ...corners.flatMap(c => [cam.position, c]),
        ...corners.flatMap((c, i) => [c, corners[(i + 1) % 4]]),
        corners[0], up, up, corners[1],
    ]
}

function Segments({ points, color }: { points: Vec3[]; color: string }) {
    const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), [points])
    useEffect(() => () => geometry.dispose(), [geometry])
    return (
        <lineSegments geometry={geometry}>
            <lineBasicMaterial color={color} />
        </lineSegments>
    )
}

// three's own OrbitControls (no drei). Damping keeps requesting frames only while it settles.
// Also frames the view at matplotlib's default angle (azim -60, elev 30) on load / Reset view.
function Controls({ center, halfRange, viewKey }: { center: THREE.Vector3; halfRange: number; viewKey: number }) {
    const { camera, gl, invalidate } = useThree()
    const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])

    useEffect(() => {
        controls.enableDamping = true
        controls.dampingFactor = 0.12
        const onChange = () => invalidate()
        controls.addEventListener('change', onChange)
        return () => { controls.removeEventListener('change', onChange); controls.dispose() }
    }, [controls, invalidate])

    useEffect(() => {
        const cam = camera as THREE.PerspectiveCamera
        const azim = THREE.MathUtils.degToRad(-60), elev = THREE.MathUtils.degToRad(30)
        const dist = halfRange * 3.2
        cam.position.set(
            center.x + dist * Math.cos(elev) * Math.cos(azim),
            center.y + dist * Math.cos(elev) * Math.sin(azim),
            center.z + dist * Math.sin(elev),
        )
        cam.near = dist / 1000
        cam.far = dist * 100
        cam.updateProjectionMatrix()
        controls.target.copy(center)
        controls.update()
        invalidate()
    }, [camera, controls, center, halfRange, viewKey, invalidate])

    useFrame(() => controls.update())
    return null
}

// Moves the plain DOM labels (rendered outside the Canvas) to their projected positions each drawn frame.
function LabelTracker({ labels, refs }: { labels: Label[]; refs: RefObject<(HTMLDivElement | null)[]> }) {
    const v = useMemo(() => new THREE.Vector3(), [])
    useFrame(({ camera, size }) => {
        labels.forEach((label, i) => {
            const el = refs.current[i]
            if (!el) return
            v.set(...label.position).project(camera)
            el.style.display = v.z > 1 ? 'none' : ''
            el.style.transform = `translate(${(v.x + 1) / 2 * size.width}px, ${(1 - v.y) / 2 * size.height}px) translate(-50%, ${label.pill ? '-150%' : '-50%'})`
        })
    })
    return null
}

function SceneContents({ scene, labels, labelRefs, viewKey }: {
    scene: Scene; labels: Label[]; labelRefs: RefObject<(HTMLDivElement | null)[]>; viewKey: number
}) {
    const { center, halfRange } = useMemo(() => bounds(scene.cameras), [scene])
    const extent = 2 * Math.ceil(halfRange + 1)   // even, so 1m grid lines land on whole metres
    const grid = useMemo(() => {
        const g = new THREE.GridHelper(extent, extent, '#DCDCD7', '#DCDCD7')
        g.rotation.x = Math.PI / 2   // GridHelper lies in XZ; floor is XY (Z=0)
        ;(g.material as THREE.Material).depthWrite = false   // so the world axes on Z=0 don't z-fight with it
        return g
    }, [extent])
    const frustums = useMemo(() => scene.cameras.map(c => frustumSegments(c, halfRange * 0.25)), [scene, halfRange])

    return (
        <>
            <color attach="background" args={[BG]} />
            <Controls center={center} halfRange={halfRange} viewKey={viewKey} />
            <LabelTracker labels={labels} refs={labelRefs} />

            <primitive object={grid} />
            {AXES.map(([name, end, color]) => <Segments key={name} points={[[0, 0, 0], end]} color={color} />)}

            {scene.cameras.map((cam, i) => (
                <group key={cam.id}>
                    <Segments points={frustums[i]} color={CAM_COLORS[i % CAM_COLORS.length]} />
                    <mesh position={cam.position}>
                        <sphereGeometry args={[halfRange * 0.015, 12, 8]} />
                        <meshBasicMaterial color={CAM_COLORS[i % CAM_COLORS.length]} />
                    </mesh>
                </group>
            ))}
        </>
    )
}

// Temporary UI for the 3D camera-position preview (GET /api/calibration/scene).
// Refetches whenever the current calibration changes (extrinsic, origin, load/apply).
function SceneUI() {
    const [scene, setScene] = useState<Scene | null>(null)
    const [error, setError] = useState('')
    const [calibKey, setCalibKey] = useState<string | null>(null)
    const [viewKey, setViewKey] = useState(0)
    const labelRefs = useRef<(HTMLDivElement | null)[]>([])

    async function fetchScene() {
        try {
            const res = await fetch(API + '/scene')
            const data = await res.json()
            if (!res.ok) { setScene(null); setError(data?.detail ?? `HTTP ${res.status}`); return }
            setScene(data)
            setError('')
        } catch (e) {
            setScene(null)
            setError(`API unreachable: ${e}`)
        }
    }

    // Watch the calibration status; only refetch the scene when the calibration itself changes.
    useEffect(() => {
        async function poll() {
            try {
                const s = await (await fetch(API + '/status')).json()
                const e = s.extrinsic
                setCalibKey(`${s.loaded_file}|${s.origin_set}|${e?.rmse}|${e?.n_cameras}`)
            } catch {
                setCalibKey(null)
            }
        }
        poll()
        const id = setInterval(poll, 2000)
        return () => clearInterval(id)
    }, [])

    useEffect(() => { fetchScene() }, [calibKey])

    const labels = useMemo<Label[]>(() => scene ? [
        ...scene.cameras.map((c, i) => ({ text: `Cam ${c.id}`, position: c.position, color: CAM_COLORS[i % CAM_COLORS.length], pill: true })),
        ...AXES.map(([name, end, color]) => ({ text: name, position: end, color, pill: false })),
    ] : [], [scene])

    return (
        <div>
            <h3>Camera positions</h3>
            <div>
                <button onClick={() => setViewKey(k => k + 1)} disabled={!scene}>Reset view</button>{' '}
                <button onClick={fetchScene}>Refresh</button>{' '}
                {scene
                    ? `${scene.cameras.length} cameras (${scene.source === 'live' ? 'current session' : 'saved file'})`
                    : error}
            </div>

            <div style={{
                width: 720, height: 460, marginTop: 6, borderRadius: 8, overflow: 'hidden',
                background: BG, border: '1px solid #E2E2DE', position: 'relative',
            }}>
                {scene ? (
                    <>
                        <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 40 }}>
                            <SceneContents scene={scene} labels={labels} labelRefs={labelRefs} viewKey={viewKey} />
                        </Canvas>
                        {labels.map((l, i) => (
                            <div
                                key={l.text}
                                ref={el => { labelRefs.current[i] = el }}
                                style={{
                                    position: 'absolute', left: 0, top: 0, pointerEvents: 'none', whiteSpace: 'nowrap',
                                    font: `${l.pill ? 500 : 600} 11px/1 system-ui, sans-serif`, letterSpacing: 0.3,
                                    color: l.pill ? '#333' : l.color,
                                    ...(l.pill && {
                                        background: 'rgba(255,255,255,0.85)', border: `1px solid ${l.color}`,
                                        borderRadius: 999, padding: '3px 7px',
                                    }),
                                }}
                            >
                                {l.text}
                            </div>
                        ))}
                    </>
                ) : (
                    <div style={{
                        height: '100%', display: 'grid', placeItems: 'center',
                        font: '13px system-ui, sans-serif', color: '#999',
                    }}>
                        No calibration to show
                    </div>
                )}
            </div>
        </div>
    )
}

export default SceneUI
