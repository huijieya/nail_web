import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

type Asset = { id: string; name: string; src: string }

const fingers = ['小拇指', '无名指', '中指', '食指', '大拇指']

const folderForShape = (shape: string) => {
  if (shape === '梯形') return { folder: '梯形', prefix: '梯形棺材形' }
  if (shape === '尖形') return { folder: '尖形-水滴形', prefix: '尖形水滴形' }
  return { folder: shape, prefix: shape }
}

const modelUrls = (shape: string, length: string) => {
  const { folder, prefix } = folderForShape(shape)
  const lengthLabel = `${length}款`
  return fingers.map((finger) => encodeURI(`/甲型/${folder}/${length}/${prefix}${lengthLabel}${finger}.stl`))
}

function createCanvasTexture(src: string, showDots: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 768
  const context = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  context.fillStyle = '#bc8790'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const image = new Image()
  image.onload = () => {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const gloss = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    gloss.addColorStop(0, 'rgba(255,255,255,.30)')
    gloss.addColorStop(.28, 'rgba(255,255,255,0)')
    gloss.addColorStop(.72, 'rgba(38,25,36,.08)')
    gloss.addColorStop(1, 'rgba(38,25,36,.18)')
    context.fillStyle = gloss
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (showDots) {
      context.fillStyle = 'rgba(247,237,232,.9)'
      ;[[245, 268, 12], [315, 334, 8], [390, 280, 10], [472, 380, 7]].forEach(([x, y, radius]) => {
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
      })
    }
    texture.needsUpdate = true
  }
  image.src = src
  return texture
}

function normalizeGeometry(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (!bounds) return geometry
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  bounds.getSize(size)
  bounds.getCenter(center)
  geometry.translate(-center.x, -center.y, -center.z)
  const largestSide = Math.max(size.x, size.y, size.z) || 1
  geometry.scale(2.05 / largestSide, 2.05 / largestSide, 2.05 / largestSide)
  geometry.computeBoundingBox()
  const uvBounds = geometry.boundingBox!
  const uvMin = uvBounds.min
  const uvSize = uvBounds.getSize(new THREE.Vector3())
  const positions = geometry.getAttribute('position')
  const uv = new Float32Array(positions.count * 2)
  const uSize = uvSize.x || 1
  const vSize = uvSize.z || uvSize.y || 1
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    uv[index * 2] = (x - uvMin.x) / uSize
    uv[index * 2 + 1] = (z !== 0 ? z - uvMin.z : y - uvMin.y) / vSize
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.computeVertexNormals()
  return geometry
}

function buildMaterial(texture: THREE.Texture) {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    color: '#e3c3c0',
    roughness: .28,
    metalness: .02,
    clearcoat: .65,
    clearcoatRoughness: .18,
  })
}

export default function ThreeDPreview({ base, dots, accessory, shape, length }: { base: string; dots: boolean; accessory: Asset; shape: string; length: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('正在加载真实 STL…')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#292929')
    const camera = new THREE.PerspectiveCamera(31, 1, .1, 100)
    camera.position.set(0, 0.55, 9.3)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = .08
    controls.minDistance = 5.5
    controls.maxDistance = 14
    controls.target.set(0, 0, 0)

    scene.add(new THREE.HemisphereLight('#f4e8e3', '#17151c', 2.1))
    const key = new THREE.DirectionalLight('#fff4ed', 3.2)
    key.position.set(-4, 6, 7)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.DirectionalLight('#9aa9e2', 2.1)
    rim.position.set(5, 2, -4)
    scene.add(rim)

    const platform = new THREE.Mesh(new THREE.CircleGeometry(4.9, 64), new THREE.MeshBasicMaterial({ color: '#313131', transparent: true, opacity: .58 }))
    platform.rotation.x = -Math.PI / 2
    platform.position.y = -1.62
    platform.scale.set(1, .48, 1)
    scene.add(platform)

    const texture = createCanvasTexture(base, dots)
    const group = new THREE.Group()
    scene.add(group)
    let disposed = false
    let loadedCount = 0
    const loader = new STLLoader()
    const urls = modelUrls(shape, length)
    const xPositions = [-2.6, -1.3, 0, 1.3, 2.6]
    const yPositions = [-.22, .08, .2, .08, -.22]

    Promise.all(urls.map((url) => loader.loadAsync(url))).then((geometries) => {
      if (disposed) return
      geometries.forEach((rawGeometry, fingerIndex) => {
        const normalized = normalizeGeometry(rawGeometry)
        for (let hand = 0; hand < 2; hand += 1) {
          const material = buildMaterial(texture)
          const mesh = new THREE.Mesh(normalized.clone(), material)
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.position.set(xPositions[fingerIndex], hand === 0 ? yPositions[fingerIndex] + .95 : yPositions[fingerIndex] - .98, .15)
          mesh.rotation.set(hand === 0 ? -.25 : Math.PI + .25, 0, fingerIndex === 4 ? -.20 : fingerIndex === 0 ? .20 : 0)
          mesh.scale.setScalar(fingerIndex === 4 || fingerIndex === 0 ? .86 : 1)
          group.add(mesh)
        }
        loadedCount += 2
        setStatus(`${loadedCount} / 10 个真实模型`)
      })
      setStatus('10 个真实 STL 模型 · 已加载')
    }).catch(() => setStatus('STL 加载失败，请检查甲型素材路径'))

    const resize = () => {
      const width = mount.clientWidth || 600
      const height = mount.clientHeight || 480
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    let animationFrame = 0
    const animate = () => {
      animationFrame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      controls.dispose()
      texture.dispose()
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
          else object.material.dispose()
        }
      })
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [base, dots, shape, length])

  return <div className="three-d-preview real-three" ref={mountRef}><span className="three-d-axis">REAL STL PREVIEW <b>10 FINGERS</b></span><div className="three-status"><span className="status-pulse"/>{status}</div><div className="three-accessory"><img src={accessory.src} alt="selected accessory"/><span>{accessory.name}</span></div><button className="orbit-hint">⌘ 拖动旋转</button></div>
}
