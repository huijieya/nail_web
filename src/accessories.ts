import * as THREE from 'three'
import { accessoryCatalog } from './accessoryCatalog'
import type { Layer } from './design'

type Accessory = { geometry: THREE.BufferGeometry; thumbnail?: HTMLCanvasElement }
type WorkerResult = { positions: Float32Array; normals: Float32Array; indices: Uint32Array | null; error?: string }
const cache = new Map<string, Promise<Accessory>>()
let queue: Promise<unknown> = Promise.resolve()

export function loadAccessory(src: string): Promise<Accessory> {
  const existing = cache.get(src)
  if (existing) return existing
  const entry = accessoryCatalog.find(candidate => candidate.src === src)
  if (!entry) return Promise.reject(new Error('未知的 3D 附件'))
  const pending = queue.catch(() => {}).then(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}${src.slice(1)}`)
    if (!response.ok) throw new Error(`${entry.name}加载失败，请重试`)
    const buffer = await response.arrayBuffer()
    const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
      const worker = new Worker(new URL('./accessory.worker.ts', import.meta.url), { type: 'module' })
      const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('附件处理超时，请重试')) }, 60000)
      const finish = () => { window.clearTimeout(timeout); worker.terminate() }
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        finish()
        if (event.data.error) { reject(new Error(event.data.error)); return }
        const result = new THREE.BufferGeometry()
        result.setAttribute('position', new THREE.BufferAttribute(event.data.positions, 3))
        result.setAttribute('normal', new THREE.BufferAttribute(event.data.normals, 3))
        if (event.data.indices) result.setIndex(new THREE.BufferAttribute(event.data.indices, 1))
        result.computeBoundingBox(); result.computeBoundingSphere()
        resolve(result)
      }
      worker.onerror = () => { finish(); reject(new Error('附件处理失败，请重试')) }
      worker.postMessage({ buffer, rotationX: entry.rotationX, rotationZ: entry.rotationZ }, [buffer])
    })
    return { geometry }
  })
  cache.set(src, pending)
  queue = pending
  pending.catch(() => { if (cache.get(src) === pending) cache.delete(src) })
  return pending
}

export async function accessoryThumbnail(src: string) {
  const accessory = await loadAccessory(src)
  if (accessory.thumbnail) return accessory.thumbnail
  const bounds = accessory.geometry.boundingBox!
  const height = bounds.max.y - bounds.min.y
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  const material = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: .32, clearcoat: .5, side: THREE.DoubleSide })
  try {
    renderer.setSize(384, Math.max(1, Math.round(384 * height)), false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-.5, .5, height / 2, -height / 2, .01, 100)
    camera.position.set(0, 0, bounds.max.z + 5); camera.lookAt(0, 0, 0)
    scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 1.5))
    const light = new THREE.DirectionalLight('#ffffff', 2.5)
    light.position.set(-3, 4, 6); scene.add(light)
    scene.add(new THREE.Mesh(accessory.geometry, material))
    renderer.render(scene, camera)
    const canvas = document.createElement('canvas')
    canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height
    canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0)
    accessory.thumbnail = canvas
    return canvas
  } finally { material.dispose(); renderer.dispose(); renderer.forceContextLoss() }
}

const outlines = new WeakMap<HTMLCanvasElement, Array<{ min: number; max: number }>>()
export function accessoryPosition(mask: HTMLCanvasElement, point: { x: number; y: number }) {
  let rows = outlines.get(mask)
  if (!rows) {
    const pixels = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data
    rows = Array.from({ length: mask.height }, (_, row) => {
      let min = mask.width, max = -1
      for (let column = 0; column < mask.width; column += 1) {
        if (pixels[(row * mask.width + column) * 4 + 3] > 200) { min = Math.min(min, column); max = column }
      }
      return { min, max }
    })
    outlines.set(mask, rows)
  }
  const targetRow = Math.max(0, Math.min(mask.height - 1, Math.round(point.y * mask.height)))
  let nearest = targetRow
  if (rows[nearest].max < rows[nearest].min) {
    nearest = rows.reduce((best, row, index) => row.max >= row.min && (best < 0 || Math.abs(index - targetRow) < Math.abs(best - targetRow)) ? index : best, -1)
  }
  if (nearest < 0) return { x: .5, y: .5 }
  const row = rows[nearest]
  return { x: Math.max((row.min + .5) / mask.width, Math.min((row.max + .5) / mask.width, point.x)), y: (nearest + .5) / mask.height }
}

export async function compositeAccessories(canvas: HTMLCanvasElement, mask: HTMLCanvasElement, layers: Layer[]) {
  const visible = layers.filter(layer => layer.kind === 'accessory' && layer.visible)
  if (!visible.length) return canvas
  const thumbnails = await Promise.all(visible.map(layer => accessoryThumbnail(layer.src)))
  const result = document.createElement('canvas')
  result.width = canvas.width; result.height = canvas.height
  const context = result.getContext('2d')!
  context.drawImage(canvas, 0, 0)
  visible.forEach((layer, index) => {
    const thumbnail = thumbnails[index]
    const tinted = document.createElement('canvas')
    tinted.width = thumbnail.width; tinted.height = thumbnail.height
    const painter = tinted.getContext('2d')!
    painter.drawImage(thumbnail, 0, 0)
    painter.globalCompositeOperation = 'multiply'; painter.fillStyle = layer.color; painter.fillRect(0, 0, tinted.width, tinted.height)
    painter.globalCompositeOperation = 'destination-in'; painter.drawImage(thumbnail, 0, 0)
    const position = accessoryPosition(mask, layer)
    const width = layer.scale * canvas.width, height = width * tinted.height / tinted.width
    context.save(); context.translate(position.x * canvas.width, position.y * canvas.height); context.rotate(layer.rotation * Math.PI / 180)
    context.shadowColor = '#00000055'; context.shadowBlur = 5; context.shadowOffsetY = 3
    context.drawImage(tinted, -width / 2, -height / 2, width, height); context.restore()
  })
  return result
}
