import { useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

const HOST = 'http://localhost:8000'
const API = HOST + '/api/calibration'

type Vec3 = [number, number, number]

type SceneCamera = {
    id: number
    position: Vec3
    look_direction: Vec3
    up_direction: Vec3
    rotation: number[][]           // world -> camera (OpenCV)
    size: [number, number] | null  // [width, height] px
    fov_y_deg: number | null
}

type Scene = { source: 'live' | 'saved'; cameras: SceneCamera[] }

// Muted per-camera colours (matplotlib's default cycle, toned down).
const CAM_COLORS = ['#4C78A8', '#E0893A', '#59A14F', '#B07AA1']
const AXIS_COLORS = { x: '#D9544D', y: '#4FA36C', z: '#4A7FD0' }
const BG = '#F6F6F4'

// World frame from the API is Z up, so the three.js camera is set Z up too and no axis swap is needed.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

// Same framing as the tkinter viewer: equal-aspect cube around the cameras, at least 0.5m half-range.
function bounds(cams: SceneCamera[]) {
    const pts = cams.map(c => new THREE.Vector3(...c.position))
    const box = new THREE.Box3().setFromPoints(pts)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const halfRange = Math.max(Math.max(size.x, size.y, size.z) / 2 * 1.1, 0.5)
    return { center, halfRange }
}

// Camera-local (OpenCV: x right, y down, z forward) point -> world, via R^T.
function toWorld(cam: SceneCamera, p: Vec3): Vec3 {
    const R = cam.rotation
    const [x, y, z] = p
    return [
        cam.position[0] + R[0][0] * x + R[1][0] * y + R[2][0] * z,
        cam.position[1] + R[0][1] * x + R[1][1] * y + R[2][1] * z,
        cam.position[2] + R[0][2] * x + R[1][2] * y + R[2][2] * z,
    ]
}

// Wireframe frustum (apex -> image plane) plus a small "up" tick, so orientation reads at a glance.
function CameraFrustum({ cam, depth, color }: { cam: SceneCamera; depth: number; color: string }) {
    const segments = useMemo(() => {
        const fovY = THREE.MathUtils.degToRad(cam.fov_y_deg ?? 60)
        const aspect = cam.size ? cam.size[0] / cam.size[1] : 16 / 9
        const h = Math.tan(fovY / 2) * depth
        const w = h * aspect
        const corners: Vec3[] = [[-w, -h, depth], [w, -h, depth], [w, h, depth], [-w, h, depth]].map(p => toWorld(cam, p as Vec3))
        const apex = cam.position
        const up = toWorld(cam, [0, -h * 1.35, depth])   // -y is up in OpenCV
        return [
            ...corners.flatMap(c => [apex, c]),
            ...corners.flatMap((c, i) => [c, corners[(i + 1) % 4]]),
            corners[0], up, up, corners[1],
        ]
    }, [cam, depth])

    return (
        <group>
            <Line points={segments} segments color={color} lineWidth={1.4} />
            <mesh position={cam.position}>
                <sphereGeometry args={[depth * 0.06, 16, 16]} />
                <meshBasicMaterial color={color} />
            </mesh>
            <Html position={cam.position} center style={{ pointerEvents: 'none' }}>
                <div style={{
                    transform: 'translateY(-18px)', whiteSpace: 'nowrap',
                    font: '500 11px/1 system-ui, sans-serif', letterSpacing: 0.3,
                    color: '#333', background: 'rgba(255,255,255,0.85)',
                    border: `1px solid ${color}`, borderRadius: 999, padding: '3px 7px',
                }}>
                    Cam {cam.id}
                </div>
            </Html>
        </group>
    )
}

// World origin axes, 1m each (RGB = XYZ), as in the tkinter viewer.
function WorldAxes() {
    const axes: [keyof typeof AXIS_COLORS, Vec3][] = [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]
    return (
        <group>
            {axes.map(([name, end]) => (
                <group key={name}>
                    <Line points={[[0, 0, 0], end]} color={AXIS_COLORS[name]} lineWidth={2} />
                    <Html position={end} center style={{ pointerEvents: 'none' }}>
                        <span style={{ font: '600 11px system-ui, sans-serif', color: AXIS_COLORS[name] }}>
                            {name.toUpperCase()}
                        </span>
                    </Html>
                </group>
            ))}
        </group>
    )
}

// Puts the view camera at matplotlib's default angle (azim -60, elev 30) looking at the scene centre.
function FitView({ center, halfRange }: { center: THREE.Vector3; halfRange: number }) {
    const { camera, controls } = useThree() as unknown as {
        camera: THREE.PerspectiveCamera
        controls: { target: THREE.Vector3; update: () => void } | null
    }
    useEffect(() => {
        const azim = THREE.MathUtils.degToRad(-60), elev = THREE.MathUtils.degToRad(30)
        const dist = halfRange * 3.2
        camera.position.set(
            center.x + dist * Math.cos(elev) * Math.cos(azim),
            center.y + dist * Math.cos(elev) * Math.sin(azim),
            center.z + dist * Math.sin(elev),
        )
        camera.near = dist / 1000
        camera.far = dist * 100
        camera.updateProjectionMatrix()
        if (controls) {
            controls.target.copy(center)
            controls.update()
        } else {
            camera.lookAt(center)
        }
    }, [camera, controls, center, halfRange])
    return null
}

function SceneContents({ scene, viewKey }: { scene: Scene; viewKey: number }) {
    const { center, halfRange } = useMemo(() => bounds(scene.cameras), [scene])
    const extent = Math.ceil(halfRange * 2 + 2)
    return (
        <>
            <color attach="background" args={[BG]} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
            <FitView key={viewKey} center={center} halfRange={halfRange} />

            {/* Floor at Z=0: 0.5m cells, 1m sections. drei's Grid lies in XZ, so rotate it into XY. */}
            <Grid
                rotation={[Math.PI / 2, 0, 0]}
                args={[extent * 2, extent * 2]}
                cellSize={0.5} cellThickness={0.5} cellColor="#E4E4E0"
                sectionSize={1} sectionThickness={0.9} sectionColor="#CDCDC8"
                fadeDistance={extent * 3} fadeStrength={1.5} infiniteGrid
            />
            <WorldAxes />

            {scene.cameras.map((cam, i) => (
                <CameraFrustum key={cam.id} cam={cam} depth={halfRange * 0.25} color={CAM_COLORS[i % CAM_COLORS.length]} />
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
                    <Canvas camera={{ fov: 40 }} dpr={[1, 2]}>
                        <SceneContents scene={scene} viewKey={viewKey} />
                    </Canvas>
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
