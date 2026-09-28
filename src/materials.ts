export function materialCrop(src: string) {
  const category = src.split('/')[2]
  return category === 'base_coat_pink' || category === 'base_coat_purple'
    ? { x: .08, y: .03, width: .84, height: .94 }
    : { x: 0, y: 0, width: 1, height: 1 }
}
