export const USER_TO_AI_CHAR: Record<string, string> = {
  'はじむ': 'はじむ(AI)',
  'スラパン': 'スラパン(AI)',
  'こんべ': 'こんべ(AI)',
  'カズさん': 'カズさん(AI)',
  'かっぴー': 'かっぴー(AI)',
}

export function getExhibitionAiChar(userName: string): string | null {
  return USER_TO_AI_CHAR[userName] ?? null
}
