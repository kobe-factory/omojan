import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AI_MODEL_PLAYER } from '@/lib/ai-config'
import { getAiCharacterDef } from '@/lib/ai-characters'
import { getCharacterDataContext } from '@/lib/ai-character-data'

type Phase = 'submit' | 'vote' | 'tiebreaker_vote' | 'button_mash'

interface ActRequest {
  tournament_id: string
  phase: Phase
  character_name?: string // エキシビション時に指定
}

export async function POST(request: Request) {
  const { tournament_id, phase, character_name: overrideCharacter }: ActRequest = await request.json()

  if (!tournament_id || !phase) {
    return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 })
  }

  // 大会情報取得
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, ai_player_character, tournament_type, mode')
    .eq('id', tournament_id)
    .single()

  const characterName = overrideCharacter ?? tournament?.ai_player_character
  if (!characterName) {
    return NextResponse.json({ error: 'AIプレイヤー未設定' }, { status: 400 })
  }
  const characterDef = getAiCharacterDef(characterName)
  if (!characterDef) {
    return NextResponse.json({ error: `キャラ定義なし: ${characterName}` }, { status: 400 })
  }

  // AIユーザーIDを取得
  const { data: aiUser } = await supabase
    .from('users')
    .select('id')
    .eq('name', characterName)
    .single()

  if (!aiUser) {
    return NextResponse.json({ error: `AIユーザーがDBに存在しません: ${characterName}` }, { status: 400 })
  }

  const aiUserId = aiUser.id

  // 現在のゲーム取得（最新）
  const { data: currentGame } = await supabase
    .from('games')
    .select('id, status, topic_card_id, voting_mode, button_mash_type, mash_current_round')
    .eq('tournament_id', tournament_id)
    .gt('round_number', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!currentGame) {
    return NextResponse.json({ error: 'ゲームが見つかりません' }, { status: 404 })
  }

  // JSONデータからキャラクターコンテキストを取得（個人AI・Fuw-Fuw用）
  const dataContext = await getCharacterDataContext(characterName)

  if (phase === 'submit') {
    return handleSubmit(aiUserId, tournament_id, currentGame, characterDef, dataContext)
  }
  if (phase === 'vote') {
    return handleVote(aiUserId, currentGame, characterDef, false, dataContext)
  }
  if (phase === 'tiebreaker_vote') {
    return handleVote(aiUserId, currentGame, characterDef, true, dataContext)
  }
  if (phase === 'button_mash') {
    return handleButtonMash(aiUserId, currentGame)
  }

  return NextResponse.json({ error: '不明なphase' }, { status: 400 })
}

