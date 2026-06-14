const USER_ICONS: Record<string, string> = {
  'はじむ': '/icon/hazimu.jpeg',
  'スラパン': '/icon/slapan.jpeg',
  'こんべ': '/icon/konbe.jpeg',
  'かっぴー': '/icon/kaneoka.jpeg',
  'カズさん': '/icon/kazsan.jpeg',
  'リナちゃん': '/icon/rina.png',
  'デスク・大河内': '/icon/okochi.png',
  '田所 伝兵衛': '/icon/tadokoro.png',
  'Fuw-Fuw': '/icon/fuwfuw.png',
}

export function getUserIcon(name: string): string | null {
  return USER_ICONS[name] ?? null
}
