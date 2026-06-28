import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { AI_MODEL_COMMENTS } from '@/lib/ai-config'

interface CompactStats {
  gamesParticipated: number
  mvpCount: number
  mvpWinRate: number
  avgVotesPerGame: number
  homeRuns: number
  singles: number
  doubles: number
  triples: number
  shutoutCount: number
  shutoutRate: number
  preambleCount: number
  preambleUsageRate: number
  loneVoteCount: number
  cardUsageRate: number
  buttonMashWins: number
  buttonMashGames: number
  buttonMashWinRate: number
}

interface UserCommentInput {
  userId: string
  userName: string
  overall: CompactStats
  last: CompactStats | null
  lastTournamentNumber: number | null
  cardTexts: string[]
  usedCardTexts: string[]
  lastUsedCardTexts: string[]
  workTexts: string[]
  lastWorkTexts: string[]
  preambleTexts: string[]
  lastPreambleTexts: string[]
  votedWorkTexts: string[]       // 全大会でこのユーザーが票を入れた作品テキスト
  lastVotedWorkTexts: string[]   // 前回大会のみ
  votedForUsers: { userName: string; count: number }[]  // 誰の作品に多く票を入れたか
}

interface TournamentStanding {
  userName: string
  rank: number
  wins: number
  totalVotes: number
  mvpCount: number
}

// GET: 保存済みコメントを返す
export async function GET() {
  const { data } = await supabase.from('user_ai_comments').select('*')
  return NextResponse.json({ comments: data ?? [] })
}

