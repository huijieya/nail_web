export type NailShapeInfo = {
  folder: string
  icon: string
  fullPath: string
}

export const nailShapeInfos: Record<string, NailShapeInfo> = {
  杏仁形: {
    folder: '杏仁形',
    icon: '◒',
    fullPath: 'M50 0 C25 0 10 28 10 66 L14 164 C16 201 32 220 50 220 C68 220 84 201 86 164 L90 66 C90 28 75 0 50 0 Z',
  },
  方圆形: {
    folder: '方圆形',
    icon: '▱',
    fullPath: 'M18 0 H82 C87 0 90 6 90 14 V164 C90 200 74 220 50 220 C26 220 10 200 10 164 V14 C10 6 13 0 18 0 Z',
  },
  方形: {
    folder: '方形',
    icon: '□',
    fullPath: 'M14 0 H86 C88 0 90 3 90 8 V164 C90 201 73 220 50 220 C27 220 10 201 10 164 V8 C10 3 12 0 14 0 Z',
  },
  椭圆形: {
    folder: '椭圆形',
    icon: '◯',
    fullPath: 'M50 0 C24 0 10 27 10 66 V164 C10 200 26 220 50 220 C74 220 90 200 90 164 V66 C90 27 76 0 50 0 Z',
  },
  梯形: {
    folder: '梯形',
    icon: '⬡',
    fullPath: 'M20 0 H80 C86 0 90 6 90 14 V164 C90 201 73 220 50 220 C27 220 10 201 10 164 V14 C10 6 14 0 20 0 Z',
  },
  尖形: {
    folder: '尖形-水滴形',
    icon: '◇',
    fullPath: 'M50 0 C31 16 12 44 10 75 L15 167 C17 202 33 220 50 220 C67 220 83 202 85 167 L90 75 C88 44 69 16 50 0 Z',
  },
}

export function getNailShapeInfo(shape: string) {
  return nailShapeInfos[shape] ?? nailShapeInfos['杏仁形']
}
