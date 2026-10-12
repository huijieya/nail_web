import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

type ReliefOptions = {
  widthMm: number;
  baseMm: number;
  reliefMm: number;
  invertDepth: boolean;
  sampleWidth: number;
  heightGamma: number;
  heightContrast: number;
  previewScale: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function createReliefGeometry(
  depthImage: HTMLImageElement,
  options: ReliefOptions
) {
  const {
    widthMm,
    baseMm,
    reliefMm,
    invertDepth,
    sampleWidth,
  } = options;

  const aspect = depthImage.width / depthImage.height;
  const width = sampleWidth;
  const height = Math.max(2, Math.round(width / aspect));
  const vertexCount = width * height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("无法创建 Canvas 上下文");
  }

  context.drawImage(depthImage, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  let minValue = 255;
  let maxValue = 0;

  for (let index = 0; index < vertexCount; index++) {
    const value = pixels[index * 4];
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }

  const valueRange = Math.max(1, maxValue - minValue);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const physicalHeight = widthMm / aspect;
  const bottomOffset = vertexCount;

  const clamp01 = (value: number) =>
  Math.max(0, Math.min(1, value));

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const index = y * width + x;
    const gray = pixels[index * 4];

    let normalized = (gray - minValue) / valueRange;

    if (invertDepth) {
      normalized = 1 - normalized;
    }

    normalized = Math.pow(
      clamp01(normalized),
      options.heightGamma
    );

    normalized =
      (normalized - 0.5) *
        options.heightContrast +
      0.5;

    normalized = clamp01(normalized);

    const z =
      baseMm +
      normalized *
        reliefMm *
        options.previewScale;

    const worldX =
      (x / (width - 1) - 0.5) * widthMm;

    const worldY =
      (0.5 - y / (height - 1)) * physicalHeight;

    positions.push(worldX, worldY, z);
    uvs.push(
      x / (width - 1),
      1 - y / (height - 1)
    );
  }
}

  // 底板顶点
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const worldX = (x / (width - 1) - 0.5) * widthMm;
      const worldY = (0.5 - y / (height - 1)) * physicalHeight;

      positions.push(worldX, worldY, 0);
      uvs.push(x / (width - 1), 1 - y / (height - 1));
    }
  }

  function topIndex(x: number, y: number) {
    return y * width + x;
  }

  function bottomIndex(x: number, y: number) {
    return bottomOffset + y * width + x;
  }

  // 浮雕表面和底面
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = topIndex(x, y);
      const b = topIndex(x + 1, y);
      const c = topIndex(x + 1, y + 1);
      const d = topIndex(x, y + 1);

      const ba = bottomIndex(x, y);
      const bb = bottomIndex(x + 1, y);
      const bc = bottomIndex(x + 1, y + 1);
      const bd = bottomIndex(x, y + 1);

      // 顶面
      indices.push(a, b, c);
      indices.push(a, c, d);

      // 底面
      indices.push(ba, bc, bb);
      indices.push(ba, bd, bc);
    }
  }

  // 四周侧壁
  for (let x = 0; x < width - 1; x++) {
    // 上边
    indices.push(
      topIndex(x, 0),
      bottomIndex(x, 0),
      bottomIndex(x + 1, 0)
    );
    indices.push(
      topIndex(x, 0),
      bottomIndex(x + 1, 0),
      topIndex(x + 1, 0)
    );

    // 下边
    indices.push(
      topIndex(x, height - 1),
      bottomIndex(x + 1, height - 1),
      bottomIndex(x, height - 1)
    );
    indices.push(
      topIndex(x, height - 1),
      topIndex(x + 1, height - 1),
      bottomIndex(x + 1, height - 1)
    );
  }

  for (let y = 0; y < height - 1; y++) {
    // 左边
    indices.push(
      topIndex(0, y),
      bottomIndex(0, y + 1),
      bottomIndex(0, y)
    );
    indices.push(
      topIndex(0, y),
      topIndex(0, y + 1),
      bottomIndex(0, y + 1)
    );

    // 右边
    indices.push(
      topIndex(width - 1, y),
      bottomIndex(width - 1, y),
      bottomIndex(width - 1, y + 1)
    );
    indices.push(
      topIndex(width - 1, y),
      bottomIndex(width - 1, y + 1),
      topIndex(width - 1, y + 1)
    );
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );

  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(uvs, 2)
  );

  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

