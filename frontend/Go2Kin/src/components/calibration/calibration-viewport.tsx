import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

const HOST = "http://localhost:8000"
const API = HOST + "/api/calibration"

type Vec3 = [number, number, number]

type SceneCamera = {
    id: number
    position: Vec3
    rotation: number[][]
    size: [number, number] | null
    fov_y_deg: number | null
}

type Scene = { source: "live" | "saved"; cameras: SceneCamera[] }
type Label = { text: string; position: Vec3; color: string; pill: boolean }

const CAM_COLORS = ["#4C78A8", "#E0893A", "#59A14F", "#B07AA1", "#EDC948", "#76B7B2"]
const AXES: [string, Vec3, string][] = [
    ["X", [1, 0, 0], "#D9544D"],
    ["Y", [0, 1, 0], "#4FA36C"],
    ["Z", [0, 0, 1], "#4A7FD0"],
]

THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

function bounds(cams: SceneCamera[]) {
    const box = new THREE.Box3().setFromPoints(cams.map(c => new THREE.Vector3(...c.position)))
    const size = box.getSize(new THREE.Vector3())
    const halfRange = Math.max(Math.max(size.x, size.y, size.z) / 2 * 1.1, 0.5)
    return { center: box.getCenter(new THREE.Vector3()), halfRange }
}

function toWorld(cam: SceneCamera, [x, y, z]: Vec3): Vec3 {
    const R = cam.rotation
    return [
        cam.position[0] + R[0][0] * x + R[1][0] * y + R[2][0] * z,
        cam.position[1] + R[0][1] * x + R[1][1] * y + R[2][1] * z,
        cam.position[2] + R[0][2] * x + R[1][2] * y + R[2][2] * z,
    ]
}

function frustumSegments(cam: SceneCamera, depth: number): Vec3[] {
    const h = Math.tan(THREE.MathUtils.degToRad(cam.fov_y_deg ?? 60) / 2) * depth
    const w = h * (cam.size ? cam.size[0] / cam.size[1] : 16 / 9)
    const corners = ([
        [-w, -h, depth],
        [w, -h, depth],
        [w, h, depth],
        [-w, h, depth],
    ] as Vec3[]).map(p => toWorld(cam, p))
    const up = toWorld(cam, [0, -h * 1.35, depth])
    return [
        ...corners.flatMap(c => [cam.position, c]),
        ...corners.flatMap((c, i) => [c, corners[(i + 1) % 4]]),
        corners[0], up,
        up, corners[1],
    ]
}

function Segments({ points, color }: { points: Vec3[]; color: string }) {
    const geometry = useMemo(
        () => new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))),
        [points]
    )
    useEffect(() => () => geometry.dispose(), [geometry])
    return (
        <lineSegments geometry={geometry}>
            <lineBasicMaterial color={color} />
        </lineSegments>
    )
}

