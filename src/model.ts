import { BufferAttribute, BufferGeometry, Box3, Sphere, Vector3 } from 'three'
import catalog from './nail-masks.json'

export const fingers = ['小拇指', '无名指', '中指', '食指', '大拇指']
export const shapes = ['杏仁形', '方圆形', '方形', '椭圆形', '梯形', '尖形']
export const lengths = ['儿童款', '短', '中', '中长', '长', '超长']
export type NailSurface = { width: number; height: number; mask: HTMLCanvasElement }
export type NailModel = NailSurface & { geometry: BufferGeometry }
export const availableLengths = (shape: string) =>
  lengths.filter(length => catalog.some(entry => entry.shape === shape && entry.length === length))

const memoryCache = new Map<string, ArrayBuffer>()
const surfaceCache = new Map<string, Promise<NailSurface[]>>()
const maskImages = new Map<string, Promise<HTMLImageElement>>()
const cacheName = 'nail-studio-stl-v1'

function entryFor(shape: string, length: string, finger: number) {
  const entry = catalog.find(entry => entry.shape === shape && entry.length === length && entry.finger === finger)
  if (!entry) throw new Error('此甲型没有对应的长度或手指模型')
  return entry
}

export function loadSurfaces(shape: string, length: string) {
  const key = `${shape}/${length}`
  let pending = surfaceCache.get(key)
  if (pending) {
    surfaceCache.delete(key)
    surfaceCache.set(key, pending)
    return pending
  }
  pending = Promise.all(
    fingers.map(async (_, finger): Promise<NailSurface> => {
      const entry = entryFor(shape, length, finger)
      let imagePromise = maskImages.get(entry.mask)
      if (!imagePromise) {
        const image = new Image()
        image.src = entry.mask
        imagePromise = image.decode().then(() => image)
        maskImages.set(entry.mask, imagePromise)
        imagePromise.catch(() => maskImages.delete(entry.mask))
      }
      const image = await imagePromise
      const mask = document.createElement('canvas')
      mask.width = 512
      mask.height = Math.round((512 * entry.height) / entry.width)
      const context = mask.getContext('2d')!
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, mask.width, mask.height)
      return { width: entry.width, height: entry.height, mask }
    }),
  )
  surfaceCache.set(key, pending)
  pending.catch(() => {
    if (surfaceCache.get(key) === pending) surfaceCache.delete(key)
  })
  while (surfaceCache.size > 6) surfaceCache.delete(surfaceCache.keys().next().value as string)
  return pending
}

function remember(url: string, bytes: ArrayBuffer) {
  memoryCache.delete(url)
  memoryCache.set(url, bytes)
  while (memoryCache.size > 8) memoryCache.delete(memoryCache.keys().next().value as string)
}

async function readBytes(url: string, signal: AbortSignal) {
  const memory = memoryCache.get(url)
  if (memory) {
    remember(url, memory)
    return memory.slice(0)
  }
  try {
    const store = await caches.open(cacheName)
    const cached = await store.match(url)
    if (cached) {
      const bytes = await cached.arrayBuffer()
      remember(url, bytes)
      return bytes.slice(0)
    }
  } catch {}
  const response = await fetch(url, { signal, cache: 'force-cache' })
  if (!response.ok) throw new Error(`STL 加载失败 (${response.status})`)
  const bytes = await response.arrayBuffer()
  remember(url, bytes)
  try {
    const store = await caches.open(cacheName)
    await store.put(url, new Response(bytes.slice(0), { headers: { 'Content-Type': 'model/stl' } }))
    const keys = await store.keys()
    for (const key of keys.slice(0, Math.max(0, keys.length - 15))) await store.delete(key)
  } catch {}
  return bytes.slice(0)
}

type WorkerResult = {
  positions: ArrayBuffer
  normals: ArrayBuffer
  uv: ArrayBuffer
  min: number[]
  max: number[]
  error?: string
}
function parseInWorker(bytes: ArrayBuffer, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  const worker = new Worker(new URL('./stl.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<BufferGeometry>((resolve, reject) => {
    const cleanup = () => {
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      cleanup()
      const result = event.data
      if (result.error) {
        reject(new Error(result.error))
        return
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(result.positions), 3))
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(result.normals), 3))
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(result.uv), 2))
      geometry.boundingBox = new Box3(new Vector3().fromArray(result.min), new Vector3().fromArray(result.max))
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere())
      resolve(geometry)
    }
    worker.onerror = event => {
      cleanup()
      reject(new Error(event.message || 'STL Worker 解析失败'))
    }
    worker.postMessage({ buffer: bytes }, [bytes])
  })
}

export async function loadModels(
  shape: string,
  length: string,
  signal: AbortSignal,
  onModel: (finger: number, model: NailModel) => void,
) {
  const surfaces = await loadSurfaces(shape, length)
  for (const finger of [2, 0, 1, 3, 4]) {
    if (signal.aborted) return
    const entry = entryFor(shape, length, finger)
    const bytes = await readBytes(`${encodeURI(entry.source)}?v=${entry.sha256.slice(0, 16)}`, signal)
    const geometry = await parseInWorker(bytes, signal)
    if (signal.aborted) {
      geometry.dispose()
      return
    }
    onModel(finger, { ...surfaces[finger], geometry })
  }
}
