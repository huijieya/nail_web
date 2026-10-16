import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

export function prepareAccessoryGeometry(source: BufferGeometry, rotationX: number, rotationZ = 0) {
  source.rotateX(rotationX)
  source.rotateZ(rotationZ)
  source.computeBoundingBox()
  const bounds = source.boundingBox! // 非空断言
  const size = bounds.getSize(new Vector3())
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0) {
    source.dispose()
    throw new Error('附件模型尺寸无效')
  }
  source.translate(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2, -bounds.min.z)
  source.scale(1 / size.x, 1 / size.x, 1 / size.x)
  let geometry = source
  const positions = source.getAttribute('position')
  if (positions.count > 120000) {
    const cell = Math.max(size.x, size.y, size.z) / size.x / 128
    const clusters = new Map<string, number>()
    const sums: number[] = [],
      counts: number[] = []
    const remap = new Uint32Array(positions.count)
    for (let index = 0; index < positions.count; index += 1) {
      const horizontal = positions.getX(index),
        vertical = positions.getY(index),
        height = positions.getZ(index)
      const key = `${Math.round(horizontal / cell)},${Math.round(vertical / cell)},${Math.round(height / cell)}`
      let target = clusters.get(key)
      if (target === undefined) {
        target = counts.length
        clusters.set(key, target)
        sums.push(0, 0, 0)
        counts.push(0)
      }
      remap[index] = target
      sums[target * 3] += horizontal
      sums[target * 3 + 1] += vertical
      sums[target * 3 + 2] += height
      counts[target] += 1
    }
    const vertices = new Float32Array(sums.length)
    sums.forEach((sum, index) => {
      vertices[index] = sum / counts[Math.floor(index / 3)]
    })
    const indices: number[] = []
    const faces = new Set<string>()
    for (let index = 0; index < remap.length; index += 3) {
      const first = remap[index],
        second = remap[index + 1],
        third = remap[index + 2]
      if (first === second || second === third || third === first) continue
      const key = [first, second, third].sort((left, right) => left - right).join(',')
      if (faces.has(key)) continue
      faces.add(key)
      indices.push(first, second, third)
    }
    geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geometry.setIndex(indices)
    source.dispose()
  }
  geometry.computeBoundingBox()
  const normalized = geometry.boundingBox!
  const width = normalized.max.x - normalized.min.x
  geometry.translate(
    -(normalized.min.x + normalized.max.x) / 2,
    -(normalized.min.y + normalized.max.y) / 2,
    -normalized.min.z,
  )
  geometry.scale(1 / width, 1 / width, 1 / width)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
