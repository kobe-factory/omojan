import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AI_MODEL_PLAYER } from '@/lib/ai-config'
import { getAiCharacterDef } from '@/lib/ai-characters'
import { buildPersonalAiContext } from '@/lib/ai-character-data'

interface GenerateCardsRequest {
  tournament_id: string
  cards_per_user: number
  dirty_cards_per_user: number
}

// 実ユーザー名 → AIキャラ名のマッピング
const USER_TO_AI_CHAR: Record<string, string> = {
  'はじむ':   'はじむ(AI)',
  'スラパン': 'スラパン(AI)',
  'こんべ':   'こんべ(AI)',
  'かっぴー': 'かっぴー(AI)',
  'カズさん': 'カズさん(AI)',
}

export async function POST(request: Request) {
  const { tournament_id, cards_per_user, dirty_cards_per_user }: GenerateCardsRequest = await request.json()

  if (!tournament_id || !cards_per_user) {
    return NextResponse.json({ error: 'パラメータが不足しています' }, { status: 400 })
  }

  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, name')

  if (usersError || !users || users.length === 0) {
    return NextResponse.json({ error: 'ユーザーの取得に失敗しました' }, { status: 500 })
  }

  const PRODUCTION_USERS = ['はじむ', 'スラパン', 'こんべ', 'かっぴー', 'カズさん']
  const targetUsers = users.filter((u) => PRODUCTION_USERS.includes(u.name))

  if (targetUsers.length === 0) {
    return NextResponse.json({ error: '対象ユーザーが見つかりません' }, { status: 500 })
  }

  const normalCardsPerUser = cards_per_user - dirty_cards_per_user

  try {
    const cardRows: { tournament_id: string; creator_user_id: string; text: string; is_dirty: boolean }[] = []

    // ユーザーごとに個別生成（並列）
    await Promise.all(targetUsers.map(async (user) => {
      const aiCharName = USER_TO_AI_CHAR[user.name]
      const characterDef = aiCharName ? getAiCharacterDef(aiCharName) : null
      const dataContext = aiCharName ? await buildPersonalAiContext(aiCharName) : null

      const normalCards = await generateCardsForUser(normalCardsPerUser, false, user.name, characterDef?.cardPrompt ?? null, dataContext)
      const dirtyCards = dirty_cards_per_user > 0
        ? await generateCardsForUser(dirty_cards_per_user, true, user.name, characterDef?.cardPrompt ?? null, dataContext)
        : []

      for (const text of normalCards) {
        cardRows.push({ tournament_id, creator_user_id: user.id, text, is_dirty: false })
      }
      for (const text of dirtyCards) {
        cardRows.push({ tournament_id, creator_user_id: user.id, text, is_dirty: true })
      }
    }))

    const { error: insertError } = await supabaseAdmin.from('cards').insert(cardRows)
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, count: cardRows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function generateCardsForUser(
  count: number,
  isDirty: boolean,
  userName: string,
  cardPrompt: string | null,
  dataContext: string | null,
): Promise<string[]> {
  const personalityPart = cardPrompt
    ? `\nキャラクター設定：${cardPrompt}`
    : ''

  const dataPart = dataContext
    ? `\n${dataContext}\n上記の過去データを参考に、${userName}らしいワードセンスを活かしつつ、過去の札と被らないオリジナルな表現を生成してください。`
    : ''

  const prompt = isDirty
    ? `おもじゃんというカードゲーム用の「下ネタ・エロ系」専用の札テキストを${count}枚生成してください。${personalityPart}${dataPart}

ルール：
- 1〜20文字で生成
- 単語・短い文章・前後に何かをくっつけると文章になりそうなもの
- **全て下ネタ・性的・卑猥な表現にすること**（これは下ネタ専用枠なので遠慮不要）
- 直接的なもの・婉曲的なもの・笑えるものを混ぜて
- 過去の札と被らないオリジナルな表現を作ること
- JSONの配列形式で返す。例: ["テキスト1", "テキスト2"]
- 余計な説明は不要。JSONのみ返す`
    : `おもじゃんというカードゲーム用の札テキストを${count}枚生成してください。${personalityPart}${dataPart}

ルール：
- 1〜20文字で生成（文字数はバラエティ豊かに）
- 単語のみ・短い文章・前後に何かをくっつけると文章になりそうなもの、など形式はバラバラに
- 面白い・シュール・意外性のあるものを混ぜて
- 下ネタ・性的表現はほぼ入れないこと（下ネタ専用枠が別にあるため）
- 過去の札をそのままコピーしたり似たような表現にならないこと
- JSONの配列形式で返す。例: ["テキスト1", "テキスト2"]
- 余計な説明は不要。JSONのみ返す`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL_PLAYER,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await res.json()
  const text: string = data.content?.[0]?.text ?? ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error(`${userName}のカード生成レスポンスのパースに失敗`)

  const cards: string[] = JSON.parse(jsonMatch[0])
  return cards.slice(0, count)
}
