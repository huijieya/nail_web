import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import EditorCanvas from './EditorCanvas'
import type { Tool } from './EditorCanvas'
import { availableLengths, fingers, shapes } from './model'
import { loadImage, newLayer, parseProject, renderDesign } from './design'
import type { Layer, NailDesign } from './design'
import { useCanvases, useModels, useProject, useSurfaces } from './useEditor'
import assets from './assets.json'
import { materialCrop } from './materials'
import './editor.css'

const ThreeDPreview = lazy(() => import('./ThreeDPreview'))

const tools: { id: Tool; name: string; icon: string; hint: string }[] = [
  { id: 'select', name: '选择 / 移动', icon: '↖', hint: '选择图层拖动画布中的选中饰品' },
  { id: 'shape', name: '甲型', icon: '◇', hint: '选择甲型和长度' },
  { id: 'base', name: '底胶', icon: '◐', hint: '给当前指甲设置底胶' },
  { id: 'french', name: '法式', icon: '⌒', hint: '添加可调节的微笑线' },
  { id: 'dots', name: '波点', icon: '⠿', hint: '点击或拖动绘制波点' },
  { id: 'eraser', name: '橡皮擦', icon: '⌫', hint: '擦除选中图层，保留底胶' },
  { id: 'sticker2d', name: '2D 饰品', icon: '✦', hint: '添加贝壳饰品贴图' },
  { id: 'sticker3d', name: '立体饰品素材', icon: '⬡', hint: '使用金属饰品图片作为贴图' },
  { id: 'upload', name: '上传图片', icon: '↥', hint: '上传图片并添加可编辑图层' },
]
const categoryNames: Record<string, string> = { base_coat_pink: '粉色胶', base_coat_purple: '紫色胶', base_coat_french: '法式胶', '3D_accessory_shell': '贝壳饰品', '3D_accessory_metal': '金属饰品' }
const assetName = (src: string) => {
  const category = src.split('/')[2]
  return `${categoryNames[category] || '素材'} ${src.match(/_(\d+)\./)?.[1] || ''}`
}
const nailName = (index: number) => `${index < 5 ? '左手' : '右手'} · ${fingers[index % 5]}`
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const { project, commit, undo, redo, canUndo, canRedo, saveStatus } = useProject()
  const [tool, setTool] = useState<Tool>('shape')
  const [view, setView] = useState<'2D' | '3D'>('2D')
  const [selected, setSelected] = useState(2)
  const [layerId, setLayerId] = useState('')
  const [draft, setDraft] = useState<NailDesign | null>(null)
  const [zoom, setZoom] = useState(100)
  const [color, setColor] = useState('#fff5ed')
  const [brush, setBrush] = useState(.05)
  const [spacing, setSpacing] = useState(2.5)
  const [depth, setDepth] = useState(.22)
  const [curve, setCurve] = useState(.15)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const projectInput = useRef<HTMLInputElement>(null)
  const { surfaces, error: surfaceError, retry: retrySurfaces } = useSurfaces(project.shape, project.length)
  const { models, loaded, error: modelError, retry } = useModels(project.shape, project.length, view === '3D')
  const nails = useMemo(() => project.nails.map((nail, index) => index === selected && draft ? draft : nail), [project.nails, selected, draft])
  const { canvases, error: renderError } = useCanvases(nails, surfaces)
  const nail = nails[selected]
  const layer = nail.layers.find(candidate => candidate.id === layerId)
  const frenchLayer = nail.layers.find(candidate => candidate.kind === 'french')
  const dotsLayer = nail.layers.find(candidate => candidate.kind === 'dots')
  const activeTool = tools.find(candidate => candidate.id === tool)!
  const currentModel = surfaces[selected % 5]

  const selectNail = useCallback((index: number) => { setSelected(index); setDraft(null); setLayerId('') }, [])
  const clearDesign = () => {
    setDraft(null)
    setLayerId('')
    commit(previous => ({ ...previous, nails: previous.nails.map(() => ({ base: '', color: '#ffffff', layers: [] })) }))
    setNotice('已清空十指设计，保留甲型和长度；可撤销恢复')
  }
  const editNail = (update: (nail: NailDesign) => NailDesign, index = selected) => {
    setDraft(null)
    commit(previous => ({ ...previous, nails: previous.nails.map((entry, position) => position === index ? update(entry) : entry) }))
  }
  const patchLayer = (patch: Partial<Layer>) => editNail(previous => ({ ...previous, layers: previous.layers.map(entry => entry.id === layerId ? { ...entry, ...patch } : entry) }))
  const addLayer = (entry: Layer) => { editNail(previous => ({ ...previous, layers: [...previous.layers, entry] })); setLayerId(entry.id) }
  const replaceExclusiveLayer = (entry: Layer) => {
    const existing = nail.layers.find(candidate => candidate.kind === entry.kind)
    const targetId = existing?.id || entry.id
    editNail(previous => {
      const existingIndex = previous.layers.findIndex(candidate => candidate.kind === entry.kind)
      const layers = previous.layers.filter(candidate => candidate.kind !== entry.kind)
      const next = { ...entry, id: targetId }
      layers.splice(existingIndex < 0 ? layers.length : Math.min(existingIndex, layers.length), 0, next)
      return { ...previous, layers }
    })
    setLayerId(targetId)
  }
  const removeExclusiveLayer = (kind: Layer['kind']) => {
    if (!nail.layers.some(entry => entry.kind === kind)) return
    editNail(previous => ({ ...previous, layers: previous.layers.filter(entry => entry.kind !== kind) }))
    setLayerId('')
  }
  const patchExclusiveLayer = (kind: Layer['kind'], patch: Partial<Layer>) => editNail(previous => ({ ...previous, layers: previous.layers.map(entry => entry.kind === kind ? { ...entry, ...patch } : entry) }))
  const removeLayer = () => { if (layer) editNail(previous => ({ ...previous, layers: previous.layers.filter(entry => entry.id !== layerId) })); setLayerId('') }
  const moveLayer = (direction: number) => editNail(previous => {
    const layers = [...previous.layers], index = layers.findIndex(entry => entry.id === layerId), destination = index + direction
    if (index < 0 || destination < 0 || destination >= layers.length) return previous
    ;[layers[index], layers[destination]] = [layers[destination], layers[index]]
    return { ...previous, layers }
  })
  const addFrench = (src = '') => {
    const entry = newLayer('french', src ? assetName(src) : '法式微笑线')
    entry.color = frenchLayer?.color || color; entry.depth = frenchLayer?.depth || depth; entry.curve = frenchLayer?.curve || curve; entry.src = src
    replaceExclusiveLayer(entry)
  }
  const addImage = (src: string, name: string) => {
    const entry = newLayer('image', name); entry.src = src; addLayer(entry)
  }
  const selectTool = (next: Tool) => { setDraft(null); setTool(next); setSearch(''); setFilter('all') }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,select') || event.target.isContentEditable)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); setDraft(null); if (event.shiftKey) redo(); else undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { setNotice('请选择 PNG、JPG 或 WEBP 图片'); return }
    if (file.size > 12 * 1024 * 1024) { setNotice('图片不能超过 12 MB'); return }
    const targetNail = selected
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
      })
      const image = await loadImage(data)
      const surface = document.createElement('canvas')
      const ratio = Math.min(1, 1024 / Math.max(image.width, image.height))
      surface.width = Math.round(image.width * ratio); surface.height = Math.round(image.height * ratio)
      surface.getContext('2d')!.drawImage(image, 0, 0, surface.width, surface.height)
      const entry = newLayer('image', file.name)
      entry.src = surface.toDataURL('image/png')
      editNail(previous => ({ ...previous, layers: [...previous.layers, entry] }), targetNail)
      setLayerId(entry.id); setNotice('图片已加入图层，可拖动、缩放和旋转')
    } catch { setNotice('无法读取图片，请尝试其他图片') }
  }
  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    if (file.size > 30 * 1024 * 1024) { setNotice('项目文件不能超过 30 MB'); return }
    try {
      const imported = parseProject(await file.text())
      commit(() => imported); setDraft(null); setLayerId(''); setNotice('项目已打开；可用撤销返回之前的设计')
    } catch (error) { setNotice(error instanceof Error ? error.message : '项目文件读取失败') }
  }
  const exportPng = async () => {
    if (!currentModel) return
    try {
      const canvas = await renderDesign(nail, currentModel.mask)
      canvas.toBlob(blob => { if (blob) download(blob, `${project.name}-${nailName(selected)}.png`) })
    } catch { setNotice('导出失败，请确认素材加载成功') }
  }
  const addDotGrid = () => {
    const entry = newLayer('dots', '均匀波点'); entry.color = color; entry.size = brush
    const step = Math.max(brush * spacing, .08)
    const ratio = currentModel ? currentModel.height / currentModel.width : 2
    for (let row = .1; row < .95; row += step / ratio) {
      for (let column = .1; column < .95; column += step) entry.points.push({ x: column, y: row })
    }
    replaceExclusiveLayer(entry)
  }
  const addHandDots = () => {
    const entry = newLayer('dots', '手绘波点'); entry.color = dotsLayer?.color || color; entry.size = dotsLayer?.size || brush
    replaceExclusiveLayer(entry)
  }
  const assetCategories = tool === 'base' ? ['base_coat_pink','base_coat_purple'] : tool === 'french' ? ['base_coat_french'] : tool === 'sticker2d' ? ['3D_accessory_shell'] : tool === 'sticker3d' ? ['3D_accessory_metal'] : []
  const visibleAssets = assets.filter(asset => assetCategories.includes(asset.category) && (filter === 'all' || asset.category === filter) && assetName(asset.src).includes(search))
  const hasAssets = assetCategories.length > 0

  return <main className="app-shell editor-shell">
    <header className="topbar">
      <div className="brand-block"><div><div className="brand-name">3D<span>渲染</span></div></div></div>
      <input className="project-name" aria-label="项目名称" maxLength={100} value={project.name} onChange={event => commit(previous => ({ ...previous, name: event.target.value }))}/>
      <div className="top-actions">
        <button className="ghost-button" disabled={!canUndo || !!draft} onClick={() => { setDraft(null); undo() }} title="⌘/Ctrl Z">↶ 撤销</button>
        <button className="ghost-button" disabled={!canRedo || !!draft} onClick={() => { setDraft(null); redo() }} title="⌘/Ctrl Shift Z">↷ 重做</button>
        <button className="ghost-button" disabled={!!draft} onClick={clearDesign} title="清空全部图层，保留甲型和长度，可撤销">清空</button>
        <button className="ghost-button" onClick={() => projectInput.current?.click()}>打开项目</button>
        <input hidden type="file" accept=".json" ref={projectInput} onChange={importProject}/>
        <button className="ghost-button" disabled={!currentModel || !!draft} onClick={exportPng}>导出 PNG</button>
        <button className="primary-button" onClick={() => download(new Blob([JSON.stringify(project)], { type: 'application/json' }), `${project.name || '美甲设计'}.json`)}>保存项目文件</button>
      </div>
    </header>
    <div className="workspace">
      <aside className="left-rail">
        <div className="rail-heading">TOOLS</div>
        <nav>{tools.map(entry => <button key={entry.id} className={`tool-button ${tool === entry.id ? 'active' : ''}`} title={entry.hint} onClick={() => selectTool(entry.id)}><span className="tool-icon">{entry.icon}</span>{entry.name}</button>)}</nav>
      </aside>
      <section className="canvas-column">
        <div className="canvas-toolbar">
          <div className="breadcrumbs"><span>{activeTool.name}</span><b>/</b><strong>{nailName(selected)}</strong></div>
          <div className="canvas-actions">
            <button className={`view-toggle ${view === '2D' ? 'selected' : ''}`} onClick={() => { setDraft(null); setView('2D') }}>2D</button>
            <button className={`view-toggle ${view === '3D' ? 'selected' : ''}`} onClick={() => { setDraft(null); setView('3D') }}>3D</button>
            {view === '2D' && <><button className="icon-button" title="缩小" onClick={() => setZoom(value => Math.max(40, value - 10))}>−</button><button className="zoom-reset" title="重置缩放" onClick={() => setZoom(100)}>{zoom}%</button><button className="icon-button" title="放大" onClick={() => setZoom(value => Math.min(180, value + 10))}>＋</button></>}
          </div>
        </div>
        <div className="editor-stage">
          {view === '3D' ? <>
            {models.some(Boolean) ? <Suspense fallback={<div className="loading-state" role="status">正在启动 3D 预览…</div>}><ThreeDPreview models={models} canvases={canvases} selected={selected} onSelect={selectNail}/></Suspense> : <div className="loading-state" role="status">{modelError || `正在加载 3D 模型… ${loaded} / 5`}</div>}
            {modelError && <div role="alert">{modelError}<button onClick={retry}>重试加载</button></div>}
          </> : currentModel ? <EditorCanvas key={`${project.shape}-${project.length}-${selected}-${tool}`} model={currentModel} canvas={canvases[selected]} design={nail} tool={tool} layerId={layerId} color={color} brush={brush} spacing={spacing} zoom={zoom} onSelectLayer={setLayerId} onPreview={setDraft} onCommit={next => editNail(() => next)} onCancel={() => setDraft(null)}/> : <div className="loading-state" role="status">{surfaceError || '正在加载轮廓…'}{surfaceError && <button onClick={retrySurfaces}>重试加载</button>}</div>}
        </div>
        <div className="nail-strip">{project.nails.map((entry, index) => <button key={index} title={nailName(index)} aria-label={nailName(index)} aria-pressed={selected === index} className={selected === index ? 'active' : ''} onClick={() => selectNail(index)}><Thumbnail canvas={canvases[index]}/><span>{index < 5 ? '左' : '右'} {fingers[index % 5]}</span><small>{entry.layers.length} 层</small></button>)}</div>
        <div className="canvas-bottom"><span>{project.shape} · {project.length}款 · {nail.layers.length} 个图层</span><span role="status">{renderError || saveStatus}</span></div>
      </section>
      <aside className="right-panel">
        <div className="panel-head"><div><span className="eyebrow">CURRENT TOOL</span><h2>{activeTool.name}</h2></div></div>
        <p className="tool-description">{activeTool.hint}</p>
        {tool === 'shape' && <>
          <div className="shape-grid">{shapes.map(shape => <button key={shape} className={`shape-card ${project.shape === shape ? 'active' : ''}`} onClick={() => { setDraft(null); commit(previous => ({ ...previous, shape, length: availableLengths(shape).includes(previous.length) ? previous.length : '中' })) }}><strong>{shape}</strong></button>)}</div>
          <div className="length-picker"><label>十指长度</label><div>{availableLengths(project.shape).map(length => <button key={length} className={project.length === length ? 'active' : ''} onClick={() => { setDraft(null); commit(previous => ({ ...previous, length })) }}>{length}</button>)}</div></div>
        </>}
        {tool === 'base' && <><ColorControl label="纯色底胶" value={nail.color} onChange={value => editNail(previous => ({ ...previous, color: value, base: '' }))}/><button className="panel-button" onClick={() => commit(previous => ({ ...previous, nails: previous.nails.map(entry => ({ ...entry, base: nail.base, color: nail.color })) }))}>底胶应用到十指</button></>}
        {tool === 'french' && <>
          <ColorControl label="法式颜色" value={frenchLayer?.color || color} onChange={value => { setColor(value); if (frenchLayer) patchExclusiveLayer('french', { color: value, src: '' }) }}/>
          <Range label="甲尖覆盖" value={frenchLayer?.depth ?? depth} min={.05} max={.6} step={.01} onChange={value => { setDepth(value); if (frenchLayer) patchExclusiveLayer('french', { depth: value }) }}/>
          <Range label="微笑线弧度" value={frenchLayer?.curve ?? curve} min={0} max={.35} step={.01} onChange={value => { setCurve(value); if (frenchLayer) patchExclusiveLayer('french', { curve: value }) }}/>
        </>}
        {tool === 'dots' && <>
          <ColorControl label="波点颜色" value={dotsLayer?.color || color} onChange={value => { setColor(value); if (dotsLayer) patchExclusiveLayer('dots', { color: value }) }}/>
          <Range label="波点直径" value={dotsLayer?.size ?? brush} min={.01} max={.18} step={.005} onChange={value => { setBrush(value); if (dotsLayer) patchExclusiveLayer('dots', { size: value }) }}/>
          <Range label="间距倍数" value={spacing} min={1.2} max={5} step={.1} onChange={setSpacing} suffix="×"/>
          <button className="panel-button" onClick={addDotGrid}>生成均匀波点</button>
          <button className="panel-button secondary" onClick={addHandDots}>清空并新建手绘波点层</button>
          <p className="small-note">手绘波点：点击落点或拖动连续绘制，每次笔画可独立撤销。</p>
        </>}
        {tool === 'eraser' && <><Range label="橡皮擦直径" value={brush} min={.02} max={.5} step={.01} onChange={setBrush}/><p className="small-note">{layer ? `正在擦除「${layer.name}」` : '请先在下方选择一个图层'}。擦除后露出下面的图层，底胶保留。</p></>}
        {tool === 'upload' && <label className="dropzone"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload}/><span className="upload-icon">↥</span><strong>选择本地图片</strong><small>PNG / JPG / WEBP · 最大 12 MB</small></label>}
        {tool === 'select' && <p className="small-note">选中图层后，可移动该图层的饰品，也可进行上移、下移等操作。</p>}
        {tool === 'sticker3d' && <p className="small-note">当前素材库提供饰品图片，以贴图叠加到曲面；不含饰品实体模型。</p>}
        {hasAssets && <div className="material-library">
          <input className="asset-search" placeholder="搜索素材名称或编号" aria-label="搜索素材" value={search} onChange={event => setSearch(event.target.value)}/>
          {assetCategories.length > 1 && <div className="panel-tabs">{['all', ...assetCategories].map(category => <button key={category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>{category === 'all' ? '全部' : categoryNames[category]}</button>)}</div>}
          <div className={`asset-grid ${tool === 'base' || tool === 'french' ? 'polish-grid' : ''}`}>
            {tool === 'french' && <button className={`asset-card asset-none ${!frenchLayer ? 'selected' : ''}`} aria-pressed={!frenchLayer} title="不设置法式" onClick={() => removeExclusiveLayer('french')}><span className="asset-image">无</span><span className="asset-name">无</span></button>}
            {visibleAssets.map(asset => {
              const polish = tool === 'base' || tool === 'french'
              const selected = tool === 'base' ? nail.base === asset.src : tool === 'french' ? frenchLayer?.src === asset.src : false
              const crop = materialCrop(asset.src)
              return <button key={asset.src} className={`asset-card ${selected ? 'selected' : ''}`} aria-pressed={polish ? selected : undefined} title={`${assetName(asset.src)} · ${tool === 'base' ? '应用于当前指甲' : tool === 'french' ? '替换当前法式图层' : '添加可编辑图层'}`} onClick={() => { if (tool === 'base') editNail(previous => ({ ...previous, base: asset.src })); else if (tool === 'french') addFrench(asset.src); else addImage(asset.src, assetName(asset.src)) }}>
                <span className="asset-image"><img loading="lazy" src={asset.src} alt={assetName(asset.src)} style={polish ? { position: 'absolute', width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` } : undefined}/></span>
                {polish && <span className="asset-name">{assetName(asset.src)}</span>}
              </button>
            })}
          </div>
          {visibleAssets.length === 0 && <p className="small-note">没有匹配的素材</p>}
          <p className="small-note">{visibleAssets.length} 个素材 · 点击应用</p>
        </div>}
        <section className="layers-panel">
          <div className="layer-heading"><h3>图层</h3><span>{nailName(selected)}</span></div>
          <div className="layer-list">{[...nail.layers].reverse().map(entry => <div key={entry.id} className={`layer-row ${entry.id === layerId ? 'active' : ''}`}><button title={entry.visible ? '隐藏图层' : '显示图层'} onClick={() => editNail(previous => ({ ...previous, layers: previous.layers.map(candidate => candidate.id === entry.id ? { ...candidate, visible: !candidate.visible } : candidate) }))}>{entry.visible ? '◉' : '○'}</button><button onClick={() => setLayerId(entry.id)} title={entry.name}>{entry.name}</button></div>)}</div>
          <div className="base-layer">◐ 底胶 <span>固定底层</span></div>
          {layer && <><div className="layer-actions"><button onClick={() => moveLayer(1)}>上移</button><button onClick={() => moveLayer(-1)}>下移</button><button onClick={() => { const copy = structuredClone(layer); copy.id = crypto.randomUUID(); copy.name += ' 副本'; addLayer(copy) }}>复制</button><button className="danger" onClick={removeLayer}>删除</button></div>
            {layer.kind === 'image' && <><Range label="水平位置" value={layer.x} min={-.5} max={1.5} step={.01} onChange={value => patchLayer({ x: value })}/><Range label="垂直位置" value={layer.y} min={-.5} max={1.5} step={.01} onChange={value => patchLayer({ y: value })}/><Range label="尺寸 / 甲宽" value={layer.scale} min={.05} max={2} step={.01} onChange={value => patchLayer({ scale: value })}/><Range label="旋转" value={layer.rotation} min={-180} max={180} step={1} onChange={value => patchLayer({ rotation: value })} suffix="°"/></>}
          </>}
          <button className="panel-button secondary" onClick={() => { commit(previous => ({ ...previous, nails: previous.nails.map(() => structuredClone(previous.nails[selected])) })); setNotice('已将当前画稿复制到十指，可撤销') }}>当前画稿复制到十指</button>
        </section>
      </aside>
    </div>
    {notice && <div className="toast" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
  </main>
}

function Range({ label, value, min, max, step, onChange, suffix = '%' }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; suffix?: string }) {
  return <div className="property-box"><label>{label}<strong>{suffix === '%' ? Math.round(value * 100) : Math.round(value * 10) / 10}{suffix}</strong></label><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></div>
}
function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-control"><span>{label}</span><input type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)}/><small>{value.toUpperCase()}</small></label>
}
function Thumbnail({ canvas }: { canvas?: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = ref.current!, context = target.getContext('2d')!
    context.clearRect(0, 0, target.width, target.height)
    if (canvas) { const width = Math.min(50, 62 * canvas.width / canvas.height); context.drawImage(canvas, (60 - width) / 2, 3, width, 62) }
  }, [canvas])
  return <canvas ref={ref} width={60} height={68}/>
}
