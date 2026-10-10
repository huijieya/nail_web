import * as THREE from 'three'
import type { Layer } from './design'
import type { NailModel } from './model'
import { accessoryPosition } from './accessories'

export function placeAccessory(mesh: THREE.Mesh, nail: THREE.Mesh, model: NailModel, layer: Layer) {
  const bounds = model.geometry.boundingBox!
  const position = accessoryPosition(model.mask, layer)
  const horizontal = bounds.min.x + position.x * (bounds.max.x - bounds.min.x)
  const vertical = bounds.max.y - position.y * (bounds.max.y - bounds.min.y)
  nail.updateMatrixWorld(true)
  const origin = nail.localToWorld(new THREE.Vector3(horizontal, vertical, bounds.max.z + 10))
  const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1))
  const hit = raycaster.intersectObject(nail, false)[0]
  if (!hit) { mesh.visible = false; return }
  const normal = hit.normal?.clone() || hit.face?.normal.clone() || new THREE.Vector3(0, 0, 1)
  if (normal.z < 0) normal.negate()
  normal.normalize()
  mesh.position.copy(nail.worldToLocal(hit.point.clone())).addScaledVector(normal, .025)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
  mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -layer.rotation * Math.PI / 180))
  mesh.scale.setScalar(model.width * layer.scale)
}