export default function ReliefViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const [depthFile, setDepthFile] = useState<File | null>(null);
  const [colorFile, setColorFile] = useState<File | null>(null);
  const [invertDepth, setInvertDepth] = useState(false);
  const [clayMode, setClayMode] = useState(true);

  const [widthMm, setWidthMm] = useState(100);
  const [baseMm, setBaseMm] = useState(2);
  const [reliefMm, setReliefMm] = useState(4);
  const [previewScale, setPreviewScale] = useState(2.5);

  const [colorUrl, setColorUrl] = useState<string | null>(null);
  const [depthUrl, setDepthUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8e8e8);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth /
        containerRef.current.clientHeight,
      0.1,
      1000
    );

    camera.position.set(0, -80, 90);
    camera.lookAt(0, 0, 0);

    const container = containerRef.current;
    if(!container) return

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(
      container.clientWidth,
      container.clientHeight
    );

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    // containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 5);
    keyLight.position.set(80, -100, 100);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x7895c9, 1.2);
    fillLight.position.set(-100, 40, 30);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffd8aa, 2);
    rimLight.position.set(20, 100, 25);
    scene.add(rimLight);

    const movingLight = new THREE.DirectionalLight(0xfff1d6, 1);
    scene.add(movingLight);
    const lightStartTime = performance.now();

    const resizeObserver = new ResizeObserver(() => {
      if (!container) {
        return;
      }

      const width = container.clientWidth;
      const height = container.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });

    resizeObserver.observe(container);

    let animationFrame = 0;

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      controls.update();

      const elapsed = (performance.now() - lightStartTime)/1000;
      const angle = elapsed*0.5;
      movingLight.position.set(
        Math.cos(angle)*90,
        Math.sin(angle)*90,
        20
      );
      controls.update();

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.domElement.remove();
      renderer.dispose();

      if (container?.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (!depthFile) {
      return;
    }

    const nextUrl = URL.createObjectURL(depthFile);
    setDepthUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }

      return nextUrl;
    });

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [depthFile]);

  useEffect(() => {
    if (!colorFile) {
      return;
    }

    const nextUrl = URL.createObjectURL(colorFile);
    setColorUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }

      return nextUrl;
    });

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [colorFile]);

  useEffect(() => {
    if (!depthUrl || !sceneRef.current) {
      return;
    }

    const currentDepthUrl = depthUrl;
    const currentColorUrl = colorUrl;
    let disposed = false;

    async function updateRelief() {
      const depthImage = await loadImage(currentDepthUrl);

      if (disposed || !sceneRef.current) {
        return;
      }

      const geometry = createReliefGeometry(depthImage, {
        widthMm,
        baseMm,
        reliefMm,
        invertDepth,
        sampleWidth: 256,
        heightGamma: 0.7,
        heightContrast: 2.0,
        previewScale,
        });

      let material: THREE.MeshStandardMaterial;

      if (currentColorUrl && !clayMode) {
        const colorImage = await loadImage(currentColorUrl);
        const texture = new THREE.Texture(colorImage);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.6,
          metalness: 0,
          side: THREE.DoubleSide,
        });
      } else {
        material = new THREE.MeshStandardMaterial({
          color: 0xb8b8b8,
          roughness: 0.42,
          metalness: 0,
          side: THREE.DoubleSide,
        });
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = 0;

      if (meshRef.current) {
        sceneRef.current.remove(meshRef.current);
        meshRef.current.geometry.dispose();

        if (Array.isArray(meshRef.current.material)) {
          meshRef.current.material.forEach((item) => item.dispose());
        } else {
          meshRef.current.material.dispose();
        }
      }

      meshRef.current = mesh;
      sceneRef.current.add(mesh);
    }

    updateRelief();

    return () => {
      disposed = true;
    };
  }, [
    depthUrl,
    colorUrl,
    widthMm,
    baseMm,
    reliefMm,
    invertDepth,
    previewScale,
    clayMode,
  ]);

  function exportSTL() {
    if (!meshRef.current) {
      return;
    }

    const exporter = new STLExporter();
    const result = exporter.parse(meshRef.current, {
      binary: true,
    });

    const blob = new Blob([result], {
      type: "application/octet-stream",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "relief.stl";
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <label>
          深度图：
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              setDepthFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>

        <label>
          原图：
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              setColorFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <label>
          宽度 mm：
          <input
            type="number"
            value={widthMm}
            onChange={(event) => {
              setWidthMm(Number(event.target.value));
            }}
          />
        </label>

        <label>
          底板 mm：
          <input
            type="number"
            value={baseMm}
            onChange={(event) => {
              setBaseMm(Number(event.target.value));
            }}
          />
        </label>

        <label>
          浮雕高度 mm：
          <input
            type="number"
            value={reliefMm}
            onChange={(event) => {
              setReliefMm(Number(event.target.value));
            }}
          />
        </label>

        <label>
          反转深度：
          <input
            type="checkbox"
            checked={invertDepth}
            onChange={(event) => {
              setInvertDepth(event.target.checked);
            }}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <label>
            立体增强：
            <input
                type="range"
                min="1"
                max="4"
                step="0.1"
                value={previewScale}
                onChange={(event) => {
                setPreviewScale(Number(event.target.value));
                }}
            />
            </label>

            <label>
            单色浮雕预览：
            <input
                type="checkbox"
                checked={clayMode}
                onChange={(event) => {
                setClayMode(event.target.checked);
                }}
            />
            </label>

        <button onClick={exportSTL}>导出 STL</button>
      </div>

    <div style={{ height: "70vh", display: "flex", flexDirection: "column" }}>
    {/* 图片上传和参数控件保持原样 */}

    <div
        ref={containerRef}
        style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        border: "1px solid #444",
        }}
    />
    </div>
    </div>
  );
}
