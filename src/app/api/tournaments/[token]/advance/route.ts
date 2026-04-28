import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush } from '@/lib/line-push'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://omojan.vercel.app'

async function notifyParticipants(
  participantIds: string[],
  triggeringUserId: string | null,
  message: string
) {
  if (!triggeringUserId) return

  const targetIds = participantIds.filter((id) => id !== triggeringUserId)
  if (targetIds.length === 0) return

  const { data: users } = await supabase
    .from('users')
    .select('line_user_id')
    .in('id', targetIds)
    .not('line_user_id', 'is', null)

  const lineUserIds = (users ?? []).map((u) => u.line_user_id).filter(Boolean) as string[]
  await sendLinePush(lineUserIds, message)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  let confirmResult = false
  let triggeringUserId: string | null = null
  try {
    const body = await request.json()
    confirmResult = !!body.confirm_result
    triggeringUserId = body.triggering_user_id ?? null
  } catch { /* body なし */ }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, game_count, cards_per_user, hand_cards_per_player, required_players')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  const { data: participants } = await supabase
    .from('tournament_participants')
    .select('user_id')
    .eq('tournament_id', tournament.id)

  const participantCount = participants?.length ?? 0
  const participantIds = participants?.map((p) => p.user_id) ?? []

  // waiting_users → creating_cards（required_players人数揃ったら進行）
  if (tournament.status === 'waiting_users') {
    if (participantCount < tournament.required_players) {
      return NextResponse.json({ waiting: true, message: 'ユーザー参加待ち' })
    }

    await supabase
      .from('tournaments')
      .update({ status: 'creating_cards' })
      .eq('id', tournament.id)

    return NextResponse.json({ advanced: true, newStatus: 'creating_cards' })
  }

  // creating_cards → playing（全員が規定枚数作成済みか確認）
  if (tournament.status === 'creating_cards') {
    const { data: cardCounts } = await supabase
      .from('cards')
      .select('creator_user_id')
      .eq('tournament_id', tournament.id)

    const countByUser: Record<string, number> = {}
    for (const card of cardCounts ?? []) {
      countByUser[card.creator_user_id] = (countByUser[card.creator_user_id] ?? 0) + 1
    }

    const allDone = participantIds.every(
      (id) => (countByUser[id] ?? 0) >= tournament.cards_per_user
    )

    if (!allDone) {
      return NextResponse.json({ waiting: true, message: '札作成待ち', countByUser })
    }

    // 手札とお題を振り分け
    const { error: dealError } = await dealCards(tournament.id, participantIds, tournament.hand_cards_per_player)
    if (dealError) {
      return NextResponse.json({ error: dealError }, { status: 500 })
    }

    // 第1ゲームを作成
    const { error: gameError } = await createNextGame(tournament.id, 1)
    if (gameError) {
      return NextResponse.json({ error: gameError }, { status: 500 })
    }

    await supabase
      .from('tournaments')
      .update({ status: 'playing' })
      .eq('id', tournament.id)

    await notifyParticipants(
      participantIds,
      triggeringUserId,
      `全員の札作成が完了しました！\nおもじゃんを開いて作品を投稿しましょう 🎴\n${APP_URL}/current`
    )

    return NextResponse.json({ advanced: true, newStatus: 'playing' })
  }

  // playing: 現在のゲームの状態を確認して進行
  if (tournament.status === 'playing') {
    const { data: currentGame } = await supabase
      .from('games')
      .select('id, round_number, status')
      .eq('tournament_id', tournament.id)
      .order('round_number', { ascending: false })
      .limit(1)
      .single()

    if (!currentGame) {
      return NextResponse.json({ error: 'ゲームが見つかりません' }, { status: 500 })
    }

    // waiting_submission → waiting_vote（全員投稿済みか確認）
    if (currentGame.status === 'waiting_submission') {
      const { data: submissions } = await supabase
        .from('submissions')
        .select('user_id')
        .eq('game_id', currentGame.id)

      const submittedIds = new Set(submissions?.map((s) => s.user_id) ?? [])
      const allSubmitted = participantIds.every((id) => submittedIds.has(id))

      if (!allSubmitted) {
        const waiting = participantIds.filter((id) => !submittedIds.has(id))
        return NextResponse.json({ waiting: true, waitingUserIds: waiting })
      }

      await supabase
        .from('games')
        .update({ status: 'waiting_vote' })
        .eq('id', currentGame.id)

      await notifyParticipants(
        participantIds,
        triggeringUserId,
        `全員の作品投稿が完了しました！\nおもじゃんを開いて投票しましょう 🗳️\n${APP_URL}/current`
      )

      return NextResponse.json({ advanced: true, newGameStatus: 'waiting_vote' })
    }

    // waiting_vote → showing_result（全員投票済みか確認）
    if (currentGame.status === 'waiting_vote') {
      const { data: votes } = await supabase
        .from('votes')
        .select('voter_user_id')
        .eq('game_id', currentGame.id)

      const votedIds = new Set(votes?.map((v) => v.voter_user_id) ?? [])
      const allVoted = participantIds.every((id) => votedIds.has(id))

      if (!allVoted) {
        const waiting = participantIds.filter((id) => !votedIds.has(id))
        return NextResponse.json({ waiting: true, waitingUserIds: waiting })
      }

      await supabase
        .from('games')
        .update({ status: 'showing_result' })
        .eq('id', currentGame.id)

      await notifyParticipants(
        participantIds,
        triggeringUserId,
        `全員の投票が完了しました！\nおもじゃんを開いて結果を確認しましょう 🏆\n${APP_URL}/current`
      )

      return NextResponse.json({ advanced: true, newGameStatus: 'showing_result' })
    }

    // showing_result → 結果確認ボタン押下時のみ遷移（自動advance非対象）
    if (currentGame.status === 'showing_result') {
      if (!confirmResult) {
        return NextResponse.json({ noChange: true })
      }

      await supabase
        .from('games')
        .update({ status: 'finished' })
        .eq('id', currentGame.id)

      if (currentGame.round_number >= tournament.game_count) {
        await supabase
          .from('tournaments')
          .update({ status: 'finished' })
          .eq('id', tournament.id)

        return NextResponse.json({ advanced: true, newStatus: 'finished' })
      }

      const { error: gameError } = await createNextGame(tournament.id, currentGame.round_number + 1)
      if (gameError) {
        return NextResponse.json({ error: gameError }, { status: 500 })
      }

      return NextResponse.json({ advanced: true, newGameStatus: 'waiting_submission', round: currentGame.round_number + 1 })
    }
  }

  return NextResponse.json({ noChange: true })
}

