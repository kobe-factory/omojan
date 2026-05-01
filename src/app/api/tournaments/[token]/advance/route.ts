import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush, type LinePushPayload } from '@/lib/line-push'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

const PHASE_COLORS = {
  joining:    '#0284c7',
  cards:      '#d97706',
  playing:    '#059669',
  voting:     '#7c3aed',
  result:     '#ca8a04',
  rematch:    '#dc2626',
}

async function notifyParticipants(
  participantIds: string[],
  triggeringUserId: string | null,
  payload: LinePushPayload,
  mode: string
) {
  if (!triggeringUserId || mode !== 'production') return

  const targetIds = participantIds.filter((id) => id !== triggeringUserId)
  if (targetIds.length === 0) return

  const { data: users } = await supabase
    .from('users')
    .select('line_user_id')
    .in('id', targetIds)
    .not('line_user_id', 'is', null)

  const lineUserIds = (users ?? []).map((u) => u.line_user_id).filter(Boolean) as string[]
  await sendLinePush(lineUserIds, payload)
}

async function getTournamentNumber(tournamentId: string): Promise<number> {
  const { data } = await supabase
    .from('tournaments')
    .select('id, created_at')
    .eq('mode', 'production')
    .order('created_at', { ascending: true })

  const idx = (data ?? []).findIndex((t) => t.id === tournamentId)
  return idx >= 0 ? idx + 1 : 1
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
    .select('id, status, mode, game_count, cards_per_user, hand_cards_per_player, required_players, dirty_cards_per_user, skip_card_creation')
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

  // waiting_users → creating_cards (or playing if skip_card_creation)
  if (tournament.status === 'waiting_users') {
    if (participantCount < tournament.required_players) {
      return NextResponse.json({ waiting: true, message: 'ユーザー参加待ち' })
    }

    const num = await getTournamentNumber(tournament.id)

    if (tournament.skip_card_creation) {
      const { error: dealError } = await dealCards(tournament.id, participantIds, tournament.hand_cards_per_player, tournament.dirty_cards_per_user)
      if (dealError) return NextResponse.json({ error: dealError }, { status: 500 })

      const { error: gameError } = await createNextGame(tournament.id, 1, false)
      if (gameError) return NextResponse.json({ error: gameError }, { status: 500 })

      await supabase.from('tournaments').update({ status: 'playing' }).eq('id', tournament.id)

      await notifyParticipants(participantIds, triggeringUserId, {
        headerTitle: '🎨 作品投稿の時間！',
        headerColor: PHASE_COLORS.playing,
        headerSub: `第${num}回大会 / 1回戦`,
        body: '全員の参加が揃いました！\nおもじゃんを開いて作品を投稿しましょう 🎨',
        url: LIFF_URL,
      }, tournament.mode)

      return NextResponse.json({ advanced: true, newStatus: 'playing' })
    }

    await supabase.from('tournaments').update({ status: 'creating_cards' }).eq('id', tournament.id)

    await notifyParticipants(participantIds, triggeringUserId, {
      headerTitle: '✍️ お題作成どうぞ！',
      headerColor: PHASE_COLORS.cards,
      headerSub: `第${num}回大会`,
      body: '全員の参加が揃いました！\nおもじゃんを開いてお題を作成してください ✍️',
      url: LIFF_URL,
    }, tournament.mode)

    return NextResponse.json({ advanced: true, newStatus: 'creating_cards' })
  }

  // creating_cards → playing
  if (tournament.status === 'creating_cards') {
    const { data: cardCounts } = await supabase
      .from('cards')
      .select('creator_user_id')
      .eq('tournament_id', tournament.id)

    const countByUser: Record<string, number> = {}
    for (const card of cardCounts ?? []) {
      countByUser[card.creator_user_id] = (countByUser[card.creator_user_id] ?? 0) + 1
    }

    const allDone = participantIds.every((id) => (countByUser[id] ?? 0) >= tournament.cards_per_user)
    if (!allDone) {
      return NextResponse.json({ waiting: true, message: '札作成待ち', countByUser })
    }

    const { error: dealError } = await dealCards(tournament.id, participantIds, tournament.hand_cards_per_player, tournament.dirty_cards_per_user)
    if (dealError) return NextResponse.json({ error: dealError }, { status: 500 })

    const { error: gameError } = await createNextGame(tournament.id, 1, false)
    if (gameError) return NextResponse.json({ error: gameError }, { status: 500 })

    await supabase.from('tournaments').update({ status: 'playing' }).eq('id', tournament.id)

    const num = await getTournamentNumber(tournament.id)
    await notifyParticipants(participantIds, triggeringUserId, {
      headerTitle: '🎨 作品投稿の時間！',
      headerColor: PHASE_COLORS.playing,
      headerSub: `第${num}回大会 / 1回戦`,
      body: '全員の札作成が完了しました！\nおもじゃんを開いて作品を投稿しましょう 🎨',
      url: LIFF_URL,
    }, tournament.mode)

    return NextResponse.json({ advanced: true, newStatus: 'playing' })
  }

  // playing
  if (tournament.status === 'playing') {
    const { data: currentGame } = await supabase
      .from('games')
      .select('id, round_number, status, topic_card_id, is_rematch')
      .eq('tournament_id', tournament.id)
      .order('round_number', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!currentGame) {
      return NextResponse.json({ error: 'ゲームが見つかりません' }, { status: 500 })
    }

    // waiting_submission → waiting_vote
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

      await supabase.from('games').update({ status: 'waiting_vote' }).eq('id', currentGame.id)

      const num = await getTournamentNumber(tournament.id)
      await notifyParticipants(participantIds, triggeringUserId, {
        headerTitle: '🗳️ 投票が始まりました！',
        headerColor: PHASE_COLORS.voting,
        headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
        body: '全員の作品投稿が完了しました！\nおもじゃんを開いて投票しましょう 🗳️',
        url: LIFF_URL,
      }, tournament.mode)

      return NextResponse.json({ advanced: true, newGameStatus: 'waiting_vote' })
    }

    // waiting_vote → tiebreaker or rematch or showing_result
    if (currentGame.status === 'waiting_vote') {
      const { data: votes } = await supabase
        .from('votes')
        .select('voter_user_id, submission_id')
        .eq('game_id', currentGame.id)
        .eq('is_tiebreaker', false)

      const votedIds = new Set(votes?.map((v) => v.voter_user_id) ?? [])
      const allVoted = participantIds.every((id) => votedIds.has(id))

      if (!allVoted) {
        const waiting = participantIds.filter((id) => !votedIds.has(id))
        return NextResponse.json({ waiting: true, waitingUserIds: waiting })
      }

      const voteCount: Record<string, number> = {}
      for (const v of votes ?? []) {
        voteCount[v.submission_id] = (voteCount[v.submission_id] ?? 0) + 1
      }

      const maxVotes = Object.values(voteCount).length > 0 ? Math.max(...Object.values(voteCount)) : 0
      const tiedAtTopIds = Object.entries(voteCount)
        .filter(([, c]) => c === maxVotes)
        .map(([id]) => id)

      // ソロモード：決選投票フローのテスト用に強制遷移
      if (tournament.mode === 'solo') {
        await supabase.from('games').update({ status: 'waiting_tiebreaker_vote' }).eq('id', currentGame.id)
        return NextResponse.json({ advanced: true, newGameStatus: 'waiting_tiebreaker_vote' })
      }

      const num = await getTournamentNumber(tournament.id)

      if (tiedAtTopIds.length >= 3) {
        // 3作品以上同票 → 再戦
        await supabase.from('games').update({ status: 'showing_rematch' }).eq('id', currentGame.id)

        await notifyParticipants(participantIds, triggeringUserId, {
          headerTitle: '🔄 再戦が決定しました！',
          headerColor: PHASE_COLORS.rematch,
          headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
          body: '全員同票のためこの回はお流れです。\nおもじゃんを開いて確認してください 🔄',
          url: LIFF_URL,
        }, tournament.mode)

        return NextResponse.json({ advanced: true, newGameStatus: 'showing_rematch' })
      }

      if (tiedAtTopIds.length === 2) {
        // 2作品同票 → 決選投票
        await supabase.from('games').update({ status: 'waiting_tiebreaker_vote' }).eq('id', currentGame.id)

        // 決選投票の通知は作者以外の投票資格者のみに送信
        const { data: tiedSubsForNotify } = await supabase
          .from('submissions')
          .select('user_id')
          .in('id', tiedAtTopIds)
        const tiedAuthorIds = new Set((tiedSubsForNotify ?? []).map((s) => s.user_id))
        const eligibleForNotify = participantIds.filter((id) => !tiedAuthorIds.has(id))

        await notifyParticipants(eligibleForNotify, triggeringUserId, {
          headerTitle: '🗳️ 決選投票が始まりました！',
          headerColor: PHASE_COLORS.voting,
          headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
          body: '同票のため決選投票が行われます！\nおもじゃんを開いて投票しましょう 🗳️',
          url: LIFF_URL,
        }, tournament.mode)

        return NextResponse.json({ advanced: true, newGameStatus: 'waiting_tiebreaker_vote' })
      }

      // 明確な勝者
      await supabase.from('games').update({ status: 'showing_result' }).eq('id', currentGame.id)

      await notifyParticipants(participantIds, triggeringUserId, {
        headerTitle: '🏆 結果発表！',
        headerColor: PHASE_COLORS.result,
        headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
        body: '全員の投票が完了しました！\nおもじゃんを開いて結果を確認しましょう 🏆',
        url: LIFF_URL,
      }, tournament.mode)

      return NextResponse.json({ advanced: true, newGameStatus: 'showing_result' })
    }

    // waiting_tiebreaker_vote → showing_result
    if (currentGame.status === 'waiting_tiebreaker_vote') {
      // 決選対象の2作品を特定（初回投票で最多票）
      const { data: initialVotes } = await supabase
        .from('votes')
        .select('submission_id')
        .eq('game_id', currentGame.id)
        .eq('is_tiebreaker', false)

      const initCount: Record<string, number> = {}
      for (const v of initialVotes ?? []) {
        initCount[v.submission_id] = (initCount[v.submission_id] ?? 0) + 1
      }
      const maxInit = Math.max(...Object.values(initCount), 0)
      const tiedSubIds = Object.entries(initCount)
        .filter(([, c]) => c === maxInit)
        .map(([id]) => id)

      // 投票資格者：本番モードは作者以外、それ以外は全員
      let eligibleVoterIds: string[]
      if (tournament.mode === 'production') {
        const { data: tiedSubs } = await supabase
          .from('submissions')
          .select('user_id')
          .in('id', tiedSubIds)
        const authorIds = new Set((tiedSubs ?? []).map((s) => s.user_id))
        eligibleVoterIds = participantIds.filter((id) => !authorIds.has(id))
      } else {
        eligibleVoterIds = [...participantIds]
      }

      const { data: tbVotes } = await supabase
        .from('votes')
        .select('voter_user_id')
        .eq('game_id', currentGame.id)
        .eq('is_tiebreaker', true)

      const tbVotedIds = new Set((tbVotes ?? []).map((v) => v.voter_user_id))
      const allTbVoted = eligibleVoterIds.every((id) => tbVotedIds.has(id))

      if (!allTbVoted) {
        const waiting = eligibleVoterIds.filter((id) => !tbVotedIds.has(id))
        return NextResponse.json({ waiting: true, waitingUserIds: waiting })
      }

      await supabase.from('games').update({ status: 'showing_result' }).eq('id', currentGame.id)

      const num = await getTournamentNumber(tournament.id)
      await notifyParticipants(participantIds, triggeringUserId, {
        headerTitle: '🏆 結果発表！',
        headerColor: PHASE_COLORS.result,
        headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
        body: '決選投票が完了しました！\nおもじゃんを開いて結果を確認しましょう 🏆',
        url: LIFF_URL,
      }, tournament.mode)

      return NextResponse.json({ advanced: true, newGameStatus: 'showing_result' })
    }

    // showing_result or showing_rematch → confirm_result で次へ
    if (currentGame.status === 'showing_result' || currentGame.status === 'showing_rematch') {
      if (!confirmResult) {
        return NextResponse.json({ noChange: true })
      }

      if (currentGame.status === 'showing_rematch') {
        // 手札を戻す（再戦で使い直せるように）
        const { data: subs } = await supabase
          .from('submissions')
          .select('hand_card_id')
          .eq('game_id', currentGame.id)

        const handCardIds = (subs ?? []).map((s) => s.hand_card_id).filter(Boolean)
        if (handCardIds.length > 0) {
          await supabase
            .from('player_hands')
            .update({ is_used: false })
            .in('card_id', handCardIds)
            .eq('tournament_id', tournament.id)
        }

        // 投稿を削除（再投稿のため）
        await supabase.from('submissions').delete().eq('game_id', currentGame.id)

        // 同ラウンドで再戦ゲームを作成（is_rematch=true）
        const { error: gameError } = await createNextGame(
          tournament.id,
          currentGame.round_number,
          true,
          currentGame.topic_card_id
        )
        if (gameError) return NextResponse.json({ error: gameError }, { status: 500 })

        return NextResponse.json({ advanced: true, newGameStatus: 'waiting_submission', round: currentGame.round_number })
      }

      // 通常の showing_result 処理
      await supabase.from('games').update({ status: 'finished' }).eq('id', currentGame.id)

      if (currentGame.round_number >= tournament.game_count) {
        await supabase.from('tournaments').update({ status: 'finished' }).eq('id', tournament.id)
        return NextResponse.json({ advanced: true, newStatus: 'finished' })
      }

      const { error: gameError } = await createNextGame(tournament.id, currentGame.round_number + 1, false)
      if (gameError) return NextResponse.json({ error: gameError }, { status: 500 })

      return NextResponse.json({ advanced: true, newGameStatus: 'waiting_submission', round: currentGame.round_number + 1 })
    }
  }

  return NextResponse.json({ noChange: true })
}

