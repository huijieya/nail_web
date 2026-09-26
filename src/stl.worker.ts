import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

self.onmessage = (event: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
  try {
    const geometry = new STLLoader().parse(event.data.buffer)
    const position = geometry.getAttribute('position')
    const positions = new Float32Array(position.array as ArrayLike<number>)
    ;(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ id: event.data.id, positions: positions.buffer }, [positions.buffer])
    geometry.dispose()
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'STL 解析失败' })
  }
}
