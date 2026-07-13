import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AI_MODEL_PLAYER } from '@/lib/ai-config'
import { getAiCharacterDef } from '@/lib/ai-characters'
import { getCharacterDataContext } from '@/lib/ai-character-data'
import { getExhibitionAiChar } from '@/lib/exhibition-config'

interface SuggestRequest {
  tournament_id: string
  user_id: string
  game_id?: string
  phase: 'cards' | 'submit' | 'vote' | 'tiebreaker_vote'
}

export async function POST(request: Request) {
  const { tournament_id, user_id, game_id, phase }: SuggestRequest = await request.json()

  if (!tournament_id || !user_id || !phase) {
    return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 })
  }

  const { data: user } = await supabase.from('users').select('name').eq('id', user_id).single()
  if (!user) return NextResponse.json({ error: 'ユーザーが見つかりません' }, { status: 404 })

  const aiCharName = getExhibitionAiChar(user.name)
  if (!aiCharName) return NextResponse.json({ error: `AIキャラクター未設定: ${user.name}` }, { status: 400 })

  const characterDef = getAiCharacterDef(aiCharName)
  if (!characterDef) return NextResponse.json({ error: `キャラ定義なし: ${aiCharName}` }, { status: 400 })

  const dataContext = await getCharacterDataContext(aiCharName)

  if (phase === 'cards') {
    return handleCards(tournament_id, user_id, characterDef, dataContext)
  }
  if ((phase === 'submit') && game_id) {
    return handleSubmit(tournament_id, user_id, game_id, characterDef, dataContext)
  }
  if ((phase === 'vote' || phase === 'tiebreaker_vote') && game_id) {
    return handleVote(user_id, game_id, phase === 'tiebreaker_vote', characterDef, dataContext)
  }

  return NextResponse.json({ error: '不明なphaseまたはgame_id不足' }, { status: 400 })
}

async function handleCards(
  tournamentId: string,
  userId: string,
  characterDef: ReturnType<typeof getAiCharacterDef>,
  dataContext: string | null,
) {
  if (!characterDef) return NextResponse.json({ error: 'キャラ定義なし' }, { status: 400 })

  const { data: existing } = await supabase
    .from('exhibition_card_suggestions')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, reason: '既に生成済み' })

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('cards_per_user, dirty_cards_per_user')
    .eq('id', tournamentId)
    .single()

  if (!tournament) return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })

  const normalCount = tournament.cards_per_user - (tournament.dirty_cards_per_user ?? 0)
  const dirtyCount = tournament.dirty_cards_per_user ?? 0
  const charContext = [characterDef.cardPrompt, dataContext].filter(Boolean).join('\n')

  const regular = await generateCardTexts(normalCount, false, charContext)
  const dirty = dirtyCount > 0 ? await generateCardTexts(dirtyCount, true, charContext) : []

  const { error } = await supabaseAdmin
    .from('exhibition_card_suggestions')
    .insert({ tournament_id: tournamentId, user_id: userId, texts: { regular, dirty } })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

