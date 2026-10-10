export const accessoryCatalog = [
  // { src: '/stl-models/bow.stl', name: '蝴蝶结', rotationX: -Math.PI / 2, rotationZ: 0 },
  // { src: '/stl-models/cat.stl', name: '小猫', rotationX: -Math.PI / 2, rotationZ: 0 },
  // { src: '/stl-models/flower.stl', name: '花朵', rotationX: 0, rotationZ: 0 },
  { src: '/stl-models/heart.stl', name: '爱心', rotationX: 0, rotationZ: Math.PI },
]

export const isAccessorySource = (src: unknown) => accessoryCatalog.some(entry => entry.src === src)