async function dealCards(tournamentId: string, participantIds: string[], handCardsPerPlayer: number, dirtyCardsPerUser: number) {
  const { data: allCards } = await supabase
    .from('cards')
    .select('id, is_dirty')
    .eq('tournament_id', tournamentId)

  if (!allCards) return { error: 'カードが見つかりません' }

  const dirtyCards = allCards.filter((c) => c.is_dirty)
  const regularCards = allCards.filter((c) => !c.is_dirty)

  const shuffledDirty = [...dirtyCards].sort(() => Math.random() - 0.5)
  const shuffledRegular = [...regularCards].sort(() => Math.random() - 0.5)

  const handRows = []

  for (let i = 0; i < participantIds.length; i++) {
    const playerDirty = shuffledDirty.slice(i * dirtyCardsPerUser, (i + 1) * dirtyCardsPerUser)
    for (const card of playerDirty) {
      handRows.push({ tournament_id: tournamentId, user_id: participantIds[i], card_id: card.id, is_used: false })
    }
  }

  const regularPerPlayer = handCardsPerPlayer - dirtyCardsPerUser
  for (let i = 0; i < participantIds.length; i++) {
    const playerRegular = shuffledRegular.slice(i * regularPerPlayer, (i + 1) * regularPerPlayer)
    for (const card of playerRegular) {
      handRows.push({ tournament_id: tournamentId, user_id: participantIds[i], card_id: card.id, is_used: false })
    }
  }

  const { error } = await supabase.from('player_hands').insert(handRows)
  if (error) return { error: error.message }

  return { error: null }
}

