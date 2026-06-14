const USER_ICONS: Record<string, string> = {
  'はじむ': '/icon/hazimu.jpeg',
  'スラパン': '/icon/slapan.jpeg',
  'こんべ': '/icon/konbe.jpeg',
  'かっぴー': '/icon/kaneoka.jpeg',
  'カズさん': '/icon/kazsan.jpeg',
  'こんべ(AI)': '/icon/konbe.jpeg',
  'スラパン(AI)': '/icon/slapan.jpeg',
  'はじむ(AI)': '/icon/hazimu.jpeg',
  'カズさん(AI)': '/icon/kazsan.jpeg',
  'かっぴー(AI)': '/icon/kaneoka.jpeg',
  'リナちゃん': '/icon/rina.png',
  'デスク・大河内': '/icon/okochi.png',
  '田所 伝兵衛': '/icon/tadokoro.png',
  'Fuw-Fuw': '/icon/fuwfuw.png',
}

export function getUserIcon(name: string): string | null {
  return USER_ICONS[name] ?? null
}
