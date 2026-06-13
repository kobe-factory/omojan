import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendLinePush, type LinePushPayload } from '@/lib/line-push'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

const PHASE_COLORS = {
  joining: '#0284c7',
  cards: '#d97706',
  playing: '#059669',
  voting: '#7c3aed',
  tiebreaker: '#dc2626',
  result: '#ca8a04',
  rematch: '#6b7280',
}

async function notifyParticipants(
  participantIds: string[],
  triggeringUserId: string | null,
  payload: LinePushPayload,
  mode: string,
) {
  if (!triggeringUserId || mode !== 'production') return

  const targetIds = participantIds.filter((id) => id !== triggeringUserId)
  if (targetIds.length === 0) return

  const { data: users } = await supabase
    .from('users')
    .select('line_user_id')
    .in('id', targetIds)
    .not('line_user_id', 'is', null)

  const lineUserIds = (users ?? [])
    .map((u) => u.line_user_id)
    .filter(Boolean) as string[]
  await sendLinePush(lineUserIds, payload)
}

const EXHIBITION_AI_CHARS = ['こんべ(AI)', 'スラパン(AI)', 'はじむ(AI)', 'カズさん(AI)', 'かっぴー(AI)']

function fireAiAction(origin: string, tournamentId: string, phase: string) {
  fetch(`${origin}/api/ai/player/act`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tournament_id: tournamentId, phase }),
  }).catch(() => {})
}

