import { availableLengths, shapes } from './model'

export type Point = { x: number; y: number }
export type Stroke = { points: Point[]; size: number }
export type Layer = {
  id: string; name: string; kind: 'dots' | 'image' | 'french'; visible: boolean
  color: string; size: number; points: Point[]; src: string
  x: number; y: number; scale: number; rotation: number; depth: number; curve: number
  erasures: Stroke[]
}
export type NailDesign = { base: string; color: string; layers: Layer[] }
export type Project = { version: 1; name: string; shape: string; length: string; nails: NailDesign[] }
export const storageKey = 'nail-studio-project-v1'
export const newProject = (): Project => ({ version: 1, name: '未命名设计', shape: '杏仁形', length: '中长', nails: Array.from({ length: 10 }, () => ({ base: '', color: '#cd9caa', layers: [] })) })
export const newLayer = (kind: Layer['kind'], name: string): Layer => ({ id: crypto.randomUUID(), kind, name, visible: true, color: '#fff5ed', size: .04, points: [], src: '', x: .5, y: .5, scale: .45, rotation: 0, depth: .22, curve: .15, erasures: [] })

export function parseProject(raw: string): Project {
  const value = JSON.parse(raw) as Project
  const validSource = (source: unknown) => typeof source === 'string' && (source === '' || source.startsWith('/material/') || /^data:image\/(png|jpeg|webp);base64,/.test(source))
  const number = (candidate: unknown, min: number, max: number) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= min && candidate <= max
  const point = (candidate: Point) => candidate && number(candidate.x, -2, 3) && number(candidate.y, -2, 3)
  const color = (candidate: unknown) => typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate)
  if (!value || value.version !== 1 || typeof value.name !== 'string' || value.name.length > 100 || !shapes.includes(value.shape) || !availableLengths(value.shape).includes(value.length) || !Array.isArray(value.nails) || value.nails.length !== 10) throw new Error('不是有效的美甲项目文件')
  for (const nail of value.nails) {
    if (!nail || !validSource(nail.base) || !color(nail.color) || !Array.isArray(nail.layers) || nail.layers.length > 200) throw new Error('画稿数据无效')
    const ids = new Set<string>()
    for (const layer of nail.layers) {
      if (!layer || typeof layer.id !== 'string' || ids.has(layer.id) || typeof layer.name !== 'string' || typeof layer.visible !== 'boolean' || !['dots','image','french'].includes(layer.kind) || !validSource(layer.src) || !color(layer.color) || !number(layer.size, .001, 1) || !number(layer.x, -2, 3) || !number(layer.y, -2, 3) || !number(layer.scale, .01, 3) || !number(layer.rotation, -360, 360) || !number(layer.depth, 0, 1) || !number(layer.curve, 0, 1) || !Array.isArray(layer.points) || layer.points.length > 20000 || !layer.points.every(point) || !Array.isArray(layer.erasures) || layer.erasures.length > 2000 || !layer.erasures.every(stroke => stroke && number(stroke.size, .001, 1) && Array.isArray(stroke.points) && stroke.points.length <= 20000 && stroke.points.every(point))) throw new Error('图层数据无效')
      ids.add(layer.id)
    }
  }
  for (const nail of value.nails) {
    for (const kind of ['french', 'dots'] as const) {
      let last = -1
      nail.layers.forEach((layer, index) => { if (layer.kind === kind) last = index })
      if (last >= 0) nail.layers = nail.layers.filter((layer, index) => layer.kind !== kind || index === last)
    }
  }
  return value
}

const images = new Map<string, Promise<HTMLImageElement>>()
export function loadImage(src: string) {
  let pending = images.get(src)
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => { images.delete(src); reject(new Error('素材图片加载失败')) }
      image.src = src
    })
    images.set(src, pending)
  }
  return pending
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  return canvas
}

export async function renderDesign(design: NailDesign, mask: HTMLCanvasElement) {
  const sources = [design.base, ...design.layers.filter(layer => layer.visible).map(layer => layer.src)].filter(Boolean)
  const loaded = new Map(await Promise.all([...new Set(sources)].map(async src => [src, await loadImage(src)] as const)))
  const width = mask.width, height = mask.height
  const canvas = makeCanvas(width, height)
  const context = canvas.getContext('2d')!
  context.fillStyle = design.color
  context.fillRect(0, 0, width, height)
  console.log('design', design)
  if (design.base) context.drawImage(loaded.get(design.base)!, 0, 0, width, height)
  for (const layer of design.layers) {
    if (!layer.visible) continue
    const surface = makeCanvas(width, height)
    const painter = surface.getContext('2d')!
    painter.fillStyle = layer.color
    if (layer.kind === 'dots') {
      for (const point of layer.points) {
        painter.beginPath(); painter.arc(point.x * width, point.y * height, layer.size * width / 2, 0, Math.PI * 2); painter.fill()
      }
    } else if (layer.kind === 'french') {
      painter.beginPath(); painter.moveTo(0, height * (1 - layer.depth - layer.curve))
      painter.quadraticCurveTo(width / 2, height * (1 - layer.depth + layer.curve), width, height * (1 - layer.depth - layer.curve))
      painter.lineTo(width, height); painter.lineTo(0, height); painter.closePath(); painter.fill()
      if (layer.src) { painter.globalCompositeOperation = 'source-atop'; painter.drawImage(loaded.get(layer.src)!, 0, 0, width, height); painter.globalCompositeOperation = 'source-over' }
    } else if (layer.src) {
      const image = loaded.get(layer.src)!
      const imageWidth = width * layer.scale, imageHeight = imageWidth * image.height / image.width
      painter.save(); painter.translate(layer.x * width, layer.y * height); painter.rotate(layer.rotation * Math.PI / 180)
      painter.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight); painter.restore()
    }
    painter.globalCompositeOperation = 'destination-out'
    painter.lineCap = 'round'; painter.lineJoin = 'round'
    for (const stroke of layer.erasures) {
      painter.lineWidth = stroke.size * width
      painter.beginPath()
      stroke.points.forEach((point, index) => { if (index === 0) painter.moveTo(point.x * width, point.y * height); else painter.lineTo(point.x * width, point.y * height) })
      painter.stroke()
      if (stroke.points.length === 1) { painter.beginPath(); painter.arc(stroke.points[0].x * width, stroke.points[0].y * height, stroke.size * width / 2, 0, Math.PI * 2); painter.fill() }
    }
    context.drawImage(surface, 0, 0)
  }
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(mask, 0, 0)
  context.globalCompositeOperation = 'source-over'
  return canvas
}