async function handleSubmit(
  aiUserId: string,
  tournamentId: string,
  game: { id: string; status: string; topic_card_id: string; voting_mode: string | null },
  characterDef: ReturnType<typeof getAiCharacterDef>,
  dataContext: string | null,
) {
  if (!characterDef) return NextResponse.json({ error: 'キャラ定義なし' }, { status: 400 })

  // 既に投稿済みならスキップ
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('game_id', game.id)
    .eq('user_id', aiUserId)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, reason: '投稿済み' })

  // お題カードのテキスト取得
  const { data: topicCard } = await supabase
    .from('cards')
    .select('text')
    .eq('id', game.topic_card_id)
    .single()

  if (!topicCard) return NextResponse.json({ error: 'お題カードなし' }, { status: 500 })

  // AIの手札取得（未使用のみ）
  const { data: handCards } = await supabase
    .from('player_hands')
    .select('card_id, cards(text)')
    .eq('tournament_id', tournamentId)
    .eq('user_id', aiUserId)
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
{"card_index": <手札の番号(1始まり)>, "position": "<before|after>", "preamble": "<前口上テキストまたはnull>"}`

  const res = await callAnthropic(prompt)
  if (!res) return NextResponse.json({ error: 'AI呼び出し失敗' }, { status: 500 })

  let parsed: { card_index: number; position: 'before' | 'after'; preamble: string | null }
  try {
    const jsonMatch = res.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('JSON not found')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    // パース失敗時はランダム選択
    parsed = {
      card_index: Math.floor(Math.random() * handCards.length) + 1,
      position: Math.random() < 0.5 ? 'before' : 'after',
      preamble: null,
    }
  }

  const idx = Math.min(Math.max((parsed.card_index ?? 1) - 1, 0), handCards.length - 1)
  const selectedHand = handCards[idx]
  const handCardId = selectedHand.card_id
  const position = parsed.position === 'before' || parsed.position === 'after' ? parsed.position : 'before'
  const preamble = typeof parsed.preamble === 'string' && parsed.preamble.length > 0 ? parsed.preamble : null

  // なりすましモード時はランダムな参加者IDを設定（AIなので自分以外）
  let impersonatedUserId: string | null = null
  if (game.voting_mode === 'impersonation') {
    const { data: participants } = await supabase
      .from('tournament_participants')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .neq('user_id', aiUserId)
    if (participants && participants.length > 0) {
      impersonatedUserId = participants[Math.floor(Math.random() * participants.length)].user_id
    }
  }

  const { error: subError } = await supabase.from('submissions').insert({
    game_id: game.id,
    user_id: aiUserId,
    hand_card_id: handCardId,
    position,
    preamble,
    preamble_position: 'above',
    impersonated_user_id: impersonatedUserId,
  })

  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 })

  await supabase
    .from('player_hands')
    .update({ is_used: true })
    .eq('card_id', handCardId)
    .eq('user_id', aiUserId)

  return NextResponse.json({ success: true })
}

async function handleVote(
  aiUserId: string,
  game: { id: string; status: string; topic_card_id: string; voting_mode: string | null },
  characterDef: ReturnType<typeof getAiCharacterDef>,
  isTiebreaker: boolean,
  dataContext: string | null,
) {
  if (!characterDef) return NextResponse.json({ error: 'キャラ定義なし' }, { status: 400 })

  // 既に投票済みならスキップ
  const { data: existing } = await supabase
    .from('votes')
    .select('id')
    .eq('game_id', game.id)
    .eq('voter_user_id', aiUserId)
    .eq('is_tiebreaker', isTiebreaker)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, reason: '投票済み' })

  // 投票対象の作品取得
  let submissionsQuery = supabase
    .from('submissions')
    .select('id, user_id, position, preamble, hand_card_id, cards!hand_card_id(text)')
    .eq('game_id', game.id)

  if (isTiebreaker) {
    // 決選投票：初回投票で最多票の作品のみ対象
    const { data: initialVotes } = await supabase
      .from('votes')
      .select('submission_id')
      .eq('game_id', game.id)
      .eq('is_tiebreaker', false)

    const initCount: Record<string, number> = {}
    for (const v of initialVotes ?? []) {
      initCount[v.submission_id] = (initCount[v.submission_id] ?? 0) + 1
    }
    const maxInit = Math.max(...Object.values(initCount), 0)
    const tiedSubIds = Object.entries(initCount).filter(([, c]) => c === maxInit).map(([id]) => id)

    // AIが著者の作品には投票できないので、著者チェック
    const { data: tiedSubs } = await supabase
      .from('submissions')
      .select('id, user_id')
      .in('id', tiedSubIds)

    const authorIds = new Set((tiedSubs ?? []).map((s) => s.user_id))
    if (authorIds.has(aiUserId)) {
      return NextResponse.json({ skipped: true, reason: 'AIは自作品に投票不可（著者として資格なし）' })
    }

    submissionsQuery = supabase
      .from('submissions')
      .select('id, user_id, position, preamble, hand_card_id, cards!hand_card_id(text)')
      .in('id', tiedSubIds)
  }

  const { data: submissions } = await submissionsQuery

  if (!submissions || submissions.length === 0) {
    return NextResponse.json({ error: '投票対象作品なし' }, { status: 500 })
  }

  // 自分の作品を除外
  const votableSubmissions = submissions.filter((s) => s.user_id !== aiUserId)
  if (votableSubmissions.length === 0) {
    return NextResponse.json({ skipped: true, reason: '投票可能な作品なし' })
  }

  // お題テキスト取得
  const { data: topicCard } = await supabase
    .from('cards')
    .select('text')
    .eq('id', game.topic_card_id)
    .single()

  const topicText = topicCard?.text ?? ''

  const workList = votableSubmissions.map((s, i) => {
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

  let chosenIdx = Math.floor(Math.random() * votableSubmissions.length)
  if (res) {
    try {
      const jsonMatch = res.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const idx = (parsed.submission_index ?? 1) - 1
        if (idx >= 0 && idx < votableSubmissions.length) chosenIdx = idx
      }
    } catch { /* フォールバック：ランダム */ }
  }

  const chosenSubmission = votableSubmissions[chosenIdx]

  const { error: voteError } = await supabase.from('votes').insert({
    game_id: game.id,
    voter_user_id: aiUserId,
    submission_id: chosenSubmission.id,
    is_tiebreaker: isTiebreaker,
  })

  if (voteError) return NextResponse.json({ error: voteError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

async function handleButtonMash(
  aiUserId: string,
  game: { id: string; status: string; button_mash_type: string | null; mash_current_round: number },
) {
  // 初回投票で同票の作品の著者を特定
  const { data: initialVotes } = await supabase
    .from('votes')
    .select('submission_id')
    .eq('game_id', game.id)
    .eq('is_tiebreaker', false)

  const initCount: Record<string, number> = {}
  for (const v of initialVotes ?? []) {
    initCount[v.submission_id] = (initCount[v.submission_id] ?? 0) + 1
  }
  const maxInit = Math.max(...Object.values(initCount), 0)
  const tiedSubIds = Object.entries(initCount).filter(([, c]) => c === maxInit).map(([id]) => id)

  const { data: tiedSubs } = await supabase
    .from('submissions')
    .select('user_id')
    .in('id', tiedSubIds)

  const tiebreakerUserIds = (tiedSubs ?? []).map((s) => s.user_id)

  // AIがタイブレーカー対象でなければスキップ
  if (!tiebreakerUserIds.includes(aiUserId)) {
    return NextResponse.json({ skipped: true, reason: 'AIは連打対象外' })
  }

  const mashRound = game.mash_current_round ?? 1
  const mashType = game.button_mash_type ?? 'timed_3s'
  const isSpeedMode = mashType === 'speed_20tap' || mashType === 'speed_30tap'

  // 既に提出済みならスキップ
  const { data: existing } = await supabase
    .from('button_mash_results')
    .select('id')
    .eq('game_id', game.id)
    .eq('user_id', aiUserId)
    .eq('mash_round', mashRound)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, reason: '連打済み' })

  let tapCount: number
  let completionTimeMs: number | null = null

  if (isSpeedMode) {
    // スピードモード：完了時間で競う（800〜2000ms のランダム）
    completionTimeMs = 800 + Math.floor(Math.random() * 1200)
    tapCount = mashType === 'speed_20tap' ? 20 : 30
  } else {
    // カウントモード：3秒間のタップ数（15〜25）
    tapCount = 15 + Math.floor(Math.random() * 11)
  }

  const { error } = await supabaseAdmin
    .from('button_mash_results')
    .upsert(
      { game_id: game.id, user_id: aiUserId, tap_count: tapCount, mash_round: mashRound, completion_time_ms: completionTimeMs },
      { onConflict: 'game_id,user_id,mash_round' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, tap_count: tapCount, completion_time_ms: completionTimeMs })
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