function fireExhibitionAiActions(origin: string, tournamentId: string, phase: string) {
  for (const charName of EXHIBITION_AI_CHARS) {
    fetch(`${origin}/api/ai/player/act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_id: tournamentId, phase, character_name: charName }),
    }).catch(() => {})
  }
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
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  let confirmResult = false
  let triggeringUserId: string | null = null
  try {
    const body = await request.json()
    confirmResult = !!body.confirm_result
    triggeringUserId = body.triggering_user_id ?? null
  } catch {
    /* body なし */
  }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select(
      'id, status, mode, game_count, cards_per_user, hand_cards_per_player, required_players, dirty_cards_per_user, skip_card_creation, random_voting, tiebreaker_mode, ai_player_character, tournament_type',
    )
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json(
      { error: '大会が見つかりません' },
      { status: 404 },
    )
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
      const { error: dealError } = await dealCards(
        tournament.id,
        participantIds,
        tournament.hand_cards_per_player,
        tournament.dirty_cards_per_user,
      )
      if (dealError)
        return NextResponse.json({ error: dealError }, { status: 500 })

      const { error: gameError } = await createNextGame(
        tournament.id,
        1,
        false,
        undefined,
        tournament.random_voting ? randomVotingMode() : null,
      )
      if (gameError)
        return NextResponse.json({ error: gameError }, { status: 500 })

      await supabase
        .from('tournaments')
        .update({ status: 'playing' })
        .eq('id', tournament.id)

      await notifyParticipants(
        participantIds,
        triggeringUserId,
        {
          headerTitle: '🎨 作品投稿の時間！',
          headerColor: PHASE_COLORS.playing,
          headerSub: `第${num}回大会 / 1回戦`,
          body: '全員の参加が揃いました！\nおもじゃんを開いて作品を投稿しましょう 🎨',
          url: LIFF_URL,
        },
        tournament.mode,
      )

      if (tournament.tournament_type === 'exhibition') {
        const origin = new URL(request.url).origin
        fireExhibitionAiActions(origin, tournament.id, 'submit')
      } else if (tournament.ai_player_character) {
        const origin = new URL(request.url).origin
        fireAiAction(origin, tournament.id, 'submit')
      }

      return NextResponse.json({ advanced: true, newStatus: 'playing' })
    }

    // 全員がすでに札を作成済みか確認
    const { data: cardRows } = await supabase
      .from('cards')
      .select('creator_user_id')
      .eq('tournament_id', tournament.id)

    const countByUser: Record<string, number> = {}
    for (const card of cardRows ?? []) {
      countByUser[card.creator_user_id] = (countByUser[card.creator_user_id] ?? 0) + 1
    }
    const allCardsDone = participantIds.every(
      (id) => (countByUser[id] ?? 0) >= tournament.cards_per_user,
    )

    if (allCardsDone) {
      const { error: dealError } = await dealCards(
        tournament.id,
        participantIds,
        tournament.hand_cards_per_player,
        tournament.dirty_cards_per_user,
      )
      if (dealError)
        return NextResponse.json({ error: dealError }, { status: 500 })

      const { error: gameError } = await createNextGame(
        tournament.id,
        1,
        false,
        undefined,
        tournament.random_voting ? randomVotingMode() : null,
      )
      if (gameError)
        return NextResponse.json({ error: gameError }, { status: 500 })

      await supabase
        .from('tournaments')
        .update({ status: 'playing' })
        .eq('id', tournament.id)

      await notifyParticipants(
        participantIds,
        triggeringUserId,
        {
          headerTitle: '🎨 作品投稿の時間！',
          headerColor: PHASE_COLORS.playing,
          headerSub: `第${num}回大会 / 1回戦`,
          body: '全員の参加と札作成が完了しました！\nおもじゃんを開いて作品を投稿しましょう 🎨',
          url: LIFF_URL,
        },
        tournament.mode,
      )

      if (tournament.tournament_type === 'exhibition') {
        const origin = new URL(request.url).origin
        fireExhibitionAiActions(origin, tournament.id, 'submit')
      } else if (tournament.ai_player_character) {
        const origin = new URL(request.url).origin
        fireAiAction(origin, tournament.id, 'submit')
      }

      return NextResponse.json({ advanced: true, newStatus: 'playing' })
    }

    await supabase
      .from('tournaments')
      .update({ status: 'creating_cards' })
      .eq('id', tournament.id)

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
      countByUser[card.creator_user_id] =
        (countByUser[card.creator_user_id] ?? 0) + 1
    }

    const allDone = participantIds.every(
      (id) => (countByUser[id] ?? 0) >= tournament.cards_per_user,
    )
    if (!allDone) {
      return NextResponse.json({
        waiting: true,
        message: '札作成待ち',
        countByUser,
      })
    }

    const { error: dealError } = await dealCards(
      tournament.id,
      participantIds,
      tournament.hand_cards_per_player,
      tournament.dirty_cards_per_user,
    )
    if (dealError)
      return NextResponse.json({ error: dealError }, { status: 500 })

    const { error: gameError } = await createNextGame(
      tournament.id, 1, false, undefined,
      tournament.random_voting ? randomVotingMode() : null,
    )
    if (gameError)
      return NextResponse.json({ error: gameError }, { status: 500 })

    await supabase
      .from('tournaments')
      .update({ status: 'playing' })
      .eq('id', tournament.id)

    const num = await getTournamentNumber(tournament.id)
    await notifyParticipants(
      participantIds,
      triggeringUserId,
      {
        headerTitle: '🎨 作品投稿の時間！',
        headerColor: PHASE_COLORS.playing,
        headerSub: `第${num}回大会 / 1回戦`,
        body: '全員の札作成が完了しました！\nおもじゃんを開いて作品を投稿しましょう 🎨',
        url: LIFF_URL,
      },
      tournament.mode,
    )

    if (tournament.ai_player_character) {
      const origin = new URL(request.url).origin
      fireAiAction(origin, tournament.id, 'submit')
    }

    return NextResponse.json({ advanced: true, newStatus: 'playing' })
  }

  // playing
  if (tournament.status === 'playing') {
    const { data: currentGame } = await supabase
      .from('games')
      .select('id, round_number, status, topic_card_id, is_rematch, voting_mode, button_mash_type, mash_current_round')
      .eq('tournament_id', tournament.id)
      .order('round_number', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!currentGame) {
      return NextResponse.json(
        { error: 'ゲームが見つかりません' },
        { status: 500 },
      )
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

      // ソロモード：waiting_vote をスキップして直接次フェーズへ
      if (tournament.mode === 'solo') {
        let soloStatus: 'showing_result' | 'waiting_tiebreaker_vote' | 'waiting_button_mash' | 'showing_rematch'
        if (currentGame.is_rematch || currentGame.round_number % 3 === 1) {
          soloStatus = 'showing_result'
        } else if (currentGame.round_number % 3 === 2) {
          soloStatus = tournament.tiebreaker_mode === 'button_mash'
            ? 'waiting_button_mash'
            : 'waiting_tiebreaker_vote'
        } else {
          soloStatus = 'showing_rematch'
        }
        const { error: soloErr } = await supabase.from('games').update({ status: soloStatus }).eq('id', currentGame.id)
        if (soloErr) return NextResponse.json({ error: soloErr.message }, { status: 500 })
        return NextResponse.json({ advanced: true, newGameStatus: soloStatus })
      }

      const { error: toVoteError } = await supabase
        .from('games')
        .update({ status: 'waiting_vote' })
        .eq('id', currentGame.id)
      if (toVoteError) return NextResponse.json({ error: toVoteError.message }, { status: 500 })

      const num = await getTournamentNumber(tournament.id)
      await notifyParticipants(
        participantIds,
        triggeringUserId,
        {
          headerTitle: '🗳️ 投票が始まりました！',
          headerColor: PHASE_COLORS.voting,
          headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
          body: '全員の作品投稿が完了しました！\nおもじゃんを開いて投票しましょう 🗳️',
          url: LIFF_URL,
        },
        tournament.mode,
      )

      if (tournament.tournament_type === 'exhibition') {
        const origin = new URL(request.url).origin
        fireExhibitionAiActions(origin, tournament.id, 'vote')
      } else if (tournament.ai_player_character) {
        const origin = new URL(request.url).origin
        fireAiAction(origin, tournament.id, 'vote')
      }

      return NextResponse.json({
        advanced: true,
        newGameStatus: 'waiting_vote',
      })
    }

    // waiting_vote → tiebreaker or rematch or showing_result
    if (currentGame.status === 'waiting_vote') {
      // ソロモード：ラウンド数に応じてフローを切り替えてテスト（投票チェック不要）
      // 再戦ゲーム or 1,4,7...回戦 → 通常結果
      // 2,5,8...回戦 → 決選投票 or 連打ゲーム（tiebreaker_modeに依存）
      // 3,6,9...回戦 → 流局
      if (tournament.mode === 'solo') {
        let soloStatus: 'showing_result' | 'waiting_tiebreaker_vote' | 'waiting_button_mash' | 'showing_rematch'
        if (currentGame.is_rematch || currentGame.round_number % 3 === 1) {
          soloStatus = 'showing_result'
        } else if (currentGame.round_number % 3 === 2) {
          soloStatus = tournament.tiebreaker_mode === 'button_mash'
            ? 'waiting_button_mash'
            : 'waiting_tiebreaker_vote'
        } else {
          soloStatus = 'showing_rematch'
        }
        const { error: soloUpdateError } = await supabase
          .from('games')
          .update({ status: soloStatus })
          .eq('id', currentGame.id)
        if (soloUpdateError) return NextResponse.json({ error: soloUpdateError.message }, { status: 500 })
        return NextResponse.json({ advanced: true, newGameStatus: soloStatus })
      }

      // 本番モード：全員の投票完了を確認してから集計
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

      const maxVotes =
        Object.values(voteCount).length > 0
          ? Math.max(...Object.values(voteCount))
          : 0
      const tiedAtTopIds = Object.entries(voteCount)
        .filter(([, c]) => c === maxVotes)
        .map(([id]) => id)

      const num = await getTournamentNumber(tournament.id)

      if (tiedAtTopIds.length >= 3) {
        // 3作品以上同票 → 再戦
        const { error: toRematchError } = await supabase
          .from('games')
          .update({ status: 'showing_rematch' })
          .eq('id', currentGame.id)
        if (toRematchError) return NextResponse.json({ error: toRematchError.message }, { status: 500 })

        await notifyParticipants(
          participantIds,
          triggeringUserId,
          {
            headerTitle: '🔄 流局となりました',
            headerColor: PHASE_COLORS.rematch,
            headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
            body: '全員同票のためこの回はお流れです。\nおもじゃんを開いて確認してください 🔄',
            url: LIFF_URL,
          },
          tournament.mode,
        )

        return NextResponse.json({
          advanced: true,
          newGameStatus: 'showing_rematch',
        })
      }

      if (tiedAtTopIds.length === 2) {
        if (tournament.tiebreaker_mode === 'button_mash') {
          // 2作品同票 → 連打ゲーム（ランダムでモードを決定）
          const mashType = Math.random() < 0.5 ? 'timed_3s' : 'speed_20tap'
          const { error: toBMError } = await supabase
            .from('games')
            .update({ status: 'waiting_button_mash', button_mash_type: mashType })
            .eq('id', currentGame.id)
          if (toBMError) return NextResponse.json({ error: toBMError.message }, { status: 500 })

          await notifyParticipants(
            participantIds,
            triggeringUserId,
            {
              headerTitle: '⚔️ 連打決戦です！',
              headerColor: PHASE_COLORS.tiebreaker,
              headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
              body: '同票のため連打ゲームで決戦です！\nおもじゃんを開いてボタンを連打しましょう ⚔️',
              url: LIFF_URL,
            },
            tournament.mode,
          )

          if (tournament.tournament_type === 'exhibition') {
            const origin = new URL(request.url).origin
            fireExhibitionAiActions(origin, tournament.id, 'button_mash')
          } else if (tournament.ai_player_character) {
            const origin = new URL(request.url).origin
            fireAiAction(origin, tournament.id, 'button_mash')
          }

          return NextResponse.json({
            advanced: true,
            newGameStatus: 'waiting_button_mash',
          })
        }

        // 2作品同票 → 決選投票
        const { error: toTiebreakerError } = await supabase
          .from('games')
          .update({ status: 'waiting_tiebreaker_vote' })
          .eq('id', currentGame.id)
        if (toTiebreakerError) return NextResponse.json({ error: toTiebreakerError.message }, { status: 500 })

        await notifyParticipants(
          participantIds,
          triggeringUserId,
          {
            headerTitle: '⚔️ 決選投票です！',
            headerColor: PHASE_COLORS.tiebreaker,
            headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
            body: '同票のため決選投票が行われます！\nおもじゃんを開いて投票しましょう ⚔️',
            url: LIFF_URL,
          },
          tournament.mode,
        )

        if (tournament.tournament_type === 'exhibition') {
          const origin = new URL(request.url).origin
          fireExhibitionAiActions(origin, tournament.id, 'tiebreaker_vote')
        } else if (tournament.ai_player_character) {
          const origin = new URL(request.url).origin
          fireAiAction(origin, tournament.id, 'tiebreaker_vote')
        }

        return NextResponse.json({
          advanced: true,
          newGameStatus: 'waiting_tiebreaker_vote',
        })
      }

      // 明確な勝者
      const { error: toResultError } = await supabase
        .from('games')
        .update({ status: 'showing_result' })
        .eq('id', currentGame.id)
      if (toResultError) return NextResponse.json({ error: toResultError.message }, { status: 500 })

      await notifyParticipants(
        participantIds,
        triggeringUserId,
        {
          headerTitle: '🏆 結果発表！',
          headerColor: PHASE_COLORS.result,
          headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
          body: '全員の投票が完了しました！\nおもじゃんを開いて結果を確認しましょう 🏆',
          url: LIFF_URL,
        },
        tournament.mode,
      )

      return NextResponse.json({
        advanced: true,
        newGameStatus: 'showing_result',
      })
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

      const { error: tbToResultError } = await supabase
        .from('games')
        .update({ status: 'showing_result' })
        .eq('id', currentGame.id)
      if (tbToResultError) return NextResponse.json({ error: tbToResultError.message }, { status: 500 })

      const num = await getTournamentNumber(tournament.id)
      await notifyParticipants(
        participantIds,
        triggeringUserId,
        {
          headerTitle: '🏆 結果発表！',
          headerColor: PHASE_COLORS.result,
          headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
          body: '決選投票が完了しました！\nおもじゃんを開いて結果を確認しましょう 🏆',
          url: LIFF_URL,
        },
        tournament.mode,
      )

      return NextResponse.json({
        advanced: true,
        newGameStatus: 'showing_result',
      })
    }

    // waiting_button_mash → 両者完了で showing_result（同点なら mash_round をインクリメント）
    if (currentGame.status === 'waiting_button_mash') {
      // 初回投票で同票の2作品のauthorを特定
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

      if (tiedSubIds.length === 0) {
        // 投票なし（ソロモード等）→ 即 showing_result
        await supabase.from('games').update({ status: 'showing_result' }).eq('id', currentGame.id)
        return NextResponse.json({ advanced: true, newGameStatus: 'showing_result' })
      }

      const { data: tiedSubs } = await supabase
        .from('submissions')
        .select('user_id')
        .in('id', tiedSubIds)
      const tiebreakerUserIds = (tiedSubs ?? []).map((s) => s.user_id)

      // 現在のラウンドは games.mash_current_round を優先使用
      const { data: existingResults } = await supabase
        .from('button_mash_results')
        .select('user_id, tap_count, mash_round, completion_time_ms')
        .eq('game_id', currentGame.id)
        .order('mash_round', { ascending: false })

      const currentMashRound = (currentGame as { mash_current_round?: number }).mash_current_round ?? 1

      // 現在のラウンドで両者が完了しているか確認
      const currentRoundResults = (existingResults ?? []).filter(
        (r) => r.mash_round === currentMashRound,
      )
      const completedUserIds = new Set(currentRoundResults.map((r) => r.user_id))
      const allCompleted = tiebreakerUserIds.every((id) => completedUserIds.has(id))

      if (!allCompleted) {
        const waiting = tiebreakerUserIds.filter((id) => !completedUserIds.has(id))
        return NextResponse.json({ waiting: true, waitingUserIds: waiting })
      }

      // 両者完了 → 勝敗判定（speed mode か timed mode か）
      const isSpeedMode =
        (currentGame as { button_mash_type?: string | null }).button_mash_type === 'speed_20tap' ||
        (currentGame as { button_mash_type?: string | null }).button_mash_type === 'speed_30tap'
      let isTie = false

      if (isSpeedMode) {
        const minTime = Math.min(
          ...currentRoundResults.map((r) => (r as { completion_time_ms?: number | null }).completion_time_ms ?? Infinity),
        )
        const topPlayers = currentRoundResults.filter(
          (r) => (r as { completion_time_ms?: number | null }).completion_time_ms === minTime,
        )
        isTie = topPlayers.length >= 2
      } else {
        const countMap: Record<string, number> = {}
        for (const r of currentRoundResults) {
          countMap[r.user_id] = r.tap_count
        }
        const counts = Object.values(countMap)
        isTie = counts.length >= 2 && counts[0] === counts[1]
      }

      if (isTie) {
        // 同点 → モードを交互に切り替えて mash_current_round をインクリメント
        const currentType =
          (currentGame as { button_mash_type?: string | null }).button_mash_type ?? 'timed_3s'
        const nextType = currentType === 'timed_3s' ? 'speed_20tap' : 'timed_3s'
        await supabase
          .from('games')
          .update({ button_mash_type: nextType, mash_current_round: currentMashRound + 1 })
          .eq('id', currentGame.id)
        return NextResponse.json({ waiting: true, isTie: true, nextMashRound: currentMashRound + 1 })
      }

      // 決着 → showing_result へ
      const { error: toResultError } = await supabase
        .from('games')
        .update({ status: 'showing_result' })
        .eq('id', currentGame.id)
      if (toResultError) return NextResponse.json({ error: toResultError.message }, { status: 500 })

      const num = await getTournamentNumber(tournament.id)
      await notifyParticipants(
        participantIds,
        triggeringUserId,
        {
          headerTitle: '🏆 結果発表！',
          headerColor: PHASE_COLORS.result,
          headerSub: `第${num}回大会 / ${currentGame.round_number}回戦`,
          body: '連打決戦が完了しました！\nおもじゃんを開いて結果を確認しましょう 🏆',
          url: LIFF_URL,
        },
        tournament.mode,
      )

      return NextResponse.json({ advanced: true, newGameStatus: 'showing_result' })
    }

    // showing_result or showing_rematch → confirm_result で次へ
    if (
      currentGame.status === 'showing_result' ||
      currentGame.status === 'showing_rematch'
    ) {
      if (!confirmResult) {
        return NextResponse.json({ noChange: true })
      }

      if (currentGame.status === 'showing_rematch') {
        // 手札を戻す（再戦で使い直せるように）
        const { data: subs } = await supabase
          .from('submissions')
          .select('hand_card_id')
          .eq('game_id', currentGame.id)

        const handCardIds = (subs ?? [])
          .map((s) => s.hand_card_id)
          .filter(Boolean)
        if (handCardIds.length > 0) {
          await supabase
            .from('player_hands')
            .update({ is_used: false })
            .in('card_id', handCardIds)
            .eq('tournament_id', tournament.id)
        }

        // 流局ゲームを finished に更新
        await supabase
          .from('games')
          .update({ status: 'finished' })
          .eq('id', currentGame.id)

        // 同ラウンドで再戦ゲームを作成（is_rematch=true、voting_modeは毎回ランダム選択）
        const { error: gameError } = await createNextGame(
          tournament.id,
          currentGame.round_number,
          true,
          currentGame.topic_card_id,
          tournament.random_voting ? randomVotingMode() : null,
        )
        if (gameError)
          return NextResponse.json({ error: gameError }, { status: 500 })

        if (tournament.ai_player_character) {
          const origin = new URL(request.url).origin
          fireAiAction(origin, tournament.id, 'submit')
        }

        return NextResponse.json({
          advanced: true,
          newGameStatus: 'waiting_submission',
          round: currentGame.round_number,
        })
      }

      // 通常の showing_result 処理
      await supabase
        .from('games')
        .update({ status: 'finished' })
        .eq('id', currentGame.id)

      if (currentGame.round_number >= tournament.game_count) {
        // 同点チェック：1位タイなら大会決戦へ
        const scoreMap = await computeTournamentStandings(tournament.id, participantIds)
        const sortedStandings = participantIds
          .map((id) => ({ id, wins: scoreMap[id]?.wins ?? 0, totalVotes: scoreMap[id]?.totalVotes ?? 0 }))
          .sort((a, b) => b.wins - a.wins || b.totalVotes - a.totalVotes)

        const top = sortedStandings[0]
        const tiedTop = sortedStandings.filter((s) => s.wins === top.wins && s.totalVotes === top.totalVotes)

        if (tiedTop.length >= 2) {
          const tiedUserIds = tiedTop.map((s) => s.id)
          const { data: anyCard } = await supabase
            .from('cards')
            .select('id')
            .eq('tournament_id', tournament.id)
            .limit(1)
            .single()

          if (anyCard) {
            const finalMashType = Math.random() < 0.5 ? 'timed_5s' : 'speed_30tap'
            await supabaseAdmin.from('games').insert({
              tournament_id: tournament.id,
              round_number: 0,
              status: 'waiting_button_mash',
              topic_card_id: anyCard.id,
              is_rematch: false,
              voting_mode: `final_tiebreaker:${tiedUserIds.join(',')}`,
              button_mash_type: finalMashType,
              mash_current_round: 1,
            })

            await supabase.from('tournaments').update({ status: 'final_tiebreaker' }).eq('id', tournament.id)

            const finalNum = await getTournamentNumber(tournament.id)
            await notifyParticipants(
              participantIds,
              triggeringUserId,
              {
                headerTitle: '⚔️ 大会決戦！',
                headerColor: PHASE_COLORS.tiebreaker,
                headerSub: `第${finalNum}回大会`,
                body: `同点のため大会決戦を行います！\n${tiedUserIds.length}名で5秒間の連打決戦です ⚔️\nおもじゃんを開いてください`,
                url: LIFF_URL,
              },
              tournament.mode,
            )

            return NextResponse.json({ advanced: true, newStatus: 'final_tiebreaker' })
          }
        }

        await supabase
          .from('tournaments')
          .update({ status: 'finished' })
          .eq('id', tournament.id)
        // 大会終了時にコメント自動生成（fire-and-forget）
        const origin = new URL(request.url).origin
        fetch(`${origin}/api/ai/generate-comments`, { method: 'POST' }).catch(() => {})
        return NextResponse.json({ advanced: true, newStatus: 'finished' })
      }

      const { error: gameError } = await createNextGame(
        tournament.id,
        currentGame.round_number + 1,
        false,
        undefined,
        tournament.random_voting ? randomVotingMode() : null,
      )
      if (gameError)
        return NextResponse.json({ error: gameError }, { status: 500 })

      if (tournament.tournament_type === 'exhibition') {
        const origin = new URL(request.url).origin
        fireExhibitionAiActions(origin, tournament.id, 'submit')
      } else if (tournament.ai_player_character) {
        const origin = new URL(request.url).origin
        fireAiAction(origin, tournament.id, 'submit')
      }

      return NextResponse.json({
        advanced: true,
        newGameStatus: 'waiting_submission',
        round: currentGame.round_number + 1,
      })
    }
  }

  // final_tiebreaker: round_number=0 の連打ゲーム完了 → finished へ
  if (tournament.status === 'final_tiebreaker') {
    const { data: finalGame } = await supabase
      .from('games')
      .select('id, status, voting_mode, button_mash_type, mash_current_round')
      .eq('tournament_id', tournament.id)
      .eq('round_number', 0)
      .single()

    if (!finalGame || finalGame.status === 'finished') {
      return NextResponse.json({ noChange: true })
    }

    const tiedUserIds = (finalGame.voting_mode ?? '')
      .replace('final_tiebreaker:', '')
      .split(',')
      .filter(Boolean)

    const { data: existingResults } = await supabase
      .from('button_mash_results')
      .select('user_id, tap_count, mash_round, completion_time_ms')
      .eq('game_id', finalGame.id)
      .order('mash_round', { ascending: false })

    const currentMashRound =
      (finalGame as { mash_current_round?: number }).mash_current_round ?? 1

    const currentRoundResults = (existingResults ?? []).filter(
      (r) => r.mash_round === currentMashRound,
    )
    const completedUserIds = new Set(currentRoundResults.map((r) => r.user_id))
    const allCompleted = tiedUserIds.every((id) => completedUserIds.has(id))

    if (!allCompleted) {
      const waiting = tiedUserIds.filter((id) => !completedUserIds.has(id))
      return NextResponse.json({ waiting: true, waitingUserIds: waiting })
    }

    // 勝敗判定（speed mode か timed mode か）
    const isFinalSpeedMode =
      (finalGame as { button_mash_type?: string | null }).button_mash_type === 'speed_20tap' ||
      (finalGame as { button_mash_type?: string | null }).button_mash_type === 'speed_30tap'
    let isFinalTie = false
    let finalTopPlayers = currentRoundResults

    if (isFinalSpeedMode) {
      const minTime = Math.min(
        ...currentRoundResults.map((r) => (r as { completion_time_ms?: number | null }).completion_time_ms ?? Infinity),
      )
      finalTopPlayers = currentRoundResults.filter(
        (r) => (r as { completion_time_ms?: number | null }).completion_time_ms === minTime,
      )
      isFinalTie = finalTopPlayers.length >= 2
    } else {
      const maxTaps = Math.max(...currentRoundResults.map((r) => r.tap_count))
      finalTopPlayers = currentRoundResults.filter((r) => r.tap_count === maxTaps)
      isFinalTie = finalTopPlayers.length >= 2
    }

    if (isFinalTie) {
      // 同点 → モードを交互に切り替えて mash_current_round をインクリメント
      const currentFinalType =
        (finalGame as { button_mash_type?: string | null }).button_mash_type ?? 'timed_5s'
      const nextFinalType = currentFinalType === 'timed_5s' || currentFinalType === 'timed_3s'
        ? 'speed_30tap'
        : 'timed_5s'
      await supabaseAdmin
        .from('games')
        .update({ button_mash_type: nextFinalType, mash_current_round: currentMashRound + 1 })
        .eq('id', finalGame.id)
      return NextResponse.json({ waiting: true, isTie: true, nextMashRound: currentMashRound + 1 })
    }

    await supabaseAdmin.from('games').update({ status: 'finished' }).eq('id', finalGame.id)
    await supabase.from('tournaments').update({ status: 'finished' }).eq('id', tournament.id)
    // 大会終了時にコメント自動生成（fire-and-forget）
    const originFinal = new URL(request.url).origin
    fetch(`${originFinal}/api/ai/generate-comments`, { method: 'POST' }).catch(() => {})

    const num = await getTournamentNumber(tournament.id)
    await notifyParticipants(
      participantIds,
      triggeringUserId,
      {
        headerTitle: '🏆 大会優勝決定！',
        headerColor: PHASE_COLORS.result,
        headerSub: `第${num}回大会`,
        body: '大会決戦が完了しました！\nおもじゃんを開いて優勝者を確認しましょう 🏆',
        url: LIFF_URL,
      },
      tournament.mode,
    )

    return NextResponse.json({ advanced: true, newStatus: 'finished' })
  }

  return NextResponse.json({ noChange: true })
}

async function computeTournamentStandings(
  tournamentId: string,
  participantIds: string[],
): Promise<Record<string, { wins: number; totalVotes: number }>> {
  const scoreMap: Record<string, { wins: number; totalVotes: number }> = {}
  for (const id of participantIds) scoreMap[id] = { wins: 0, totalVotes: 0 }

  const { data: games } = await supabase
    .from('games')
    .select('id, round_number, status, is_rematch, button_mash_type')
    .eq('tournament_id', tournamentId)
    .gt('round_number', 0)

  if (!games || games.length === 0) return scoreMap

  const gameIds = games.map((g) => g.id)

  const [{ data: allVotes }, { data: allSubs }, { data: allMashResults }] = await Promise.all([
    supabase.from('votes').select('game_id, submission_id, is_tiebreaker').in('game_id', gameIds),
    supabase.from('submissions').select('id, game_id, user_id').in('game_id', gameIds),
    supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round, completion_time_ms').in('game_id', gameIds),
  ])

  const regularVoteCount: Record<string, number> = {}
  const tiebreakerVoteCount: Record<string, number> = {}
  for (const v of allVotes ?? []) {
    if (v.is_tiebreaker) {
      tiebreakerVoteCount[v.submission_id] = (tiebreakerVoteCount[v.submission_id] ?? 0) + 1
    } else {
      regularVoteCount[v.submission_id] = (regularVoteCount[v.submission_id] ?? 0) + 1
    }
  }

  const mashWinnerByGame: Record<string, string> = {}
  for (const game of games) {
    const results = (allMashResults ?? []).filter((r) => r.game_id === game.id)
    if (results.length < 2) continue
    const latestRound = Math.max(...results.map((r) => r.mash_round))
    const latest = results.filter((r) => r.mash_round === latestRound)
    const isSpeedMode =
      (game as { button_mash_type?: string | null }).button_mash_type === 'speed_20tap' ||
      (game as { button_mash_type?: string | null }).button_mash_type === 'speed_30tap'
    if (isSpeedMode) {
      const minTime = Math.min(
        ...latest.map((r) => (r as { completion_time_ms?: number | null }).completion_time_ms ?? Infinity),
      )
      const topWinners = latest.filter(
        (r) => (r as { completion_time_ms?: number | null }).completion_time_ms === minTime,
      )
      if (topWinners.length === 1) mashWinnerByGame[game.id] = topWinners[0].user_id
    } else {
      const maxTaps = Math.max(...latest.map((r) => r.tap_count))
      const topWinners = latest.filter((r) => r.tap_count === maxTaps)
      if (topWinners.length === 1) mashWinnerByGame[game.id] = topWinners[0].user_id
    }
  }

  const rematchRounds = new Set(games.filter((g) => g.is_rematch).map((g) => g.round_number))

  for (const game of games) {
    const isVoided =
      game.status === 'showing_rematch' ||
      (!game.is_rematch && rematchRounds.has(game.round_number))
    if (isVoided) continue

    const gameSubs = (allSubs ?? []).filter((s) => s.game_id === game.id)

    for (const sub of gameSubs) {
      const count = regularVoteCount[sub.id] ?? 0
      if (scoreMap[sub.user_id]) scoreMap[sub.user_id].totalVotes += count
    }

    if (mashWinnerByGame[game.id]) {
      const wId = mashWinnerByGame[game.id]
      if (scoreMap[wId]) scoreMap[wId].wins += 1
      continue
    }

    let maxTbVotes = 0
    let tbWinnerId: string | null = null
    for (const sub of gameSubs) {
      const tbCount = tiebreakerVoteCount[sub.id] ?? 0
      if (tbCount > maxTbVotes) {
        maxTbVotes = tbCount
        tbWinnerId = sub.user_id
      }
    }
    if (tbWinnerId) {
      if (scoreMap[tbWinnerId]) {
        scoreMap[tbWinnerId].wins += 1
        scoreMap[tbWinnerId].totalVotes += 1
      }
      continue
    }

    let maxVotes = 0
    for (const sub of gameSubs) {
      const count = regularVoteCount[sub.id] ?? 0
      if (count > maxVotes) maxVotes = count
    }
    if (maxVotes > 0) {
      const winners = gameSubs.filter((s) => (regularVoteCount[s.id] ?? 0) === maxVotes)
      for (const w of winners) {
        if (scoreMap[w.user_id]) scoreMap[w.user_id].wins += 1
      }
    }
  }

  return scoreMap
}

async function dealCards(
  tournamentId: string,
  participantIds: string[],
  handCardsPerPlayer: number,
  dirtyCardsPerUser: number,
) {
  // 冪等性チェック：既に配布済みの場合はスキップ
  const { count: existingCount } = await supabaseAdmin
    .from('player_hands')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)

  if (existingCount !== null && existingCount > 0) {
    return { error: null }
  }

  const { data: allCards } = await supabaseAdmin
    .from('cards')
    .select('id, is_dirty')
    .eq('tournament_id', tournamentId)

  if (!allCards) return { error: 'カードが見つかりません' }

  const dirtyPool = [...allCards.filter((c) => c.is_dirty)].sort(() => Math.random() - 0.5)
  const regularPool = [...allCards.filter((c) => !c.is_dirty)].sort(() => Math.random() - 0.5)

  const handRows = []

  for (let i = 0; i < participantIds.length; i++) {
    // dirty カードを最大 dirtyCardsPerUser 枚配布（不足分は regular で補填）
    const playerDirty = dirtyPool.splice(0, Math.min(dirtyCardsPerUser, dirtyPool.length))
    const regularNeeded = handCardsPerPlayer - playerDirty.length
    const playerRegular = regularPool.splice(0, Math.min(regularNeeded, regularPool.length))

    for (const card of [...playerDirty, ...playerRegular]) {
      handRows.push({
        tournament_id: tournamentId,
        user_id: participantIds[i],
        card_id: card.id,
        is_used: false,
      })
    }
  }

  const { error } = await supabaseAdmin.from('player_hands').insert(handRows)
  if (error) return { error: error.message }

  return { error: null }
}

function randomVotingMode(): 'normal' | 'secret' | 'impersonation' {
  const modes = ['normal', 'secret', 'impersonation'] as const
  return modes[Math.floor(Math.random() * modes.length)]
}

async function createNextGame(
  tournamentId: string,
  roundNumber: number,
  isRematch: boolean,
  excludeTopicCardId?: string,
  votingMode?: string | null,
) {
  const { data: usedTopics } = await supabaseAdmin
    .from('games')
    .select('topic_card_id')
    .eq('tournament_id', tournamentId)

  const usedTopicIds = new Set(usedTopics?.map((g) => g.topic_card_id) ?? [])

  const { data: handCardIds } = await supabaseAdmin
    .from('player_hands')
    .select('card_id')
    .eq('tournament_id', tournamentId)

  const handCardIdSet = new Set(handCardIds?.map((h) => h.card_id) ?? [])

  const { data: allCards } = await supabaseAdmin
    .from('cards')
    .select('id, is_dirty')
    .eq('tournament_id', tournamentId)

  // 通常プール：手札・下ネタ・使用済みお題を除く
  const normalPool = (allCards ?? []).filter(
    (c) => !c.is_dirty && !handCardIdSet.has(c.id) && !usedTopicIds.has(c.id),
  )

  let topicCard
  if (normalPool.length > 0) {
    topicCard = normalPool[Math.floor(Math.random() * normalPool.length)]
  } else {
    // フォールバック：過去のお題から再利用（直前のお題のみ除外）
    const fallbackPool = (allCards ?? []).filter(
      (c) =>
        !c.is_dirty && !handCardIdSet.has(c.id) && c.id !== excludeTopicCardId,
    )
    if (fallbackPool.length === 0) {
      return { error: 'お題カードが不足しています' }
    }
    topicCard = fallbackPool[Math.floor(Math.random() * fallbackPool.length)]
  }

  const { error } = await supabaseAdmin.from('games').insert({
    tournament_id: tournamentId,
    round_number: roundNumber,
    status: 'waiting_submission',
    topic_card_id: topicCard.id,
    is_rematch: isRematch,
    voting_mode: votingMode ?? null,
  })

  if (error) return { error: error.message }

  return { error: null }
}
