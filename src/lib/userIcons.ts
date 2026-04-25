const USER_ICONS: Record<string, string> = {
  'はじむ': '/icon/hazimu.jpeg',
  'スラパン': '/icon/slapan.jpeg',
  'こんべ': '/icon/konbe.jpeg',
  'かねおか': '/icon/kaneoka.jpeg',
  'カズさん': '/icon/kazsan.jpeg',
}

export function getUserIcon(name: string): string | null {
  return USER_ICONS[name] ?? null
}
