import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { NailModel, NailSurface } from './model'
import { loadModels, loadSurfaces } from './model'
import { newProject, parseProject, renderDesign, storageKey } from './design'
import type { NailDesign, Project } from './design'

type History = { past: Project[]; present: Project; future: Project[]; warning: string }
type Action = { type: 'edit'; update: (project: Project) => Project } | { type: 'undo' | 'redo' }
function reducer(state: History, action: Action): History {
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]
    return previous ? { ...state, past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state
  }
  if (action.type === 'redo') {
    const next = state.future[0]
    return next ? { ...state, past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state
  }
  if (action.type === 'edit') {
    const next = action.update(state.present)
    return next === state.present ? state : { ...state, past: [...state.past, state.present].slice(-60), present: next, future: [] }
  }
  return state
}

export function useProject() {
  const [history, dispatch] = useReducer(reducer, undefined, (): History => {
    try {
      const saved = localStorage.getItem(storageKey)
      return { past: [], present: saved ? parseProject(saved) : newProject(), future: [], warning: '' }
    } catch { return { past: [], present: newProject(), future: [], warning: '本地草稿读取失败，请导入备份项目。' } }
  })
  const [saveStatus, setSaveStatus] = useState(history.warning || '等待保存')
  const [canSave, setCanSave] = useState(!history.warning)
  const project = history.present
  useEffect(() => {
    if (!canSave) return
    setSaveStatus('保存中…')
    const timeout = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(project)); setSaveStatus('已保存到本机') }
      catch { setSaveStatus('本地存储不足，请导出项目备份') }
    }, 450)
    const saveOnExit = () => {
      try { localStorage.setItem(storageKey, JSON.stringify(project)) }
      catch { setSaveStatus('本地存储不足，请导出项目备份') }
    }
    window.addEventListener('pagehide', saveOnExit)
    return () => { window.clearTimeout(timeout); window.removeEventListener('pagehide', saveOnExit) }
  }, [project, canSave])
  const commit = useCallback((update: (project: Project) => Project) => { setCanSave(true); dispatch({ type: 'edit', update }) }, [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  return { project, commit, undo, redo, canUndo: !!history.past.length, canRedo: !!history.future.length, saveStatus }
}

const emptyModels: Array<NailModel | undefined> = []
const emptySurfaces: NailSurface[] = []

export function useSurfaces(shape: string, length: string) {
  const key = `${shape}/${length}`
  const [result, setResult] = useState<{ key: string; surfaces: NailSurface[] }>({ key: '', surfaces: [] })
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    loadSurfaces(shape, length).then(surfaces => {
      if (active) setResult({ key, surfaces })
    }).catch(() => { if (active) setError('预生成轮廓加载失败，请重试') })
    return () => { active = false }
  }, [shape, length, key, retry])
  return { surfaces: result.key === key ? result.surfaces : emptySurfaces, error, retry: () => setRetry(value => value + 1) }
}

export function useModels(shape: string, length: string, enabled: boolean) {
  const key = `${shape}/${length}`
  const [result, setResult] = useState<{ key: string; models: Array<NailModel | undefined> }>({ key: '', models: [] })
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(0)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const owned: NailModel[] = []
    setResult({ key, models: [] }); setLoaded(0); setError('')
    if (!enabled) return
    loadModels(shape, length, controller.signal, (finger, model) => {
      owned.push(model)
      setResult(previous => { const models = [...previous.models]; models[finger] = model; return { key, models } })
      setLoaded(value => value + 1)
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '模型加载失败') })
    return () => { controller.abort(); owned.forEach(model => model.geometry.dispose()) }
  }, [shape, length, key, enabled, retry])
  return { models: enabled && result.key === key ? result.models : emptyModels, loaded, error, retry: () => setRetry(value => value + 1) }
}

export function useCanvases(nails: NailDesign[], models: Array<NailSurface | undefined>) {
  const cache = useMemo(() => new WeakMap<NailSurface, WeakMap<NailDesign, Promise<HTMLCanvasElement>>>(), [])
  const [result, setResult] = useState<{ models: Array<NailSurface | undefined>; canvases: Array<HTMLCanvasElement | undefined> }>({ models: [], canvases: [] })
  const [error, setError] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    const current = ++revision.current
    setError('')
    if (!models.some(Boolean)) return
    Promise.all(nails.map((design, index) => {
      const model = models[index % 5]
      if (!model) return Promise.resolve(undefined)
      let designs = cache.get(model)
      if (!designs) { designs = new WeakMap(); cache.set(model, designs) }
      let pending = designs.get(design)
      if (!pending) { pending = renderDesign(design, model.mask); designs.set(design, pending); pending.catch(() => designs.delete(design)) }
      return pending
    })).then(canvases => { if (current === revision.current) setResult({ models, canvases }) })
      .catch(reason => { if (current === revision.current) setError(reason instanceof Error ? reason.message : '画稿渲染失败') })
    return () => { revision.current += 1 }
  }, [nails, models, cache])
  return { canvases: result.models === models ? result.canvases : [], error }
}