async function createNextGame(
  tournamentId: string,
  roundNumber: number,
  isRematch: boolean,
  excludeTopicCardId?: string
) {
  const { data: usedTopics } = await supabase
    .from('games')
    .select('topic_card_id')
    .eq('tournament_id', tournamentId)

  const usedTopicIds = new Set(usedTopics?.map((g) => g.topic_card_id) ?? [])

  const { data: handCardIds } = await supabase
    .from('player_hands')
    .select('card_id')
    .eq('tournament_id', tournamentId)

  const handCardIdSet = new Set(handCardIds?.map((h) => h.card_id) ?? [])

  const { data: allCards } = await supabase
    .from('cards')
    .select('id, is_dirty')
    .eq('tournament_id', tournamentId)

  // 通常プール：手札・下ネタ・使用済みお題を除く
  const normalPool = (allCards ?? []).filter(
    (c) => !c.is_dirty && !handCardIdSet.has(c.id) && !usedTopicIds.has(c.id)
  )

  let topicCard
  if (normalPool.length > 0) {
    topicCard = normalPool[Math.floor(Math.random() * normalPool.length)]
  } else {
    // フォールバック：過去のお題から再利用（直前のお題のみ除外）
    const fallbackPool = (allCards ?? []).filter(
      (c) => !c.is_dirty && !handCardIdSet.has(c.id) && c.id !== excludeTopicCardId
    )
    if (fallbackPool.length === 0) {
      return { error: 'お題カードが不足しています' }
    }
    topicCard = fallbackPool[Math.floor(Math.random() * fallbackPool.length)]
  }

  const { error } = await supabase.from('games').insert({
    tournament_id: tournamentId,
    round_number: roundNumber,
    status: 'waiting_submission',
    topic_card_id: topicCard.id,
    is_rematch: isRematch,
  })

  if (error) return { error: error.message }

  return { error: null }
}