async function dealCards(tournamentId: string, participantIds: string[], handCardsPerPlayer: number) {
  const { data: allCards } = await supabase
    .from('cards')
    .select('id')
    .eq('tournament_id', tournamentId)

  if (!allCards) return { error: 'カードが見つかりません' }

  // シャッフル
  const shuffled = [...allCards].sort(() => Math.random() - 0.5)

  const handCount = participantIds.length * handCardsPerPlayer
  const handCards = shuffled.slice(0, handCount)

  const handRows = []
  for (let i = 0; i < handCards.length; i++) {
    handRows.push({
      tournament_id: tournamentId,
      user_id: participantIds[i % participantIds.length],
      card_id: handCards[i].id,
      is_used: false,
    })
  }

  const { error } = await supabase.from('player_hands').insert(handRows)
  if (error) return { error: error.message }

  return { error: null }
}

async function createNextGame(tournamentId: string, roundNumber: number) {
  // 既存のゲームで使用済みのお題カードIDを取得
  const { data: usedTopics } = await supabase
    .from('games')
    .select('topic_card_id')
    .eq('tournament_id', tournamentId)

  const usedTopicIds = new Set(usedTopics?.map((g) => g.topic_card_id) ?? [])

  // 手札として配布されていないカードをお題候補にする
  const { data: handCardIds } = await supabase
    .from('player_hands')
    .select('card_id')
    .eq('tournament_id', tournamentId)

  const handCardIdSet = new Set(handCardIds?.map((h) => h.card_id) ?? [])

  const { data: allCards } = await supabase
    .from('cards')
    .select('id')
    .eq('tournament_id', tournamentId)

  const topicPool = (allCards ?? []).filter(
    (c) => !handCardIdSet.has(c.id) && !usedTopicIds.has(c.id)
  )

  if (topicPool.length === 0) {
    return { error: 'お題カードが不足しています' }
  }

  const topicCard = topicPool[Math.floor(Math.random() * topicPool.length)]

  const { error } = await supabase.from('games').insert({
    tournament_id: tournamentId,
    round_number: roundNumber,
    status: 'waiting_submission',
    topic_card_id: topicCard.id,
  })

  if (error) return { error: error.message }

  return { error: null }
}