async function handleSubmit(
  tournamentId: string,
  userId: string,
  gameId: string,
  characterDef: ReturnType<typeof getAiCharacterDef>,
  dataContext: string | null,
) {
  if (!characterDef) return NextResponse.json({ error: 'キャラ定義なし' }, { status: 400 })

  const { data: existing } = await supabase
    .from('exhibition_submissions')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, reason: '既に生成済み' })

  const { data: game } = await supabase
    .from('games')
    .select('topic_card_id, voting_mode')
    .eq('id', gameId)
    .single()

  if (!game) return NextResponse.json({ error: 'ゲームが見つかりません' }, { status: 404 })

  const { data: topicCard } = await supabase
    .from('cards')
    .select('text')
    .eq('id', game.topic_card_id)
    .single()

  if (!topicCard) return NextResponse.json({ error: 'お題カードなし' }, { status: 500 })

  const { data: handCards } = await supabase
    .from('player_hands')
    .select('card_id, cards(text)')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .eq('is_used', false)

  if (!handCards || handCards.length === 0) {
    return NextResponse.json({ error: '手札なし' }, { status: 500 })
  }

  const handList = handCards
    .map((h, i) => {
      const text = (h.cards as unknown as { text: string } | null)?.text ?? ''
      return `${i + 1}. 「${text}」`
    })
    .join('\n')

  const votingModeLabel =
    game.voting_mode === 'secret' ? 'シークレット（作者名非表示）' :
    game.voting_mode === 'impersonation' ? 'なりすまし（偽名で出品）' : '通常'

  const prompt = `${characterDef.submissionSystemPrompt}${dataContext ? `\n${dataContext}` : ''}

おもじゃんのルール：
- お題カードのテキストの前か後ろに手札を配置して作品を作る
- 「前口上」（任意）でコメントを付けられる
- 面白い作品を目指す

お題：「${topicCard.text}」
投票モード：${votingModeLabel}

手札（番号で選択してください）：
${handList}

以下のJSON形式のみで回答してください（説明不要）：
{"card_index": <手札の番号(1始まり)>, "position": "<before|after>", "preamble": "<前口上テキストまたはnull>", "preamble_position": "<above|below>"}`

  const res = await callAnthropic(prompt)

  let parsed: { card_index: number; position: 'before' | 'after'; preamble: string | null; preamble_position?: 'above' | 'below' }
  try {
    const jsonMatch = (res ?? '').match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('JSON not found')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    parsed = {
      card_index: Math.floor(Math.random() * handCards.length) + 1,
      position: Math.random() < 0.5 ? 'before' : 'after',
      preamble: null,
      preamble_position: 'above',
    }
  }

  const idx = Math.min(Math.max((parsed.card_index ?? 1) - 1, 0), handCards.length - 1)
  const handCardId = handCards[idx].card_id
  const position = parsed.position === 'before' ? 'before' : 'after'
  const preamble = typeof parsed.preamble === 'string' && parsed.preamble.length > 0 ? parsed.preamble : null
  const preamblePosition = parsed.preamble_position === 'below' ? 'below' : 'above'

  const { error } = await supabaseAdmin.from('exhibition_submissions').insert({
    game_id: gameId,
    user_id: userId,
    hand_card_id: handCardId,
    position,
    preamble,
    preamble_position: preamblePosition,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

async function handleVote(
  userId: string,
  gameId: string,
  isTiebreaker: boolean,
  characterDef: ReturnType<typeof getAiCharacterDef>,
  dataContext: string | null,
) {
  if (!characterDef) return NextResponse.json({ error: 'キャラ定義なし' }, { status: 400 })

  const { data: existing } = await supabase
    .from('exhibition_votes')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .eq('is_tiebreaker', isTiebreaker)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, reason: '既に生成済み' })

  const { data: game } = await supabase
    .from('games')
    .select('topic_card_id')
    .eq('id', gameId)
    .single()

  if (!game) return NextResponse.json({ error: 'ゲームが見つかりません' }, { status: 404 })

  let submissionsQuery = supabase
    .from('submissions')
    .select('id, user_id, position, preamble, hand_card_id, cards!hand_card_id(text)')
    .eq('game_id', gameId)

  if (isTiebreaker) {
    const { data: initialVotes } = await supabase
      .from('votes')
      .select('submission_id')
      .eq('game_id', gameId)
      .eq('is_tiebreaker', false)

    const initCount: Record<string, number> = {}
    for (const v of initialVotes ?? []) {
      initCount[v.submission_id] = (initCount[v.submission_id] ?? 0) + 1
    }
    const maxInit = Math.max(...Object.values(initCount), 0)
    const tiedSubIds = Object.entries(initCount).filter(([, c]) => c === maxInit).map(([id]) => id)

    const { data: tiedSubs } = await supabase.from('submissions').select('user_id').in('id', tiedSubIds)
    const authorIds = new Set((tiedSubs ?? []).map((s) => s.user_id))
    if (authorIds.has(userId)) {
      return NextResponse.json({ skipped: true, reason: '作者は投票不可' })
    }

    submissionsQuery = supabase
      .from('submissions')
      .select('id, user_id, position, preamble, hand_card_id, cards!hand_card_id(text)')
      .in('id', tiedSubIds)
  }

  const { data: submissions } = await submissionsQuery
  const votable = (submissions ?? []).filter((s) => s.user_id !== userId)

  if (votable.length === 0) return NextResponse.json({ skipped: true, reason: '投票対象なし' })

  const { data: topicCard } = await supabase.from('cards').select('text').eq('id', game.topic_card_id).single()
  const topicText = topicCard?.text ?? ''

  const workList = votable.map((s, i) => {
    const handText = (s.cards as unknown as { text: string } | null)?.text ?? ''
    const fullText = s.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`
    const preambleStr = s.preamble ? `（前口上: ${s.preamble}）` : ''
    return `${i + 1}. 「${fullText}」${preambleStr}`
  }).join('\n')

  const prompt = `${characterDef.voteSystemPrompt}${dataContext ? `\n${dataContext}` : ''}

お題：「${topicText}」

作品一覧（自分の作品は除外済み）：
${workList}

一番面白いと思う作品の番号のみJSON形式で回答してください：
{"submission_index": <番号(1始まり)>}`

  const res = await callAnthropic(prompt)

  let chosenIdx = Math.floor(Math.random() * votable.length)
  if (res) {
    try {
      const jsonMatch = res.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const idx = (parsed.submission_index ?? 1) - 1
        if (idx >= 0 && idx < votable.length) chosenIdx = idx
      }
    } catch { /* フォールバック：ランダム */ }
  }

  const chosenSubmissionId = votable[chosenIdx].id

  const { error } = await supabaseAdmin.from('exhibition_votes').insert({
    game_id: gameId,
    user_id: userId,
    submission_id: chosenSubmissionId,
    is_tiebreaker: isTiebreaker,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

async function generateCardTexts(count: number, isDirty: boolean, charContext: string): Promise<string[]> {
  const contextPart = charContext ? `\nキャラクター設定：${charContext}\n上記キャラクターらしい札を生成してください。` : ''

  const prompt = isDirty
    ? `おもじゃんというカードゲーム用の「下ネタ・エロ系」専用の札テキストを${count}枚生成してください。${contextPart}
ルール：
- 1〜20文字で生成
- 単語・短い文章・前後に何かをくっつけると文章になりそうなもの
- **全て下ネタ・性的・卑猥な表現にすること**（これは下ネタ専用枠なので遠慮不要）
- 直接的なもの・婉曲的なもの・笑えるものを混ぜて
- キャラの傾向を参考にしつつ、過去の札と被らないオリジナルな表現を作ること
- JSONの配列形式で返す。例: ["テキスト1", "テキスト2"]
- 余計な説明は不要。JSONのみ返す`
    : `おもじゃんというカードゲーム用の札テキストを${count}枚生成してください。${contextPart}
ルール：
- 1〜20文字で生成
- 単語・短い文章・前後に何かをくっつけると文章になりそうなもの
- 面白い・シュール・意外性のあるものを混ぜて
- キャラの傾向を参考にしつつ、過去の札と被らないオリジナルな表現を作ること
- 過去の札をそのままコピーしたり組み合わせるだけにならないこと
- 下ネタ・性的表現はほぼ入れないこと（下ネタ専用枠が別にあるため、通常札はシュール・面白系に徹する）
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
  if (!jsonMatch) return Array(count).fill('（生成失敗）')
  try {
    const cards: string[] = JSON.parse(jsonMatch[0])
    return cards.slice(0, count)
  } catch {
    return Array(count).fill('（生成失敗）')
  }
}

async function callAnthropic(prompt: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL_PLAYER,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } catch {
    return null
  }
}
