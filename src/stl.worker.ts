import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { orientGeometry } from './geometry'

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const geometry = orientGeometry(new STLLoader().parse(event.data.buffer))
    const positions = geometry.getAttribute('position').array as Float32Array<ArrayBuffer>
    const normals = geometry.getAttribute('normal').array as Float32Array<ArrayBuffer>
    const uv = geometry.getAttribute('uv').array as Float32Array<ArrayBuffer>
    ;(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ positions: positions.buffer, normals: normals.buffer, uv: uv.buffer, min: geometry.boundingBox!.min.toArray(), max: geometry.boundingBox!.max.toArray() }, [positions.buffer, normals.buffer, uv.buffer])
    geometry.dispose()
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'STL 解析失败' })
  }
}