function Controls({
    center,
    halfRange,
    viewKey,
}: {
    center: THREE.Vector3
    halfRange: number
    viewKey: number
}) {
    const { camera, gl, invalidate } = useThree()
    const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])

    useEffect(() => {
        controls.enableDamping = true
        controls.dampingFactor = 0.12
        const onChange = () => invalidate()
        controls.addEventListener("change", onChange)
        return () => {
            controls.removeEventListener("change", onChange)
            controls.dispose()
        }
    }, [controls, invalidate])

    useEffect(() => {
        const cam = camera as THREE.PerspectiveCamera
        const azim = THREE.MathUtils.degToRad(-60)
        const elev = THREE.MathUtils.degToRad(30)
        const dist = halfRange * 3.2
        cam.position.set(
            center.x + dist * Math.cos(elev) * Math.cos(azim),
            center.y + dist * Math.cos(elev) * Math.sin(azim),
            center.z + dist * Math.sin(elev)
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

function LabelTracker({
    labels,
    refs,
}: {
    labels: Label[]
    refs: RefObject<(HTMLDivElement | null)[]>
}) {
    const v = useMemo(() => new THREE.Vector3(), [])
    useFrame(({ camera, size }) => {
        labels.forEach((label, i) => {
            const el = refs.current[i]
            if (!el) return
            v.set(...label.position).project(camera)
            el.style.display = v.z > 1 ? "none" : ""
            el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${
                ((1 - v.y) / 2) * size.height
            }px) translate(-50%, ${label.pill ? "-150%" : "-50%"})`
        })
    })
    return null
}

function SceneContents({
    scene,
    labels,
    labelRefs,
    viewKey,
}: {
    scene: Scene
    labels: Label[]
    labelRefs: RefObject<(HTMLDivElement | null)[]>
    viewKey: number
}) {
    const { center, halfRange } = useMemo(() => bounds(scene.cameras), [scene])
    const extent = 2 * Math.ceil(halfRange + 1)
    const grid = useMemo(() => {
        const g = new THREE.GridHelper(extent, extent, "#4A4D55", "#3A3D44")
        g.rotation.x = Math.PI / 2
        ;(g.material as THREE.Material).depthWrite = false
        return g
    }, [extent])
    const frustums = useMemo(
        () => scene.cameras.map(c => frustumSegments(c, halfRange * 0.25)),
        [scene, halfRange]
    )

    return (
        <>
            <Controls center={center} halfRange={halfRange} viewKey={viewKey} />
            <LabelTracker labels={labels} refs={labelRefs} />
            <primitive object={grid} />
            {AXES.map(([name, end, color]) => (
                <Segments key={name} points={[[0, 0, 0], end]} color={color} />
            ))}
            {scene.cameras.map((cam, i) => (
                <group key={cam.id}>
                    <Segments points={frustums[i]} color={CAM_COLORS[i % CAM_COLORS.length]} />
                </group>
            ))}
        </>
    )
}

export default function CalibrationViewport() {
    const [scene, setScene] = useState<Scene | null>(null)
    const [error, setError] = useState("Loading 3D preview...")
    const [viewKey, setViewKey] = useState(0)
    const labelRefs = useRef<(HTMLDivElement | null)[]>([])

    async function fetchScene() {
        try {
            const res = await fetch(API + "/scene")
            if (res.status === 404) {
                setScene(null)
                setError("No cameras calibrated yet")
                return
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data: Scene = await res.json()
            setScene(data)
            setError(data.cameras.length ? "" : "No posed cameras")
        } catch {
            setScene(null)
            setError("Calibration service unreachable")
        }
    }

    useEffect(() => {
        fetchScene()
        const timer = setInterval(fetchScene, 2500)
        return () => clearInterval(timer)
    }, [])

    const labels = useMemo<Label[]>(
        () =>
            scene
                ? [
                      ...scene.cameras.map((c, i) => ({
                          text: `Cam ${c.id}`,
                          position: c.position,
                          color: CAM_COLORS[i % CAM_COLORS.length],
                          pill: true,
                      })),
                      ...AXES.map(([name, end, color]) => ({
                          text: name,
                          position: end,
                          color,
                          pill: false,
                      })),
                  ]
                : [],
        [scene]
    )

    return (
        <div className="flex flex-col flex-1 h-full min-h-[480px] bg-[#222428] border-2 border-[#1E88E5] rounded-xl overflow-hidden relative shadow-md">
            {/* Top status bar inside 3D viewer */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-2 pointer-events-auto bg-[#1A1C1E]/90 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white">
                    <span
                        className={`w-2 h-2 rounded-full ${
                            scene && scene.cameras.length > 0 ? "bg-[#00BE13]" : "bg-[#BBBBBB]"
                        }`}
                    />
                    <span>
                        {scene && scene.cameras.length > 0
                            ? `${scene.cameras.length} cameras posed (${scene.source})`
                            : error}
                    </span>
                </div>

                <div className="flex items-center gap-2 pointer-events-auto">
                    <button
                        type="button"
                        onClick={() => setViewKey(k => k + 1)}
                        disabled={!scene}
                        className="px-2.5 py-1 bg-[#1A1C1E]/90 backdrop-blur-xs hover:bg-[#2A2C30] border border-white/10 rounded-md text-xs text-white cursor-pointer disabled:opacity-40"
                    >
                        Reset View
                    </button>
                    <button
                        type="button"
                        onClick={fetchScene}
                        className="px-2.5 py-1 bg-[#1A1C1E]/90 backdrop-blur-xs hover:bg-[#2A2C30] border border-white/10 rounded-md text-xs text-white cursor-pointer"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* Canvas or Empty State */}
            <div className="w-full h-full min-h-[460px] flex-1 relative">
                {scene && scene.cameras.length > 0 ? (
                    <>
                        <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 40 }}>
                            <SceneContents
                                scene={scene}
                                labels={labels}
                                labelRefs={labelRefs}
                                viewKey={viewKey}
                            />
                        </Canvas>
                        {labels.map((l, i) => (
                            <div
                                key={l.text}
                                ref={el => {
                                    labelRefs.current[i] = el
                                }}
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 0,
                                    pointerEvents: "none",
                                    whiteSpace: "nowrap",
                                    font: `${l.pill ? 500 : 600} 11px/1 system-ui, sans-serif`,
                                    letterSpacing: 0.3,
                                    color: l.pill ? "#121212" : l.color,
                                    ...(l.pill && {
                                        background: "rgba(255,255,255,0.92)",
                                        border: `1px solid ${l.color}`,
                                        borderRadius: 999,
                                        padding: "3px 8px",
                                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                    }),
                                }}
                            >
                                {l.text}
                            </div>
                        ))}
                    </>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/50 text-sm select-none p-6 text-center">
                        <svg className="w-12 h-12 stroke-current opacity-30" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" strokeWidth="1" strokeDasharray="2 2" />
                        </svg>
                        <p>{error || "No calibration to show in 3D"}</p>
                        <span className="text-xs text-white/30 max-w-xs">
                            Run extrinsic calibration or click &ldquo;Load Calibration&rdquo; to visualize the 3D camera array.
                        </span>
                    </div>
                )}
            </div>

            {/* Bottom info helper */}
            <div className="absolute bottom-2 right-3 pointer-events-none text-[10px] text-white/40">
                Left click: Rotate • Right click: Pan • Scroll: Zoom
            </div>
        </div>
    )
}
