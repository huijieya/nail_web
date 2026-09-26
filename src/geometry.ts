import { BufferAttribute, BufferGeometry, Vector3 } from 'three'

export function orientGeometry(geometry: BufferGeometry) {
  geometry.center()
  geometry.rotateY(Math.PI)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox!
  const size = bounds.getSize(new Vector3())
  const positions = geometry.getAttribute('position')
  const uv = new Float32Array(positions.count * 2)
  for (let index = 0; index < positions.count; index += 1) {
    uv[index * 2] = (positions.getX(index) - bounds.min.x) / size.x
    uv[index * 2 + 1] = (positions.getY(index) - bounds.min.y) / size.y
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.computeVertexNormals()
  return geometry
}
