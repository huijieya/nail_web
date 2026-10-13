export function materialCrop(src: string) {
  const category = src.split('/')[2]
  if (category === 'base_coat_french') return { x: 0.14, y: 0.27, width: 0.57, height: 0.5 }
  return category === 'base_coat_pink' || category === 'base_coat_purple'
    ? { x: 0.08, y: 0.03, width: 0.84, height: 0.94 }
    : { x: 0, y: 0, width: 1, height: 1 }
}
