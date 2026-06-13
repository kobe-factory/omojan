import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AI_MODEL_PLAYER } from '@/lib/ai-config'
import { getAiCharacterDef } from '@/lib/ai-characters'
import { getCharacterDataContext } from '@/lib/ai-character-data'

interface GeneratePlayerCardsRequest {
  tournament_id: string
  user_id: string
  character_name: string
  cards_per_user: number
  dirty_cards_per_user: number
}

export async function POST(request: Request) {
  const { tournament_id, user_id, character_name, cards_per_user, dirty_cards_per_user }: GeneratePlayerCardsRequest = await request.json()

  if (!tournament_id || !user_id || !character_name || !cards_per_user) {
    return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 })
  }

  const characterDef = getAiCharacterDef(character_name)
  const dataContext = await getCharacterDataContext(character_name)
  const normalCount = cards_per_user - dirty_cards_per_user

  const characterContext = [characterDef?.cardPrompt, dataContext].filter(Boolean).join('\n') || undefined

  try {
    const normalCards = await generateCards(normalCount, false, characterContext)
    const dirtyCards = dirty_cards_per_user > 0
      ? await generateCards(dirty_cards_per_user, true, characterContext)
      : []

    const cardRows = [
      ...normalCards.map((text) => ({ tournament_id, creator_user_id: user_id, text, is_dirty: false })),
      ...dirtyCards.map((text) => ({ tournament_id, creator_user_id: user_id, text, is_dirty: true })),
    ]

    const { error } = await supabaseAdmin.from('cards').insert(cardRows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, count: cardRows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function generateCards(count: number, isDirty: boolean, characterContext?: string): Promise<string[]> {
  const charContext = characterContext ? `\nキャラクター設定：${characterContext}\n上記キャラクターらしい札を生成してください。` : ''

  const prompt = isDirty
    ? `おもじゃんというカードゲーム用の「下ネタ・エロ系」の札テキストを${count}枚生成してください。${charContext}

ルール：
- 1〜20文字で生成
- 直接的すぎる表現が難しい場合は間接的・婉曲的な表現でもOK
- 単語・短い文章・前後に何かをくっつけると文章になりそうなもの
- 笑えるもの・エロいもの・下品なものを混ぜて
- JSONの配列形式で返す。例: ["テキスト1", "テキスト2"]
- 余計な説明は不要。JSONのみ返す`
    : `おもじゃんというカードゲーム用の札テキストを${count}枚生成してください。${charContext}

ルール：
- 1〜20文字で生成（文字数はバラエティ豊かに混ぜること）
- 単語のみ（例：「山」「まっこり」）
- 短い文章（例：「こんなに？」「どこへでも」）
- 前後に何かをくっつけると文章になりそうなもの（例：「をミートソースで」「の奇跡」）
- 日常的なもの・社会的なもの・地名・人名・動詞・形容詞など
- 笑えるもの・シュールなもの・意外性のあるものを混ぜて
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
  if (!jsonMatch) throw new Error('カード生成レスポンスのパースに失敗')

  const cards: string[] = JSON.parse(jsonMatch[0])
  return cards.slice(0, count)
}
