import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { NailModel } from './model'
import type { NailDesign } from './design'
import { loadAccessory } from './accessories'
import { placeAccessory } from './accessoryPlacement'

type Props = { models: Array<NailModel | undefined>; canvases: Array<HTMLCanvasElement | undefined>; nails: NailDesign[]; selected: number; onSelect: (index: number) => void }

export default function ThreeDPreview({ models, canvases, nails, selected, onSelect }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const materials = useRef<THREE.MeshPhysicalMaterial[]>([])
  const reset = useRef<() => void>(() => {})
  const [error, setError] = useState('')
  const [accessoryError, setAccessoryError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const nailMeshes = useRef<THREE.Mesh[]>([])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !models.some(Boolean)) return
    const ready = models.map((model, index) => model ? { model, index } : undefined).filter((entry): entry is { model: NailModel; index: number } => Boolean(entry))
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { setError('无法启动 WebGL，请启用浏览器硬件加速；2D 编辑仍然可用。'); return }
    setError('')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#252525')
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 1000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 2))
    const key = new THREE.DirectionalLight('#ffffff', 2.5)
    key.position.set(-40, 40, 80); scene.add(key)
    const fill = new THREE.DirectionalLight('#ffffff', 1)
    fill.position.set(40, -20, 40); scene.add(fill)
    const maxWidth = Math.max(...ready.map(entry => entry.model.width))
    const maxHeight = Math.max(...ready.map(entry => entry.model.height))
    const columnGap = maxWidth + 5, rowGap = maxHeight + 9
    const meshes: THREE.Mesh[] = []
    materials.current = []
    nailMeshes.current = []
    for (let index = 0; index < 10; index += 1) {
      const finger = index % 5
      const model = models[finger]
      if (!model) continue
      const material = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: .38, clearcoat: .6, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(model.geometry, material)
      mesh.position.set((index % 5 - 2) * columnGap, index < 5 ? rowGap / 2 : -rowGap / 2, 0)
      mesh.userData.nail = index
      scene.add(mesh); meshes.push(mesh); materials.current[index] = material
      nailMeshes.current[index] = mesh
    }
    const resize = () => {
      const width = mount.clientWidth || 600, height = mount.clientHeight || 500
      camera.aspect = width / height
      camera.updateProjectionMatrix(); renderer.setSize(width, height, false)
    }
    const fit = () => {
      resize()
      const vertical = (rowGap + maxHeight) / 2
      const horizontal = (4 * columnGap + maxWidth) / 2 / camera.aspect
      const distance = Math.max(vertical, horizontal) / Math.tan(THREE.MathUtils.degToRad(17)) * 1.22
      camera.position.set(0, 0, distance); controls.target.set(0, 0, 0)
      controls.minDistance = distance * .35; controls.maxDistance = distance * 3
      controls.update()
    }
    reset.current = fit
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(mount)
    const raycaster = new THREE.Raycaster()
    let pointerStart = { x: 0, y: 0 }
    const down = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY } }
    const up = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera)
      const hit = raycaster.intersectObjects(meshes, true)[0]
      if (hit) onSelect(hit.object.userData.nail as number)
    }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('dblclick', fit)
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
    return () => {
      observer.disconnect(); controls.dispose(); renderer.setAnimationLoop(null)
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('dblclick', fit)
      materials.current.forEach(material => { material.map?.dispose(); material.dispose() })
      materials.current = []
      nailMeshes.current = []
      renderer.dispose(); renderer.domElement.remove()
    }
  }, [models, onSelect])

  useEffect(() => {
    let active = true
    const attached: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>[] = []
    setAccessoryError('')
    nails.forEach((design, index) => {
      const nail = nailMeshes.current[index], model = models[index % 5]
      if (!nail || !model) return
      design.layers.filter(layer => layer.kind === 'accessory' && layer.visible).forEach(layer => {
        loadAccessory(layer.src).then(({ geometry }) => {
          if (!active) return
          const material = new THREE.MeshPhysicalMaterial({ color: layer.color, roughness: .32, clearcoat: .5, side: THREE.DoubleSide })
          const mesh = new THREE.Mesh(geometry, material)
          mesh.userData.nail = index
          placeAccessory(mesh, nail, model, layer)
          nail.add(mesh); attached.push(mesh)
        }).catch(() => { if (active) setAccessoryError('3D 附件加载失败') })
      })
    })
    return () => { active = false; attached.forEach(mesh => { mesh.removeFromParent(); mesh.material.dispose() }) }
  }, [nails, models, attempt])

  useEffect(() => {
    materials.current.forEach((material, index) => {
      material.map?.dispose()
      const texture = canvases[index] ? new THREE.CanvasTexture(canvases[index]) : null
      if (texture) { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4 }
      material.map = texture; material.needsUpdate = true
    })
  }, [canvases, models])

  useEffect(() => {
    materials.current.forEach((material, index) => { material.emissive.set(index === selected ? '#171321' : '#000000') })
  }, [selected, models])

  return <div className="model-view"><div className="three-mount" ref={mountRef}/>{error && <div role="alert" className="model-error">{error}</div>}{accessoryError && <div role="alert" className="model-error">{accessoryError}<button onClick={() => setAttempt(value => value + 1)}>重试加载附件</button></div>}<button className="view-reset" onClick={() => reset.current()}>重置视角</button><span className="view-help">拖动旋转 · 滚轮缩放 · 点击选择指甲</span></div>
}
