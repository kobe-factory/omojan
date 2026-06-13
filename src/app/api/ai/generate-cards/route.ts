import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AI_MODEL_PLAYER } from '@/lib/ai-config'

interface GenerateCardsRequest {
  tournament_id: string
  cards_per_user: number
  dirty_cards_per_user: number
}

// ユーザーごとにカードを生成してDBに挿入する
export async function POST(request: Request) {
  const { tournament_id, cards_per_user, dirty_cards_per_user }: GenerateCardsRequest = await request.json()

  if (!tournament_id || !cards_per_user) {
    return NextResponse.json({ error: 'パラメータが不足しています' }, { status: 400 })
  }

  // 本番ユーザー一覧を取得（ソロ・テスト用AIユーザーを除く）
  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, name')
    .is('line_user_id', null)  // AIキャラを除外（line_user_id がないのは通常ユーザーも同じなので名前で絞る）

  if (usersError || !users || users.length === 0) {
    return NextResponse.json({ error: 'ユーザーの取得に失敗しました' }, { status: 500 })
  }

  // 5名の本番プレイヤーのみを対象（game.tsのUSERSリストと一致するユーザー）
  const PRODUCTION_USERS = ['はじむ', 'スラパン', 'こんべ', 'かねおか', 'カズさん']
  const targetUsers = users.filter((u) => PRODUCTION_USERS.includes(u.name))

  if (targetUsers.length === 0) {
    return NextResponse.json({ error: '対象ユーザーが見つかりません' }, { status: 500 })
  }

  const normalCardsPerUser = cards_per_user - dirty_cards_per_user
  const totalNormalCards = normalCardsPerUser * targetUsers.length
  const totalDirtyCards = dirty_cards_per_user * targetUsers.length

  try {
    // 通常カードを一括生成
    const normalCards = await generateCards(totalNormalCards, false)
    // 下ネタカードを一括生成
    const dirtyCards = dirty_cards_per_user > 0 ? await generateCards(totalDirtyCards, true) : []

    // ユーザーに均等に割り当て
    const cardRows: { tournament_id: string; creator_user_id: string; text: string; is_dirty: boolean }[] = []

    targetUsers.forEach((user, userIndex) => {
      // 通常カード割り当て
      for (let i = 0; i < normalCardsPerUser; i++) {
        const cardIndex = userIndex * normalCardsPerUser + i
        if (cardIndex < normalCards.length) {
          cardRows.push({
            tournament_id,
            creator_user_id: user.id,
            text: normalCards[cardIndex],
            is_dirty: false,
          })
        }
      }
      // 下ネタカード割り当て
      for (let i = 0; i < dirty_cards_per_user; i++) {
        const cardIndex = userIndex * dirty_cards_per_user + i
        if (cardIndex < dirtyCards.length) {
          cardRows.push({
            tournament_id,
            creator_user_id: user.id,
            text: dirtyCards[cardIndex],
            is_dirty: true,
          })
        }
      }
    })

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

async function generateCards(count: number, isDirty: boolean): Promise<string[]> {
  const prompt = isDirty
    ? `おもじゃんというカードゲーム用の「下ネタ・エロ系」の札テキストを${count}枚生成してください。

ルール：
- 1〜20文字で生成
- 直接的すぎる表現が難しい場合は間接的・婉曲的な表現でもOK
- 単語・短い文章・前後に何かをくっつけると文章になりそうなもの、など文字数はバラバラに
- 笑えるもの・エロいもの・下品なものを混ぜて
- JSONの配列形式で返す。例: ["テキスト1", "テキスト2"]
- 余計な説明は不要。JSONのみ返す`
    : `おもじゃんというカードゲーム用の札テキストを${count}枚生成してください。

ルール：
- 1〜20文字で生成（文字数はバラエティ豊かに混ぜること）
- 単語のみ（例：「山」「まっこり」）
- 短い文章（例：「こんなに？」「どこへでも」）
- 前後に何かをくっつけると文章になりそうなもの（例：「をミートソースで」「の奇跡」「連続して」）
- 日常的なもの・社会的なもの・地名・人名・動詞・形容詞など、テーマはバラバラに
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
