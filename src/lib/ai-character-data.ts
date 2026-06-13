import fs from 'fs/promises'
import path from 'path'

interface PlayerData {
  userId: string
  userName: string
  createdCards: string[]
  works: Array<{
    topicText: string
    handText: string
    position: string
    fullText: string
    preamble: string | null
    voteCount: number
  }>
  votedWorks: Array<{
    topicText: string
    handText: string
    position: string
    fullText: string
    creatorName: string
  }>
}

const JSON_FILE_MAP: Record<string, string> = {
  'こんべ(AI)': 'konbe',
  'スラパン(AI)': 'surapan',
  'はじむ(AI)': 'hajimu',
  'カズさん(AI)': 'kazusan',
  'かっぴー(AI)': 'kappii',
}

const ALL_FILES = ['konbe', 'surapan', 'hajimu', 'kazusan', 'kappii']

async function loadJson(fileName: string): Promise<PlayerData | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'ai_characters', `${fileName}.json`)
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as PlayerData
  } catch {
    return null
  }
}

// 個人AIキャラ（こんべ(AI)等）のコンテキスト生成
export async function buildPersonalAiContext(characterName: string): Promise<string | null> {
  const fileName = JSON_FILE_MAP[characterName]
  if (!fileName) return null

  const data = await loadJson(fileName)
  if (!data) return null

  const topWorks = [...data.works]
    .sort((a, b) => b.voteCount - a.voteCount)
    .slice(0, 5)

  const sampleCards = data.createdCards.slice(0, 20)
  const votedSample = data.votedWorks.slice(0, 5)

  return `
【${data.userName}の過去プレイデータ（このスタイルを模倣してください）】

■ 作成した札のサンプル（${data.userName}のワードセンス）：
${sampleCards.map((c) => `「${c}」`).join('　')}

■ 過去の作品（票を多く得た順）：
${topWorks.map((w) => `・「${w.fullText}」${w.preamble ? `（前口上：${w.preamble}）` : ''} → ${w.voteCount}票`).join('\n')}

■ 投票した作品（${data.userName}が面白いと感じた傾向）：
${votedSample.map((w) => `・「${w.fullText}」（${w.creatorName}作）`).join('\n')}
`
}

// Fuw-Fuw用：全5名のデータを合体
export async function buildFuwFuwContext(): Promise<string> {
  const allData = await Promise.all(ALL_FILES.map(loadJson))
  const validData = allData.filter(Boolean) as PlayerData[]

  let context = '【Fuw-Fuwは以下の5名の個性を全て増幅・混合させた存在です。各プレイヤーの特性を把握して、そのカオスな合体を表現してください】\n\n'

  for (const data of validData) {
    const topWorks = [...data.works]
      .sort((a, b) => b.voteCount - a.voteCount)
      .slice(0, 3)
    const sampleCards = data.createdCards.slice(0, 12)

    context += `■ ${data.userName}の個性：\n`
    context += `  札：${sampleCards.map((c) => `「${c}」`).join('　')}\n`
    context += `  代表作：${topWorks.map((w) => `「${w.fullText}」${w.preamble ? `(前口上:${w.preamble})` : ''}`).join('　')}\n\n`
  }

  return context
}

// キャラ名からコンテキストを取得（固定キャラはnullを返す）
export async function getCharacterDataContext(characterName: string): Promise<string | null> {
  if (characterName === 'Fuw-Fuw') {
    return buildFuwFuwContext()
  }
  if (JSON_FILE_MAP[characterName]) {
    return buildPersonalAiContext(characterName)
  }
  return null
}