// POST: 未生成 or 新大会追加時のみ生成（force=trueで強制再生成）
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === 'true'

  const { data: finishedTournaments } = await supabase
    .from('tournaments')
    .select('id, created_at')
    .eq('mode', 'production')
    .eq('status', 'finished')
    .order('created_at', { ascending: true })

  const tournamentCount = finishedTournaments?.length ?? 0
  if (tournamentCount === 0) {
    return NextResponse.json({ message: '終了済み大会なし', generated: false })
  }

  // 最新コメントが現在の大会数と一致していればスキップ（強制時は除く）
  if (!force) {
    const { data: existingAny } = await supabase
      .from('user_ai_comments')
      .select('tournament_count')
      .limit(1)
      .maybeSingle()

    if (existingAny && existingAny.tournament_count === tournamentCount) {
      return NextResponse.json({ message: '最新コメント済み', generated: false, upToDate: true })
    }
  }

  const PRODUCTION_USER_NAMES = ['はじむ', 'スラパン', 'こんべ', 'かっぴー', 'カズさん']
  const { data: allUsers } = await supabase.from('users').select('id, name')
  const users = (allUsers ?? []).filter((u) => PRODUCTION_USER_NAMES.includes(u.name))
  if (!users || users.length === 0) {
    return NextResponse.json({ error: 'ユーザーなし' }, { status: 500 })
  }

  const allTournamentIds = (finishedTournaments ?? []).map((t) => t.id)
  const lastTournamentId = allTournamentIds[allTournamentIds.length - 1]
  const lastTournamentNumber = tournamentCount

  // 大会ごとの有効ゲームID（流局除外）
  const validGameIds = await computeValidGameIds(allTournamentIds)
  const lastTournamentValidGameIds = await computeValidGameIds([lastTournamentId])

  // 集計データ取得
  const { data: allCards } = await supabase
    .from('cards')
    .select('id, creator_user_id, tournament_id, text')
    .in('tournament_id', allTournamentIds)

  const gameIdsAll = [...validGameIds]
  const gameIdsLast = [...lastTournamentValidGameIds]
  const allGameIds = [...new Set([...gameIdsAll, ...gameIdsLast])]

  if (allGameIds.length === 0) {
    return NextResponse.json({ error: 'ゲームデータなし' }, { status: 500 })
  }

  const [
    { data: allSubs },
    { data: allVotes },
    { data: allMashResults },
    { data: allGames },
  ] = await Promise.all([
    supabase.from('submissions').select('id, user_id, hand_card_id, game_id, preamble, position').in('game_id', allGameIds),
    supabase.from('votes').select('voter_user_id, submission_id, game_id, is_tiebreaker').in('game_id', allGameIds),
    supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round, completion_time_ms').in('game_id', allGameIds),
    supabase.from('games').select('id, topic_card_id').in('id', allGameIds),
  ])

  const submissions = allSubs ?? []
  const votes = allVotes ?? []
  const mashResults = allMashResults ?? []
  const cards = allCards ?? []
  const cardTextMap = Object.fromEntries(cards.map((c) => [c.id, c.text]))
  const topicCardMap = Object.fromEntries((allGames ?? []).map((g) => [g.id, g.topic_card_id]))

  // 作品テキスト生成（お題＋手札の組み合わせ）
  function buildWorkText(sub: { hand_card_id: string; game_id: string; position: string }): string {
    const handText = cardTextMap[sub.hand_card_id] ?? ''
    const topicId = topicCardMap[sub.game_id] ?? ''
    const topicText = cardTextMap[topicId] ?? ''
    return sub.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`
  }

  // 全大会で使われた手札カードIDのセット
  const usedHandCardIds = new Set(submissions.map((s) => s.hand_card_id))
  // 最新大会のみで使われた手札カードIDのセット
  const lastTournamentSubs = submissions.filter((s) => lastTournamentValidGameIds.has(s.game_id))
  const lastTournamentUsedHandCardIds = new Set(lastTournamentSubs.map((s) => s.hand_card_id))

  const userInputs: UserCommentInput[] = users.map((user) => {
    const overall = computeStats(user.id, cards, submissions, votes, mashResults, validGameIds)
    const last = gameIdsLast.length > 0
      ? computeStats(user.id, cards, submissions, votes, mashResults, lastTournamentValidGameIds)
      : null
    const myCards = cards.filter((c) => c.creator_user_id === user.id)
    const cardTexts = myCards.map((c) => c.text)
    const usedCardTexts = myCards.filter((c) => usedHandCardIds.has(c.id)).map((c) => c.text)
    const lastUsedCardTexts = myCards.filter((c) => lastTournamentUsedHandCardIds.has(c.id)).map((c) => c.text)
    const workTexts = submissions
      .filter((s) => s.user_id === user.id && validGameIds.has(s.game_id))
      .map((s) => buildWorkText(s))
      .filter(Boolean)
    const lastWorkTexts = submissions
      .filter((s) => s.user_id === user.id && lastTournamentValidGameIds.has(s.game_id))
      .map((s) => buildWorkText(s))
      .filter(Boolean)
    const preambleTexts = submissions
      .filter((s) => s.user_id === user.id && validGameIds.has(s.game_id) && s.preamble && (s.preamble as string).trim().length > 0)
      .map((s) => (s.preamble as string).trim())
    const lastPreambleTexts = submissions
      .filter((s) => s.user_id === user.id && lastTournamentValidGameIds.has(s.game_id) && s.preamble && (s.preamble as string).trim().length > 0)
      .map((s) => (s.preamble as string).trim())

    // 投票した作品テキスト（全大会）
    const myVotes = votes.filter(
      (v) => !v.is_tiebreaker && v.voter_user_id === user.id && validGameIds.has(v.game_id),
    )
    const votedWorkTexts = myVotes.map((v) => {
      const sub = submissions.find((s) => s.id === v.submission_id)
      if (!sub) return null
      return buildWorkText(sub)
    }).filter(Boolean) as string[]

    // 投票した作品テキスト（前回大会のみ）
    const myLastVotes = votes.filter(
      (v) => !v.is_tiebreaker && v.voter_user_id === user.id && lastTournamentValidGameIds.has(v.game_id),
    )
    const lastVotedWorkTexts = myLastVotes.map((v) => {
      const sub = submissions.find((s) => s.id === v.submission_id)
      if (!sub) return null
      return buildWorkText(sub)
    }).filter(Boolean) as string[]

    // 誰の作品に多く票を入れたか
    const votedForCount: Record<string, number> = {}
    for (const v of myVotes) {
      const sub = submissions.find((s) => s.id === v.submission_id)
      if (!sub) continue
      const author = users.find((u) => u.id === sub.user_id)
      if (!author) continue
      votedForCount[author.name] = (votedForCount[author.name] ?? 0) + 1
    }
    const votedForUsers = Object.entries(votedForCount)
      .sort((a, b) => b[1] - a[1])
      .map(([userName, count]) => ({ userName, count }))

    return {
      userId: user.id,
      userName: user.name,
      overall,
      last,
      lastTournamentNumber,
      cardTexts,
      usedCardTexts,
      lastUsedCardTexts,
      workTexts,
      lastWorkTexts,
      preambleTexts,
      lastPreambleTexts,
      votedWorkTexts,
      lastVotedWorkTexts,
      votedForUsers,
    }
  })

  // 最新大会の順位データを計算
  const lastTournamentStandings = buildStandings(
    users,
    submissions,
    votes,
    mashResults,
    lastTournamentValidGameIds,
  )

  // Claude で一括生成（ユーザー総評 + 大会総評）
  const generated = await generateAllComments(userInputs, tournamentCount, lastTournamentStandings)
  if (!generated) {
    return NextResponse.json({ error: 'Claude API エラー' }, { status: 500 })
  }

  // ユーザー総評DB保存（upsert）
  for (const item of generated.users) {
    await supabaseAdmin.from('user_ai_comments').upsert(
      {
        user_id: item.userId,
        overall_comment: item.overallComment,
        last_tournament_comment: item.lastComment,
        card_analysis_comment: item.cardAnalysisComment,
        vote_analysis_comment: item.voteAnalysisComment,
        nickname: item.nickname,
        last_tournament_id: lastTournamentId,
        tournament_count: tournamentCount,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  }

  // 大会総評DB保存
  if (generated.tournamentComment) {
    await supabaseAdmin
      .from('tournaments')
      .update({ ai_comment: generated.tournamentComment })
      .eq('id', lastTournamentId)
  }

  return NextResponse.json({ success: true, generated: generated.users.length })
}

// ---- helpers ----

async function computeValidGameIds(tournamentIds: string[]): Promise<Set<string>> {
  if (tournamentIds.length === 0) return new Set()

  const { data: games } = await supabase
    .from('games')
    .select('id, tournament_id, round_number, is_rematch')
    .in('tournament_id', tournamentIds)
    .gt('round_number', 0)

  const result = new Set<string>()
  for (const tId of tournamentIds) {
    const tGames = (games ?? []).filter((g) => g.tournament_id === tId)
    const rematchRounds = new Set(tGames.filter((g) => g.is_rematch).map((g) => g.round_number))
    for (const g of tGames) {
      if (!(g.is_rematch === false && rematchRounds.has(g.round_number))) {
        result.add(g.id)
      }
    }
  }
  return result
}

function computeStats(
  userId: string,
  cards: { id: string; creator_user_id: string; tournament_id: string; text: string }[],
  submissions: { id: string; user_id: string; hand_card_id: string; game_id: string; preamble: string | null }[],
  votes: { voter_user_id: string; submission_id: string; game_id: string; is_tiebreaker: boolean }[],
  mashResults: { game_id: string; user_id: string; tap_count: number; mash_round: number; completion_time_ms?: number | null }[],
  validGameIds: Set<string>,
): CompactStats {
  const initialVotes = votes.filter((v) => !v.is_tiebreaker)

  // 作品別得票数
  const voteCountBySub: Record<string, number> = {}
  for (const v of initialVotes) {
    if (validGameIds.has(v.game_id)) {
      voteCountBySub[v.submission_id] = (voteCountBySub[v.submission_id] ?? 0) + 1
    }
  }

  const gamesWithVotes = new Set(initialVotes.filter((v) => validGameIds.has(v.game_id)).map((v) => v.game_id))

  // ゲーム別勝者
  const subsByGame: Record<string, { id: string; userId: string }[]> = {}
  for (const s of submissions) {
    if (!validGameIds.has(s.game_id)) continue
    if (!subsByGame[s.game_id]) subsByGame[s.game_id] = []
    subsByGame[s.game_id].push({ id: s.id, userId: s.user_id })
  }

  const winnersByGame: Record<string, string[]> = {}
  for (const [gameId, subs] of Object.entries(subsByGame)) {
    const gameMash = mashResults.filter((r) => r.game_id === gameId)
    if (gameMash.length >= 2) {
      const maxRound = Math.max(...gameMash.map((r) => r.mash_round))
      const latest = gameMash.filter((r) => r.mash_round === maxRound)
      const maxTaps = Math.max(...latest.map((r) => r.tap_count))
      const topByTaps = latest.filter((r) => r.tap_count === maxTaps)
      let winner
      if (topByTaps.length === 1) {
        winner = topByTaps[0]
      } else {
        // speed mode: completion_time_ms で比較
        const withTime = topByTaps.filter((r) => r.completion_time_ms != null)
        if (withTime.length >= 2) {
          const minTime = Math.min(...withTime.map((r) => r.completion_time_ms!))
          const topByTime = withTime.filter((r) => r.completion_time_ms === minTime)
          if (topByTime.length === 1) winner = topByTime[0]
        }
      }
      if (winner) {
        const ws = subs.find((s) => s.userId === winner.user_id)
        if (ws) winnersByGame[gameId] = [ws.id]
      }
      continue
    }
    const tbVotes = votes.filter((v) => v.game_id === gameId && v.is_tiebreaker)
    if (tbVotes.length > 0) {
      const tbCount: Record<string, number> = {}
      for (const v of tbVotes) tbCount[v.submission_id] = (tbCount[v.submission_id] ?? 0) + 1
      const maxTb = Math.max(...Object.values(tbCount))
      const w = Object.entries(tbCount).find(([, c]) => c === maxTb)
      if (w) winnersByGame[gameId] = [w[0]]
      continue
    }
    let maxV = 0
    for (const s of subs) {
      const c = voteCountBySub[s.id] ?? 0
      if (c > maxV) maxV = c
    }
    if (maxV > 0) {
      winnersByGame[gameId] = subs.filter((s) => (voteCountBySub[s.id] ?? 0) === maxV).map((s) => s.id)
    }
  }

  const myCardIds = new Set(cards.filter((c) => c.creator_user_id === userId).map((c) => c.id))
  const myCards = cards.filter((c) => c.creator_user_id === userId)
  const cardsCreated = myCards.length
  const cardsUsed = submissions.filter((s) => myCardIds.has(s.hand_card_id)).length
  const cardUsageRate = cardsCreated > 0 ? cardsUsed / cardsCreated : 0

  const mySubs = submissions.filter((s) => s.user_id === userId && validGameIds.has(s.game_id))
  const gamesParticipated = mySubs.length
  const totalVotesReceived = mySubs.reduce((sum, s) => sum + (voteCountBySub[s.id] ?? 0), 0)
  const avgVotesPerGame = gamesParticipated > 0 ? totalVotesReceived / gamesParticipated : 0

  let singles = 0, doubles = 0, triples = 0, homeRuns = 0
  for (const s of mySubs) {
    const c = voteCountBySub[s.id] ?? 0
    if (c === 1) singles++
    else if (c === 2) doubles++
    else if (c === 3) triples++
    else if (c >= 4) homeRuns++
  }

  const mvpCount = mySubs.filter((s) => (winnersByGame[s.game_id] ?? []).includes(s.id)).length
  const mvpWinRate = gamesParticipated > 0 ? mvpCount / gamesParticipated : 0

  const shutoutCount = mySubs.filter(
    (s) => gamesWithVotes.has(s.game_id) && (voteCountBySub[s.id] ?? 0) === 0
  ).length
  const shutoutRate = gamesParticipated > 0 ? shutoutCount / gamesParticipated : 0

  const preambledSubs = mySubs.filter((s) => s.preamble && (s.preamble as string).trim().length > 0)
  const preambleCount = preambledSubs.length
  const preambleUsageRate = gamesParticipated > 0 ? preambleCount / gamesParticipated : 0

  const myWinGameIds = new Set(mySubs.filter((s) => (winnersByGame[s.game_id] ?? []).includes(s.id)).map((s) => s.game_id))
  const myVotesCast = initialVotes.filter((v) => v.voter_user_id === userId && validGameIds.has(v.game_id))
  const loneVoteCount = myVotesCast.filter(
    (v) => (voteCountBySub[v.submission_id] ?? 0) === 1 && !(winnersByGame[v.game_id] ?? []).includes(v.submission_id)
  ).length

  void myWinGameIds

  // 連打ゲーム成績
  const myMash = mashResults.filter((r) => r.user_id === userId)
  const mashGameIds = new Set(myMash.map((r) => r.game_id))
  let buttonMashWins = 0
  let buttonMashGames = 0
  for (const gameId of mashGameIds) {
    const gameMash = mashResults.filter((r) => r.game_id === gameId)
    if (gameMash.length < 2) continue
    buttonMashGames++
    const maxRound = Math.max(...gameMash.map((r) => r.mash_round))
    const latest = gameMash.filter((r) => r.mash_round === maxRound)
    const winnerSub = winnersByGame[gameId]
    if (winnerSub) {
      const winnerMash = latest.find((r) => r.user_id === userId)
      if (winnerMash) {
        const subForWinner = (Object.entries(winnersByGame).find(([gId]) => gId === gameId)?.[1] ?? [])
        void subForWinner
        // シンプルに: winnersByGame[gameId]が自分のsubかを確認
        const mySub = submissions.find((s) => s.game_id === gameId && s.user_id === userId)
        if (mySub && (winnersByGame[gameId] ?? []).includes(mySub.id)) {
          buttonMashWins++
        }
      }
    }
  }
  const buttonMashWinRate = buttonMashGames > 0 ? buttonMashWins / buttonMashGames : 0

  return {
    gamesParticipated,
    mvpCount,
    mvpWinRate,
    avgVotesPerGame,
    homeRuns,
    singles,
    doubles,
    triples,
    shutoutCount,
    shutoutRate,
    preambleCount,
    preambleUsageRate,
    loneVoteCount,
    cardUsageRate,
    buttonMashWins,
    buttonMashGames,
    buttonMashWinRate,
  }
}

function buildStandings(
  users: { id: string; name: string }[],
  submissions: { id: string; user_id: string; hand_card_id: string; game_id: string; preamble: string | null }[],
  votes: { voter_user_id: string; submission_id: string; game_id: string; is_tiebreaker: boolean }[],
  mashResults: { game_id: string; user_id: string; tap_count: number; mash_round: number; completion_time_ms?: number | null }[],
  validGameIds: Set<string>,
): TournamentStanding[] {
  const initialVotes = votes.filter((v) => !v.is_tiebreaker && validGameIds.has(v.game_id))
  const voteCountBySub: Record<string, number> = {}
  for (const v of initialVotes) {
    voteCountBySub[v.submission_id] = (voteCountBySub[v.submission_id] ?? 0) + 1
  }

  const subsByGame: Record<string, { id: string; userId: string }[]> = {}
  for (const s of submissions) {
    if (!validGameIds.has(s.game_id)) continue
    if (!subsByGame[s.game_id]) subsByGame[s.game_id] = []
    subsByGame[s.game_id].push({ id: s.id, userId: s.user_id })
  }

  const winnersByGame: Record<string, string[]> = {}
  for (const [gameId, subs] of Object.entries(subsByGame)) {
    const gameMash = mashResults.filter((r) => r.game_id === gameId)
    if (gameMash.length >= 2) {
      const maxRound = Math.max(...gameMash.map((r) => r.mash_round))
      const latest = gameMash.filter((r) => r.mash_round === maxRound)
      const maxTaps = Math.max(...latest.map((r) => r.tap_count))
      const topByTaps = latest.filter((r) => r.tap_count === maxTaps)
      let winner
      if (topByTaps.length === 1) {
        winner = topByTaps[0]
      } else {
        const withTime = topByTaps.filter((r) => r.completion_time_ms != null)
        if (withTime.length >= 2) {
          const minTime = Math.min(...withTime.map((r) => r.completion_time_ms!))
          const topByTime = withTime.filter((r) => r.completion_time_ms === minTime)
          if (topByTime.length === 1) winner = topByTime[0]
        }
      }
      if (winner) { const ws = subs.find((s) => s.userId === winner.user_id); if (ws) winnersByGame[gameId] = [ws.id] }
      continue
    }
    const tbVotes = votes.filter((v) => v.game_id === gameId && v.is_tiebreaker)
    if (tbVotes.length > 0) {
      const tbCount: Record<string, number> = {}
      for (const v of tbVotes) tbCount[v.submission_id] = (tbCount[v.submission_id] ?? 0) + 1
      const maxTb = Math.max(...Object.values(tbCount))
      const w = Object.entries(tbCount).find(([, c]) => c === maxTb)
      if (w) winnersByGame[gameId] = [w[0]]
      continue
    }
    let maxV = 0
    for (const s of subs) { const c = voteCountBySub[s.id] ?? 0; if (c > maxV) maxV = c }
    if (maxV > 0) winnersByGame[gameId] = subs.filter((s) => (voteCountBySub[s.id] ?? 0) === maxV).map((s) => s.id)
  }

  const scoreMap: Record<string, { wins: number; totalVotes: number; mvpCount: number }> = {}
  for (const user of users) scoreMap[user.id] = { wins: 0, totalVotes: 0, mvpCount: 0 }

  for (const s of submissions) {
    if (!validGameIds.has(s.game_id)) continue
    const uid = s.user_id
    if (!scoreMap[uid]) continue
    scoreMap[uid].totalVotes += voteCountBySub[s.id] ?? 0
    const winners = winnersByGame[s.game_id] ?? []
    if (winners.includes(s.id)) {
      scoreMap[uid].wins += winners.length === 1 ? 1 : 0
      scoreMap[uid].mvpCount += 1
    }
  }

  const sorted = users
    .map((u) => ({ ...u, ...scoreMap[u.id] }))
    .sort((a, b) => b.wins - a.wins || b.totalVotes - a.totalVotes)

  return sorted.map((u, i) => ({
    userName: u.name,
    rank: i + 1,
    wins: u.wins,
    totalVotes: u.totalVotes,
    mvpCount: u.mvpCount,
  }))
}

function formatStats(s: CompactStats): string {
  const fmt = (n: number) => n.toFixed(3).replace(/^0/, '')
  const parts = [
    `MVP${s.mvpCount}回(勝率${fmt(s.mvpWinRate)})`,
    `平均得票${s.avgVotesPerGame.toFixed(2)}`,
    `1B${s.singles}/2B${s.doubles}/3B${s.triples}/HR${s.homeRuns}`,
    `ズル滑り${s.shutoutCount}回(率${fmt(s.shutoutRate)})`,
    `前口上${s.preambleCount}回(使用率${fmt(s.preambleUsageRate)})`,
    `独りぼっち票${s.loneVoteCount}回`,
    `作成札採用率${fmt(s.cardUsageRate)}`,
  ]
  if (s.buttonMashGames > 0) {
    parts.push(`連打${s.buttonMashWins}勝${s.buttonMashGames - s.buttonMashWins}敗(勝率${fmt(s.buttonMashWinRate)})`)
  }
  return parts.join(' | ')
}

async function generateAllComments(
  users: UserCommentInput[],
  tournamentNumber: number,
  standings: TournamentStanding[],
): Promise<{ users: { userId: string; overallComment: string; lastComment: string; cardAnalysisComment: string; voteAnalysisComment: string; nickname: string }[]; tournamentComment: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY が設定されていません')
    return null
  }

  // 相対ランキング表（数値の相対評価用）
  function rankAmong(getValue: (s: CompactStats) => number, users: UserCommentInput[], higherIsBetter: boolean, useOverall: boolean): string {
    const sorted = [...users].sort((a, b) => {
      const as = useOverall ? a.overall : (a.last ?? a.overall)
      const bs = useOverall ? b.overall : (b.last ?? b.overall)
      return higherIsBetter ? getValue(bs) - getValue(as) : getValue(as) - getValue(bs)
    })
    return sorted.map((u, i) => {
      const s = useOverall ? u.overall : (u.last ?? u.overall)
      return `${i + 1}位:${u.userName}(${getValue(s).toFixed(2)})`
    }).join(' ')
  }

  const ro = (fn: (s: CompactStats) => number, higher: boolean) => rankAmong(fn, users, higher, true)
  const rl = (fn: (s: CompactStats) => number, higher: boolean) => rankAmong(fn, users, higher, false)

  const relativeRankings = [
    `MVP数: ${ro(s => s.mvpCount, true)}`,
    `平均得票: ${ro(s => s.avgVotesPerGame, true)}`,
    `HR数: ${ro(s => s.homeRuns, true)}`,
    `ズル滑り数(多いほど不名誉・悪い成績・不名誉ランキング1位が最悪): ${ro(s => s.shutoutCount, true)}`,
    `ズル滑り率(多いほど不名誉・悪い成績): ${ro(s => s.shutoutRate, true)}`,
    `前口上使用率: ${ro(s => s.preambleUsageRate, true)}`,
    `独りぼっち票(多いほど不名誉・ワーストランキング1位が最悪): ${ro(s => s.loneVoteCount, true)}`,
    users.some(u => u.overall.buttonMashGames > 0)
      ? `連打ゲーム勝率: ${ro(s => s.buttonMashWinRate, true)}`
      : null,
  ].filter(Boolean).join('\n')

  // 前回大会専用ランキング（tournament_comment用）
  const hasLastData = users.some(u => u.last !== null)
  const lastRelativeRankings = hasLastData ? [
    `MVP数: ${rl(s => s.mvpCount, true)}`,
    `平均得票: ${rl(s => s.avgVotesPerGame, true)}`,
    `HR数: ${rl(s => s.homeRuns, true)}`,
    `ズル滑り数(多いほど不名誉): ${rl(s => s.shutoutCount, true)}`,
    `ズル滑り率(多いほど不名誉): ${rl(s => s.shutoutRate, true)}`,
    users.some(u => (u.last?.buttonMashGames ?? 0) > 0)
      ? `連打ゲーム勝率: ${rl(s => s.buttonMashWinRate, true)}`
      : null,
  ].filter(Boolean).join('\n') : '（前回大会データなし）'

  const playerSection = users
    .map((u) => {
      const overallLine = `【${u.userName}】通算成績: ${formatStats(u.overall)}`
      const cardLine = u.cardTexts.length > 0
        ? `【${u.userName}】[通算] 作成した札（全${u.cardTexts.length}枚・うちゲームで使用された${u.usedCardTexts.length}枚）:\n  全札（分析用のみ・文章に登場禁止）: 「${u.cardTexts.join('」「')}」\n  使用済み札（文章で言及可）: 「${u.usedCardTexts.join('」「')}」`
        : `【${u.userName}】[通算] 作成した札: なし`
      const workLine = u.workTexts.length > 0
        ? `【${u.userName}】[通算] 作品（お題+手札）: 「${u.workTexts.join('」「')}」`
        : `【${u.userName}】[通算] 作品: なし`
      const preambleLine = u.preambleTexts.length > 0
        ? `【${u.userName}】[通算] 前口上（分析用・全${u.preambleTexts.length}件）: 「${u.preambleTexts.join('」「')}」`
        : `【${u.userName}】[通算] 前口上: なし`
      const votedLine = u.votedWorkTexts.length > 0
        ? `【${u.userName}】[通算] 票を入れた作品（全${u.votedWorkTexts.length}件）: 「${u.votedWorkTexts.join('」「')}」`
        : `【${u.userName}】[通算] 票を入れた作品: データなし`
      const votedForLine = u.votedForUsers.length > 0
        ? `【${u.userName}】[通算] 誰の作品に多く票を入れたか: ${u.votedForUsers.map(v => `${v.userName}(${v.count}回)`).join('、')}`
        : `【${u.userName}】[通算] 誰への投票: データなし`

      const lastLine = u.last && u.lastTournamentNumber
        ? `【${u.userName}】[前回大会・第${u.lastTournamentNumber}回] 成績: ${formatStats(u.last)}`
        : `【${u.userName}】[前回大会] データなし`
      const lastWorkLine = u.lastWorkTexts.length > 0
        ? `【${u.userName}】[前回大会] 作品（お題+手札）: 「${u.lastWorkTexts.join('」「')}」`
        : `【${u.userName}】[前回大会] 作品: なし`
      const lastPreambleLine = u.lastPreambleTexts.length > 0
        ? `【${u.userName}】[前回大会] 前口上（分析用）: 「${u.lastPreambleTexts.join('」「')}」`
        : `【${u.userName}】[前回大会] 前口上: なし`
      const lastVotedLine = u.lastVotedWorkTexts.length > 0
        ? `【${u.userName}】[前回大会] 票を入れた作品: 「${u.lastVotedWorkTexts.join('」「')}」`
        : `【${u.userName}】[前回大会] 票を入れた作品: なし`

      return [
        '--- 通算データ ---',
        overallLine, cardLine, workLine, preambleLine, votedLine, votedForLine,
        '--- 前回大会データ（last_tournament_commentはこのデータのみ使用すること） ---',
        lastLine, lastWorkLine, lastPreambleLine, lastVotedLine,
      ].join('\n')
    })
    .join('\n\n')

  const standingsText = standings.map((s) =>
    `${s.rank}位: ${s.userName}（MVP${s.wins}回・総得票${s.totalVotes}票）`
  ).join('、')

  const lastTournamentWorksByUser = users.map((u) => {
    return `${u.userName}: ${u.lastWorkTexts.length > 0 ? `「${u.lastWorkTexts.join('」「')}」` : 'なし'}`
  }).join('\n')

  const prompt = `あなたは「おもじゃん」というワードバトルゲームのAI解説者です。

【ゲームの前提（必ず守ること・絶対禁止事項）】
- **参加者は全員が全回戦に必ず参加・作品投稿・投票をしている。全員の参加回数・投稿回数・投票回数は完全に同じ数値になる**
- **以下の言及は全コメントで絶対禁止**：参加率・出場率・参加頻度・投稿回数の多さ・少なさ・「全試合出場」「積極的に投稿」「毎回参加」「投票欠かさず」など参加・投稿・投票の多少に関する表現は一切使わない。全員同じなので意味がない
- 参加者は全員おっさん（中年男性）グループ。本人たちは知り合い同士

【おもじゃんのゲームルール（分析時に必ず考慮すること）】
- **自分の作品には絶対に投票できない**。1回戦につき1票を他の誰かの作品に必ず入れる
- 「誰の作品に票を多く入れたか」「どんな作品のセンスが好きか」「誰との相性が良いか」は分析してよい
- **「強い人が弱い人に票を入れている」「弱い人が強い人に票を入れている」「勝率○位の人が○位の人を多く支持している」という表現は絶対禁止**。自分に投票できないルール上、順位・強さと投票先の関係は必然的なものであり、個性や傾向ではない
- 独りぼっち票（自分だけが票を入れたのに落選）が多いということは、多数派と感覚がズレていることを意味する。ただし全員が選ばない状況で仕方なく入れたケースもある
- MVP（最多得票）とは「その回戦で他の参加者から最も多く票が集まった作品」を出したプレイヤー。同票の場合は決選投票または連打ゲームで決める
- ズル滑り（0票）とは「誰からも票が入らなかった」こと。全員が他の作品を選んだということ
- 投票傾向を分析する際は上記ルールを必ず踏まえ、ルールの必然的結果と本当の個性的傾向を区別して語ること

【個人総評キャラクター設定（リナちゃん）】
- キャラ：「リナちゃん」という容赦ない毒舌ギャル美少女。おっさんたちの弱点・恥ずかしい部分・センスのなさをピンポイントで刺し、読んだ本人がへこむレベルの悪口を浴びせる
- **コメントは悪口・批判・人格ディスがメイン。「こいつやばい」「センスない」「終わってる」「ウケる（笑えない意味で）」という方向性で書く。褒めは原則なし。本当に突出した良い点がある場合のみ最後に一言だけ、しぶしぶ認める**
- **凹ませることが最優先。「読んだ人が恥ずかしくなる」「このコメント見せられたくない」と思わせるくらい的確に刺すこと**
- 口調：ギャル口調全開。「ウケる〜」「マジ？」「ヤバくない？」「〜じゃん」「てか」「は？」「なにそれ」「ありえないし」「センスゼロ」「終わってる」「救いようない」「ダサすぎ」「恥ずかしくないの？」「正気？」「笑えないんだけど」など。敬語は一切使わない
- **リナちゃん自身のコメント文に関西弁（〜やん、〜やで、〜やねん、〜やろ等）は絶対に使わない。ただし、ユーザーの札・作品・前口上テキストに関西弁が含まれる場合はそのまま引用してよい**
- 美少女に上から見下されてボロクソ言われるおっさんの構図が大事。「こんなおじさんに説教されたくない」という逆転感
- 鋭い分析で人格ごと刺す。「この人って結局〇〇なんだよね」という本質的な人物評価でえぐること
- 良いところは**原則触れない**。どうしても無視できない突出した点があれば最後に「まぁ…それだけはギリ」と一言。基本は弱点・失敗・センスのなさにフォーカス
- **絵文字（必須ルール）**: 各コメントに必ず1〜2個の絵文字を入れること。「💀」「😂」「🙄」「😑」「🤦」「🫠」「💔」など辛辣系メイン。ときどき「💅」「✨」を混ぜて美少女感を出しながら追い打ちをかけること。全コメント同じ絵文字を使い回さない
- **テンションのさじ加減（必須ルール）**: 基本は冷たく上から目線の落ち着いたトーンで淡々と悪口を言い、各コメントに必ず1〜2箇所、感嘆符「!」「!?」でテンションを爆発させること。「は！？」「ウソでしょ!」「それはないわ!」「マジでやばくない!?」「ちょっと待って!?」「笑えないんだけど!」など。**「クールな蔑み」と「呆れたテンション爆発」のメリハリが命**

以下のプレイヤーの成績データと作成した札・作品・投票した作品の一覧を見て、それぞれ5種類のコメントを書いてください。

ルール：
- 各コメントは200文字前後（180〜220文字）。短すぎも長すぎもNG
- **悪口・批判・人格ディスがメイン。凹ませることを最優先に書く。褒めは原則なし**
- アドバイスや改善点は不要。ひたすらイジる・批判する・恥ずかしいところを晒す
- 絵文字は各コメント1〜2個（必須）。辛辣系メインで
- **リナちゃんの書くコメント文に関西弁（〜やん、〜やで、〜やねん等）は絶対禁止。ユーザーテキストの引用はOK**
- **データスコープの厳守（重要）：各コメントは必ず対応するデータスコープの情報のみを使うこと**
  - overall_comment / card_analysis_comment / vote_analysis_comment → 「--- 通算データ ---」セクションのみ使用。前回大会データで語らない
  - last_tournament_comment → 「--- 前回大会データ ---」セクションのみ使用。通算データ・通算ランキングで語らない。前回大会で起きたことだけを語ること
- **テキストの羅列・列挙は全コメントで厳禁（最重要）**。札・作品・前口上・票を入れた作品などのテキストをそのまま並べることは絶対にしない。「A」「B」「C」のように複数引用するのは禁止。引用するなら最大1件のみで、それ以外は「こういう傾向がある」「こんな性格が透けて見える」という分析の言葉で語ること。データは分析の材料であって、コメントに直接登場させるものではない
- 前口上データは分析に活用すること（overall/card_analysisは通算前口上、last_tournament_commentは前回大会前口上のみ使用）
- **作品内容の傾向を分析する**：下ネタ系・シュール系・勢いだけ・カッコつけ・ダジャレ系・変化球等のパターンを見抜いてイジること。傾向を1つ引用で示すのはOKだが、それ以外は分析の言葉で
- nicknameは作品・札・投票傾向の全体像を総合したユニークで笑える称号。バラエティ豊かに（例：「孤高の変人センサー保持者」「下ネタで世界を救う男」「誰よりも真面目に滑る人」など）。20文字以内

【各フィールドの生成指示】
- overall_comment: 通算データをもとに、そのプレイヤーの人物像・性格・趣味嗜好・作品傾向を辛辣にギャル口調でイジる
- last_comment: 前回大会データ（成績・作品・前口上・投票した作品）をもとに、その大会での動きや傾向を辛辣にギャル口調でイジる。必ず生成すること
- card_analysis_comment: 通算の使用済み札・作品・前口上をもとに、言葉選びのクセや発想の傾向からその人の内面・趣味嗜好を深読みしてギャル口調でイジる。札テキストを並べるのではなく「こういう言葉を選びがちな人間の内面は〜」という分析の言葉でコメントすること
- vote_analysis_comment: 全大会の投票データから、このプレイヤーがどんな「作品のテイスト・センス・笑いの方向性」に票を入れる傾向があるかを辛辣にギャル口調でイジる。**「誰に多く票を入れたか」という人物ベースの分析は禁止**。自分の作品には投票できないルール上、票の行き先は必然的に絞られるため、人物×人物の関係性は個性でも相性でもない。分析すべきは「下ネタ系に弱い」「シュール系に共鳴する」「勢いだけの作品を好む」「言葉のセンスより笑えるかどうかで選ぶ」といった**作品の中身・スタイルへの好み**。NG例：「〇〇さんの作品によく票を入れている→相性が良い」。OK例：「ワードの意外性より場の盛り上がりで選ぶタイプ」「どんな回戦でも下ネタ臭がある作品に引き寄せられている」
- nickname: 全体の傾向を総合した称号（20文字以内）

【数値の相対評価について（重要）】
- 数値を評価する際は必ず下記のランキングを参照し、参加者全員の中での相対的な位置づけで評価すること
- 例：HR2本でも全員で最多なら「HR王」「このメンツの中では一番」と評価する
- 数値の絶対値だけで良し悪しを判断しない。ランキングで何位かを見て評価する
- **ワーストランキングは「多いほど不名誉」。ランキング1位が最も恥ずかしい**。ズル滑り数・ズル滑り率・独りぼっち票が多い人ほど悪い評価

【各指標の意味】
- MVP数: その回戦で最も多く票を獲得した回数。同票の場合は決選（決選投票・連打ゲーム）で勝った場合も含む
- 平均得票: 1回戦あたり平均何票獲得したか。高いほど安定した評価
- HR数: 1作品で4票以上獲得した回数。ほぼ全員が認めた神作品の数
- ズル滑り数: 投票が行われた回戦で1票も入らなかった回数。【多いほど不名誉・多いほど悪い成績。ランキング1位＝最悪】
- ズル滑り率: 0票だった回の割合。【多いほど不名誉。ランキング1位＝最悪】
- 前口上使用率: 作品投稿時に前口上を入力した回の割合
- 独りぼっち票: 自分だけが票を入れたのに落選した回数。【多いほど不名誉。ランキング1位＝最悪】
- 連打ゲーム勝率: 連打ゲームに出場して勝利した割合（未参加ならデータなし）

【通算成績ランキング（相対評価の参考に必ず使うこと）】
${relativeRankings}

【大会総評（tournament_comment）について】
キャラクター：「デスク・大河内」というスポーツ新聞のベテラン記者。ビジネスライクで格調ある文体を基本とするが、要所でツッコミやイジりが入り、思わず笑える記事スタイル。リナちゃんとは別キャラ。
- これは「第${tournamentNumber}回大会のみの総評」
- **順位・勝者・成績・ランキングを語る際は必ず以下の「第${tournamentNumber}回大会」のデータのみ使うこと。通算ランキングを今回の大会結果として語ることは厳禁**
- 見出しのような書き出しから始める（例：「激闘の末、〇〇が頂点へ！」など）
- この大会で実際に使われた作品から読み取れる参加者全体の趣味嗜好・センス・心理状態・傾向を分析・言及する
- 印象的な作品を具体的に取り上げてコメントする
- 未使用の札・配られたが使われなかった手札には言及しない
- 次回大会への期待や不安・予測もさりげなく含める
- 個人への言及は大会の流れを語る文脈でのみ自然に入れる
- 300文字前後（280〜320文字）をフルに使うこと

【第${tournamentNumber}回大会 成績ランキング（tournament_commentで使うこと。通算ランキングと混同しないこと）】
${lastRelativeRankings}

第${tournamentNumber}回大会 順位: ${standingsText}
この大会の全作品（ユーザー別）:
${lastTournamentWorksByUser}

- JSONのみ返す（説明不要）

成績データ・作成した札・投票した作品：
${playerSection}

以下のJSON形式で返してください：
{
  "tournament_comment": "...",
  "users": [
    {
      "user_id": "ここにuuid",
      "overall_comment": "...",
      "last_comment": "...",
      "card_analysis_comment": "...",
      "vote_analysis_comment": "...",
      "nickname": "..."
    }
  ]
}

user_idはそれぞれ: ${users.map((u) => `${u.userName}=${u.userId}`).join(', ')}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL_COMMENTS,
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error('Claude API エラー:', await res.text())
      return null
    }

    const json = await res.json()
    const text: string = json.content?.[0]?.text ?? ''

    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.error('JSONパース失敗:', text)
      return null
    }

    const parsed = JSON.parse(match[0]) as {
      tournament_comment: string
      users: { user_id: string; overall_comment: string; last_comment: string; card_analysis_comment: string; vote_analysis_comment: string; nickname: string }[]
    }

    return {
      tournamentComment: parsed.tournament_comment ?? '',
      users: parsed.users.map((u) => ({
        userId: u.user_id,
        overallComment: u.overall_comment ?? '',
        lastComment: u.last_comment ?? '',
        cardAnalysisComment: u.card_analysis_comment ?? '',
        voteAnalysisComment: u.vote_analysis_comment ?? '',
        nickname: u.nickname ?? '',
      })),
    }
  } catch (e) {
    console.error('generateAllComments エラー:', e)
    return null
  }
}
