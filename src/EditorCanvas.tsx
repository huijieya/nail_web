import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import type { NailSurface } from './model'
import type { NailDesign, Layer, Point } from './design'
import { isErasableLayer, newLayer } from './design'
import { accessoryPosition } from './accessories'

export type Tool =
  'select' | 'shape' | 'base' | 'french' | 'dots' | 'eraser' | 'sticker2d' | 'sticker3d' | 'accessory' | 'upload'
type Props = {
  model: NailSurface
  canvas?: HTMLCanvasElement
  design: NailDesign
  tool: Tool
  layerId: string
  color: string
  brush: number
  spacing: number
  zoom: number
  onSelectLayer: (id: string) => void
  onPreview: (design: NailDesign) => void
  onCommit: (design: NailDesign) => void
  onCancel: () => void
}

export default function EditorCanvas(props: Props) {
  const {
    model,
    canvas,
    design,
    tool,
    layerId,
    color,
    brush,
    spacing,
    zoom,
    onSelectLayer,
    onPreview,
    onCommit,
    onCancel,
  } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<{ original: NailDesign; draft: NailDesign; layer: Layer; start: Point; last: Point } | null>(
    null,
  )
  const heightRatio = model.mask.height / model.mask.width
  useEffect(() => {
    const target = canvasRef.current!
    target.width = model.mask.width
    target.height = model.mask.height
    if (canvas) target.getContext('2d')!.drawImage(canvas, 0, 0)
  }, [canvas, model])
  const pointAt = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }
  const begin = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = pointAt(event)
    if (
      !model.mask
        .getContext('2d')!
        .getImageData(
          Math.min(model.mask.width - 1, Math.floor(point.x * model.mask.width)),
          Math.min(model.mask.height - 1, Math.floor(point.y * model.mask.height)),
          1,
          1,
        ).data[3]
    )
      return
    const draft = structuredClone(design)
    let layer = draft.layers.find(candidate => candidate.id === layerId)
    if (tool === 'dots') {
      layer = draft.layers.find(candidate => candidate.kind === 'dots')
      if (!layer) {
        layer = newLayer('dots', '手绘波点')
        layer.color = color
        layer.size = brush
        draft.layers.push(layer)
        onSelectLayer(layer.id)
      }
      layer.points.push(point)
    } else if (tool === 'eraser') {
      if (!layer?.visible || !isErasableLayer(layer)) return
      layer.erasures.push({ size: brush, points: [point] })
    } else if (['select', 'sticker2d', 'sticker3d', 'accessory', 'upload'].includes(tool)) {
      if (!layer || !['image', 'accessory'].includes(layer.kind) || !layer.visible) return
    } else return
    gesture.current = { original: design, draft, layer, start: point, last: point }
    event.currentTarget.setPointerCapture(event.pointerId)
    onPreview(structuredClone(draft))
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current
    if (!active) return
    const point = pointAt(event)
    if (tool === 'dots') {
      const distance = Math.hypot(point.x - active.last.x, (point.y - active.last.y) * heightRatio)
      const step = Math.max(active.layer.size * spacing, 0.008)
      if (distance < step) return
      const previous = active.last
      const count = Math.floor(distance / step)
      for (let index = 1; index <= count; index += 1) {
        const fraction = (index * step) / distance
        active.layer.points.push({
          x: previous.x + (point.x - previous.x) * fraction,
          y: previous.y + (point.y - previous.y) * fraction,
        })
      }
      active.last = active.layer.points[active.layer.points.length - 1]
    } else if (tool === 'eraser') active.layer.erasures[active.layer.erasures.length - 1].points.push(point)
    else {
      const original = active.original.layers.find(layer => layer.id === active.layer.id)!
      active.layer.x = Math.max(-1, Math.min(2, original.x + point.x - active.start.x))
      active.layer.y = Math.max(-1, Math.min(2, original.y + point.y - active.start.y))
      if (active.layer.kind === 'accessory') Object.assign(active.layer, accessoryPosition(model.mask, active.layer))
    }
    onPreview(structuredClone(active.draft))
  }
  const finish = (event: PointerEvent<HTMLCanvasElement>, cancel = false) => {
    const active = gesture.current
    if (!active) return
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancel) onCancel()
    else onCommit(structuredClone(active.draft))
  }
  const selected = design.layers.find(layer => layer.id === layerId)
  const anchor = selected?.kind === 'accessory' ? accessoryPosition(model.mask, selected) : selected
  return (
    <div className="drawing-area">
      <div
        className="drawing-surface"
        style={{
          height: `${(Math.min(440, 270 * heightRatio) * zoom) / 100}px`,
          aspectRatio: `${model.width} / ${model.height}`,
        }}
      >
        <canvas
          aria-label="指甲编辑画布"
          ref={canvasRef}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={event => finish(event)}
          onPointerCancel={event => finish(event, true)}
          onLostPointerCapture={event => {
            if (gesture.current) finish(event, true)
          }}
          style={{ cursor: tool === 'dots' || tool === 'eraser' ? 'crosshair' : 'move' }}
        />
        {selected && anchor && ['image', 'accessory'].includes(selected.kind) && selected.visible && (
          <div className="image-anchor" style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}>
            ＋
          </div>
        )}
      </div>
    </div>
  )
}
