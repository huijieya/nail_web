import type { Point } from './design'

export const dotColors = [
  { name: '柔白', value: '#fffaf4' },
  { name: '可可褐', value: '#6d5148' },
  { name: '雾蓝', value: '#6987a1' },
  { name: '月银', value: '#c7cbd0' },
  { name: '浅金', value: '#c5a46a' },
]

export function generateRandomDots(mask: HTMLCanvasElement, size: number, spacing: number): Point[] {
  debugger
  const { width, height } = mask
  const pixels = mask.getContext('2d')!.getImageData(0, 0, width, height).data
  const ratio = height / width
  const inset = size / 2 + 0.012
  const step = Math.max(size * spacing, 0.08)
  const minDistance = Math.max(size * 1.2, step * 0.8)
  const inside = (x: number, y: number) => {
    const column = Math.floor(x * width)
    const row = Math.floor(y * width)
    return column >= 0 && column < width && row >= 0 && row < height && pixels[(row * width + column) * 4 + 3] > 240
  }
  let area = 0
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 240) area += 1 / (width * width)
  }
  const count = Math.max(1, Math.round((area * 0.55) / (step * step)))
  const points: Point[] = []
  for (let attempt = 0; attempt < count * 120 && points.length < count; attempt += 1) {
    const x = Math.random()
    const y = Math.random() * ratio
    if (!inside(x, y)) continue
    let fits = true
    for (let angle = 0; angle < 16; angle += 1) {
      const radians = (angle * Math.PI * 2) / 16
      if (!inside(x + Math.cos(radians) * inset, y + Math.sin(radians) * inset)) {
        fits = false
        break
      }
    }
    if (!fits || points.some(point => Math.hypot(point.x - x, point.y * ratio - y) < minDistance)) continue
    points.push({ x, y: y / ratio })
  }
  return points
}

export function automaticDotColor(base: HTMLCanvasElement, mask: HTMLCanvasElement): string {
  const { width, height } = base
  const pixels = base.getContext('2d')!.getImageData(0, 0, width, height).data
  const outline = mask.getContext('2d')!.getImageData(0, 0, width, height).data
  let brightness = 0
  let samples = 0
  // 遍历像素，步长64，不是逐个像素采样，跳着取样
  for (let index = 0; index < pixels.length; index += 64) {
    // mask<240证明不够不透明 → 跳过这个像素
    if (outline[index + 3] < 240) continue
    // sRGB相对亮度简化计算公式
    brightness += (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255
    samples += 1
  }
  // 有采样点 并且 平均亮度>0.58 → 返回可可褐 #6d5148，否则柔白 #fffaf4
  return samples && brightness / samples > 0.58 ? '#6d5148' : '#fffaf4'
}
