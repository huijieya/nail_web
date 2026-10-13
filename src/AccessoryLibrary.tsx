import { useEffect, useState } from 'react'
import { accessoryCatalog } from './accessoryCatalog'
import { accessoryThumbnail } from './accessories'

export default function AccessoryLibrary({ onAdd }: { onAdd: (src: string, name: string) => void }) {
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setErrors({})
    accessoryCatalog.forEach(entry => {
      accessoryThumbnail(entry.src)
        .then(canvas => {
          if (active) setPreviews(previous => ({ ...previous, [entry.src]: canvas.toDataURL() }))
        })
        .catch(() => {
          if (active) setErrors(previous => ({ ...previous, [entry.src]: '加载失败' }))
        })
    })
    return () => {
      active = false
    }
  }, [attempt])
  return (
    <div className="accessory-library">
      <div className="accessory-model-grid">
        {accessoryCatalog.map(entry => (
          <button
            key={entry.src}
            className="accessory-model-card"
            disabled={!previews[entry.src]}
            onClick={() => onAdd(entry.src, entry.name)}
            title={`添加${entry.name}到当前指甲`}
          >
            <span className="accessory-model-image">
              {previews[entry.src] ? (
                <img src={previews[entry.src]} alt={entry.name} />
              ) : (
                <span role="status">{errors[entry.src] || '模型加载中…'}</span>
              )}
            </span>
            <strong>{entry.name}</strong>
            <small>＋ 添加附件</small>
          </button>
        ))}
      </div>
      {Object.keys(errors).length > 0 && (
        <button className="panel-button secondary" onClick={() => setAttempt(value => value + 1)}>
          重试加载附件
        </button>
      )}
      <p className="small-note">点击添加，可在 2D 中拖动，或调整下方位置、尺寸、旋转和颜色。切换 3D 查看立体效果。</p>
    </div>
  )
}
