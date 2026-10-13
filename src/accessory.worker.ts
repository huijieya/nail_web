import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { prepareAccessoryGeometry } from './accessoryGeometry'

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; rotationX: number; rotationZ: number }>) => {
  try {
    const geometry = prepareAccessoryGeometry(
      new STLLoader().parse(event.data.buffer),
      event.data.rotationX,
      event.data.rotationZ,
    )
    const positions = new Float32Array(geometry.getAttribute('position').array)
    const normals = new Float32Array(geometry.getAttribute('normal').array)
    const indices = geometry.index ? new Uint32Array(geometry.index.array) : null
    const transfer: Transferable[] = [positions.buffer, normals.buffer]
    if (indices) transfer.push(indices.buffer)
    ;(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(
      { positions, normals, indices },
      transfer,
    )
    geometry.dispose()
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '附件模型解析失败' })
  }
}
