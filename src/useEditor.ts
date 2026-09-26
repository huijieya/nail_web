import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { NailModel } from './model'
import { loadModels } from './model'
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

export function useModels(shape: string, length: string, priority = 2) {
  const [models, setModels] = useState<Array<NailModel | undefined>>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(0)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let owned: NailModel[] = []
    setModels([]); setLoaded(0); setError('')
    loadModels(shape, length, controller.signal, priority, (finger, model) => {
      owned.push(model)
      setModels(previous => { const next = [...previous]; next[finger] = model; return next })
      setLoaded(value => value + 1)
    }).then(result => {
      if (controller.signal.aborted) { result.forEach(model => model?.geometry.dispose()); return }
      owned = result.filter((model): model is NailModel => Boolean(model)); setModels(result)
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '模型加载失败') })
    return () => { controller.abort(); owned.forEach(model => model.geometry.dispose()) }
  }, [shape, length, priority, retry])
  return { models, loaded, error, retry: () => setRetry(value => value + 1) }
}

export function useCanvases(nails: NailDesign[], models: Array<NailModel | undefined>) {
  const cache = useMemo(() => new WeakMap<NailDesign, Promise<HTMLCanvasElement>>(), [models])
  const [result, setResult] = useState<{ models: Array<NailModel | undefined>; canvases: Array<HTMLCanvasElement | undefined> }>({ models: [], canvases: [] })
  const [error, setError] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    const current = ++revision.current
    setError('')
    if (!models.some(Boolean)) return
    Promise.all(nails.map((design, index) => {
      const model = models[index % 5]
      if (!model) return Promise.resolve(undefined)
      let pending = cache.get(design)
      if (!pending) { pending = renderDesign(design, model.mask); cache.set(design, pending); pending.catch(() => cache.delete(design)) }
      return pending
    })).then(canvases => { if (current === revision.current) setResult({ models, canvases }) })
      .catch(reason => { if (current === revision.current) setError(reason instanceof Error ? reason.message : '画稿渲染失败') })
    return () => { revision.current += 1 }
  }, [nails, models, cache])
  return { canvases: result.models === models ? result.canvases : [], error }
}
