import { BufferAttribute, BufferGeometry, Vector3 } from 'three'

export const fingers = ['小拇指', '无名指', '中指', '食指', '大拇指']
export const shapes = ['杏仁形', '方圆形', '方形', '椭圆形', '梯形', '尖形']
export const lengths = ['短', '中', '中长', '长', '超长']
export type NailModel = { geometry: BufferGeometry; width: number; height: number; mask: HTMLCanvasElement }

const memoryCache = new Map<string, ArrayBuffer>()
const maxMemoryEntries = 8
const cacheName = 'nail-studio-stl-v1'

function remember(url: string, bytes: ArrayBuffer) {
  memoryCache.delete(url)
  memoryCache.set(url, bytes)
  while (memoryCache.size > maxMemoryEntries) memoryCache.delete(memoryCache.keys().next().value as string)
}

async function readBytes(url: string, signal: AbortSignal) {
  const memory = memoryCache.get(url)
  if (memory) { remember(url, memory); return memory.slice(0) }
  return (async () => {
    if (typeof caches !== 'undefined') {
      const store = await caches.open(cacheName)
      const cached = await store.match(url)
      if (cached) { const bytes = await cached.arrayBuffer(); remember(url, bytes); return bytes }
    }
    const response = await fetch(url, { signal, cache: 'force-cache' })
    if (!response.ok) throw new Error(`${url.split('/').pop()} 加载失败 (${response.status})`)
    const bytes = await response.arrayBuffer()
    remember(url, bytes)
    if (typeof caches !== 'undefined') {
      try {
        const store = await caches.open(cacheName)
        await store.put(url, new Response(bytes.slice(0), { headers: { 'Content-Type': 'model/stl' } }))
        const keys = await store.keys()
        if (keys.length > 15) await store.delete(keys[0])
      } catch { /* Cache API unavailable: memory cache still works. */ }
    }
    return bytes
  })()
}

let workerId = 0
function parseInWorker(bytes: ArrayBuffer, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  const worker = new Worker(new URL('./stl.worker.ts', import.meta.url), { type: 'module' })
  const id = ++workerId
  return new Promise<BufferGeometry>((resolve, reject) => {
    const abort = () => { worker.terminate(); reject(new DOMException('Aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    worker.onmessage = (event: MessageEvent<{ id: number; positions?: ArrayBuffer; error?: string }>) => {
      if (event.data.id !== id) return
      cleanup()
      if (!event.data.positions) { reject(new Error(event.data.error || 'STL 解析失败')); return }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(event.data.positions), 3))
      resolve(geometry)
    }
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'STL Worker 解析失败')) }
    worker.postMessage({ id, buffer: bytes }, [bytes])
  })
}

export function modelUrl(shape: string, length: string, finger: number) {
  const folder = shape === '尖形' ? '尖形-水滴形' : shape
  const prefix = shape === '尖形' ? '尖形水滴形' : shape === '梯形' ? '梯形棺材形' : shape
  return encodeURI(`/甲型/${folder}/${length}/${prefix}${length}款${fingers[finger]}.stl`)
}

export function orientGeometry(geometry: BufferGeometry) {
  geometry.center()
  geometry.rotateY(Math.PI)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox!
  const size = bounds.getSize(new Vector3())
  const positions = geometry.getAttribute('position')
  const uv = new Float32Array(positions.count * 2)
  for (let index = 0; index < positions.count; index += 1) {
    uv[index * 2] = (positions.getX(index) - bounds.min.x) / size.x
    uv[index * 2 + 1] = (positions.getY(index) - bounds.min.y) / size.y
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.computeVertexNormals()
  return { geometry, width: size.x, height: size.y }
}

export function projectMask(geometry: BufferGeometry, width: number, height: number) {
  const mask = document.createElement('canvas')
  mask.width = 512
  mask.height = Math.round(512 * height / width)
  const context = mask.getContext('2d')!
  const uv = geometry.getAttribute('uv')
  context.fillStyle = '#fff'
  const path = new Path2D()
  for (let index = 0; index < uv.count; index += 3) {
    const first = [uv.getX(index) * mask.width, (1 - uv.getY(index)) * mask.height]
    const second = [uv.getX(index + 1) * mask.width, (1 - uv.getY(index + 1)) * mask.height]
    const third = [uv.getX(index + 2) * mask.width, (1 - uv.getY(index + 2)) * mask.height]
    const area = (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])
    if (Math.abs(area) < 0.00001) continue
    path.moveTo(first[0], first[1])
    if (area > 0) { path.lineTo(second[0], second[1]); path.lineTo(third[0], third[1]) }
    else { path.lineTo(third[0], third[1]); path.lineTo(second[0], second[1]) }
    path.closePath()
  }
  context.fill(path)
  return mask
}

export async function loadModel(shape: string, length: string, finger: number, signal: AbortSignal): Promise<NailModel> {
  const bytes = await readBytes(modelUrl(shape, length, finger), signal)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const geometry = await parseInWorker(bytes, signal)
  try {
    const oriented = orientGeometry(geometry)
    return { ...oriented, mask: projectMask(oriented.geometry, oriented.width, oriented.height) }
  } catch (error) { geometry.dispose(); throw error }
}

export async function loadModels(shape: string, length: string, signal: AbortSignal, priority = 2, onModel?: (finger: number, model: NailModel) => void) {
  const order = [priority, ...fingers.map((_, index) => index).filter(index => index !== priority)]
  const models: Array<NailModel | undefined> = []
  const loadOne = async (finger: number) => {
    const model = await loadModel(shape, length, finger, signal)
    if (signal.aborted) { model.geometry.dispose(); return }
    models[finger] = model
    onModel?.(finger, model)
  }
  await loadOne(priority)
  await Promise.all(order.slice(1).map(loadOne))
  return models
}
