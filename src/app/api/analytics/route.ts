import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export interface UserStats {
  userId: string
  userName: string
  // 作成札採用率
  cardUsageRate: number    // 0.000〜1.000 形式
  cardsCreated: number
  cardsUsed: number
  // ヒット数（票数別）
  singles: number    // 1票
  doubles: number    // 2票
  triples: number    // 3票
  homeRuns: number   // 4票以上
  totalHits: number
  // MVP回数（その回戦で1位）
  mvpCount: number
  // 平均得票数（1回戦あたり平均票数）
  avgVotesPerGame: number
  totalVotesReceived: number
  gamesParticipated: number
  // 連打ゲーム勝率
  buttonMashWins: number
  buttonMashGames: number
  buttonMashWinRate: number
  // 連打回数（回数勝負）
  bestTapCount: number     // 最高連打数（1セッション）
  avgTapCount: number      // 平均連打数
  totalTapSessions: number // 出場セッション数（回数勝負）
  // 連打タイム（タイム勝負）
  bestCompletionTimeMs: number  // 最速タイム（ms）。0=データなし
  avgCompletionTimeMs: number   // 平均タイム（ms）。0=データなし
  speedMashSessions: number     // タイム勝負の出場セッション数
  // 追加指標
  mvpWinRate: number       // MVP勝率 = mvpCount / gamesParticipated
  shutoutCount: number     // 完封（0票）回数
  shutoutRate: number      // 完封率
  homeRunRate: number      // ホームラン率 = homeRuns / gamesParticipated
  preambleCount: number    // 前口上使用回数
  preambleUsageRate: number // 前口上使用率
  maxVotesInGame: number   // 1ゲームでの最高得票数
  // 個性指標
  majorityVoteRate: number  // 多数派投票率 = MVP作品に投票した回数 / 投票総数
  votesCastCount: number    // 投票総数
  loneVoteCount: number     // 孤独投票数（自分だけ投票したが落選）
  selfCardUsageRate: number // 自作札使用率 = 自作札で出場した回数 / 出場数
  selfCardUsedCount: number // 自作札使用回数
  avgPreambleLength: number // 前口上平均文字数（使用時のみ）
}

const PRODUCTION_USER_NAMES = ['はじむ', 'スラパン', 'こんべ', 'かねおか', 'カズさん']

export async function GET() {
  // 本番ユーザーのみ取得（AIキャラクターを除外）
  const { data: allUsers } = await supabase.from('users').select('id, name')
  const users = (allUsers ?? []).filter((u) => PRODUCTION_USER_NAMES.includes(u.name))
  if (!users || users.length === 0) {
    return NextResponse.json({ stats: [] })
  }

  // 本番大会（終了済み）のみ対象（summaryと同じ集計範囲）
  const { data: prodTournaments } = await supabase
    .from('tournaments')
    .select('id')
    .eq('mode', 'production')
    .eq('status', 'finished')
  const prodTournamentIds = (prodTournaments ?? []).map((t) => t.id)
  if (prodTournamentIds.length === 0) {
    return NextResponse.json({ stats: users.map((u) => ({ userId: u.id, userName: u.name, cardUsageRate: 0, cardsCreated: 0, cardsUsed: 0, singles: 0, doubles: 0, triples: 0, homeRuns: 0, totalHits: 0, mvpCount: 0, avgVotesPerGame: 0, totalVotesReceived: 0, gamesParticipated: 0, buttonMashWins: 0, buttonMashGames: 0, buttonMashWinRate: 0, bestTapCount: 0, avgTapCount: 0, totalTapSessions: 0, bestCompletionTimeMs: 0, avgCompletionTimeMs: 0, speedMashSessions: 0, mvpWinRate: 0, shutoutCount: 0, shutoutRate: 0, homeRunRate: 0, preambleCount: 0, preambleUsageRate: 0, maxVotesInGame: 0 })) })
  }

  // 本番大会の全ゲームIDを取得（tournament_id付きで取得し、大会ごとに流局除外判定する）
  const { data: prodGames } = await supabase
    .from('games')
    .select('id, tournament_id, is_rematch, round_number')
    .in('tournament_id', prodTournamentIds)
  const prodGameIds = (prodGames ?? []).map((g) => g.id)

  // 流局ゲームを大会ごとに除外（summaryと同ロジック。グローバルに判定すると別大会の同回戦が巻き込まれる）
  const validGameIds = new Set<string>()
  for (const tId of prodTournamentIds) {
    const tourneyGames = (prodGames ?? []).filter((g) => g.tournament_id === tId)
    const rematchRounds = new Set(
      tourneyGames.filter((g) => g.is_rematch).map((g) => g.round_number)
    )
    for (const g of tourneyGames) {
      if (!(g.is_rematch === false && rematchRounds.has(g.round_number))) {
        validGameIds.add(g.id)
      }
    }
  }

  // 本番大会のデータのみ一括取得
  const [
    { data: allCards },
    { data: allSubmissions },
    { data: allVotes },
    { data: allMashResults },
  ] = await Promise.all([
    supabase.from('cards').select('id, creator_user_id, tournament_id').in('tournament_id', prodTournamentIds),
    prodGameIds.length > 0 ? supabase.from('submissions').select('id, user_id, hand_card_id, game_id, preamble').in('game_id', prodGameIds) : Promise.resolve({ data: [] }),
    prodGameIds.length > 0 ? supabase.from('votes').select('voter_user_id, submission_id, game_id, is_tiebreaker').in('game_id', prodGameIds) : Promise.resolve({ data: [] }),
    prodGameIds.length > 0 ? supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round, completion_time_ms').in('game_id', prodGameIds) : Promise.resolve({ data: [] }),
  ])

  const cards = allCards ?? []
  const submissions = allSubmissions ?? []
  const votes = allVotes ?? []
  const mashResults = allMashResults ?? []

  // 作品別の得票数（初回投票のみ）
  const voteCountBySubmission: Record<string, number> = {}
  const initialVotes = votes.filter((v) => !v.is_tiebreaker)
  for (const v of initialVotes) {
    voteCountBySubmission[v.submission_id] = (voteCountBySubmission[v.submission_id] ?? 0) + 1
  }
  // 投票が行われたゲームのSet（完封判定用）
  const gamesWithVotes = new Set(initialVotes.map((v) => v.game_id))

  // ゲーム別の勝者submissionId（複数可：決戦なし同票は全員1位）
  const winnersByGame: Record<string, string[]> = {}
  const submissionsByGame: Record<string, { id: string; userId: string }[]> = {}
  for (const s of submissions) {
    if (!submissionsByGame[s.game_id]) submissionsByGame[s.game_id] = []
    submissionsByGame[s.game_id].push({ id: s.id, userId: s.user_id })
  }

  for (const gameId of Object.keys(submissionsByGame)) {
    if (!validGameIds.has(gameId)) continue
    const gameSubs = submissionsByGame[gameId]

    // 連打ゲームで決まったゲームかチェック
    const gameMashResults = mashResults.filter((r) => r.game_id === gameId)
    if (gameMashResults.length >= 2) {
      const latestRound = Math.max(...gameMashResults.map((r) => r.mash_round))
      const latestMash = gameMashResults.filter((r) => r.mash_round === latestRound)
      const isSpeedMode = latestMash.some((r) => r.completion_time_ms != null)
      let mashWinnerUserId: string | null = null
      if (isSpeedMode) {
        const minTime = Math.min(...latestMash.map((r) => r.completion_time_ms ?? Infinity))
        const winners = latestMash.filter((r) => r.completion_time_ms === minTime)
        if (winners.length === 1) mashWinnerUserId = winners[0].user_id
      } else {
        const maxTaps = Math.max(...latestMash.map((r) => r.tap_count))
        const winners = latestMash.filter((r) => r.tap_count === maxTaps)
        if (winners.length === 1) mashWinnerUserId = winners[0].user_id
      }
      if (mashWinnerUserId) {
        const winnerSub = gameSubs.find((s) => s.userId === mashWinnerUserId)
        if (winnerSub) winnersByGame[gameId] = [winnerSub.id]
      }
      continue
    }

    // 決選投票があればそちらで決定
    const tbVotesForGame = votes.filter((v) => v.game_id === gameId && v.is_tiebreaker)
    if (tbVotesForGame.length > 0) {
      const tbCount: Record<string, number> = {}
      for (const v of tbVotesForGame) {
        tbCount[v.submission_id] = (tbCount[v.submission_id] ?? 0) + 1
      }
      const maxTb = Math.max(...Object.values(tbCount), 0)
      const tbWinner = Object.entries(tbCount).find(([, c]) => c === maxTb)
      if (tbWinner) winnersByGame[gameId] = [tbWinner[0]]
      continue
    }

    // 通常投票（同票の場合は複数勝者）
    let maxVotes = 0
    for (const sub of gameSubs) {
      const cnt = voteCountBySubmission[sub.id] ?? 0
      if (cnt > maxVotes) maxVotes = cnt
    }
    if (maxVotes > 0) {
      winnersByGame[gameId] = gameSubs
        .filter((s) => (voteCountBySubmission[s.id] ?? 0) === maxVotes)
        .map((s) => s.id)
    }
  }

  // 連打ゲームの最終ラウンド勝者をゲーム別に集計
  const mashWinnerByGame: Record<string, string> = {}
  const mashParticipantsByGame: Record<string, string[]> = {}
  const gameIds = [...new Set(mashResults.map((r) => r.game_id))]
  for (const gameId of gameIds) {
    const results = mashResults.filter((r) => r.game_id === gameId)
    const latestRound = Math.max(...results.map((r) => r.mash_round))
    const latest = results.filter((r) => r.mash_round === latestRound)
    mashParticipantsByGame[gameId] = latest.map((r) => r.user_id)
    const isSpeedMode = latest.some((r) => r.completion_time_ms != null)
    if (isSpeedMode) {
      const minTime = Math.min(...latest.map((r) => r.completion_time_ms ?? Infinity))
      const winners = latest.filter((r) => r.completion_time_ms === minTime)
      if (winners.length === 1) mashWinnerByGame[gameId] = winners[0].user_id
    } else {
      const maxTaps = Math.max(...latest.map((r) => r.tap_count))
      const winners = latest.filter((r) => r.tap_count === maxTaps)
      if (winners.length === 1) mashWinnerByGame[gameId] = winners[0].user_id
    }
  }

  const stats: UserStats[] = users.map((user) => {
    // 作成札採用率
    const myCards = cards.filter((c) => c.creator_user_id === user.id)
    const myCardIds = new Set(myCards.map((c) => c.id))
    const cardsUsed = submissions.filter((s) => myCardIds.has(s.hand_card_id)).length
    const cardsCreated = myCards.length
    const cardUsageRate = cardsCreated > 0 ? cardsUsed / cardsCreated : 0

    // ヒット数（自分の作品への初回投票）
    const mySubmissions = submissions.filter((s) => s.user_id === user.id)
    let singles = 0, doubles = 0, triples = 0, homeRuns = 0
    for (const sub of mySubmissions) {
      if (!validGameIds.has(sub.game_id)) continue
      const cnt = voteCountBySubmission[sub.id] ?? 0
      if (cnt === 1) singles++
      else if (cnt === 2) doubles++
      else if (cnt === 3) triples++
      else if (cnt >= 4) homeRuns++
    }
    const totalHits = singles + doubles + triples + homeRuns

    // MVP回数（同票時は複数人がカウント）
    const mvpCount = mySubmissions.filter((s) => (winnersByGame[s.game_id] ?? []).includes(s.id)).length

    // 平均得票数（validなゲームでの作品への初回投票合計 / 出場ゲーム数）
    const gamesParticipated = mySubmissions.filter((s) => validGameIds.has(s.game_id)).length
    const totalVotesReceived = mySubmissions
      .filter((s) => validGameIds.has(s.game_id))
      .reduce((sum, sub) => sum + (voteCountBySubmission[sub.id] ?? 0), 0)
    const avgVotesPerGame = gamesParticipated > 0 ? totalVotesReceived / gamesParticipated : 0

    // 連打ゲーム勝率
    const myMashGames = Object.keys(mashParticipantsByGame).filter((gId) =>
      (mashParticipantsByGame[gId] ?? []).includes(user.id),
    )
    const buttonMashGames = myMashGames.length
    const buttonMashWins = myMashGames.filter((gId) => mashWinnerByGame[gId] === user.id).length
    const buttonMashWinRate = buttonMashGames > 0 ? buttonMashWins / buttonMashGames : 0

    // 連打回数（自分が出場した全セッション）
    const myTapRecords = mashResults.filter((r) => r.user_id === user.id)
    // 回数勝負（completion_time_ms が null）
    const countMashRecords = myTapRecords.filter((r) => !r.completion_time_ms)
    const totalTapSessions = countMashRecords.length
    const bestTapCount = totalTapSessions > 0 ? Math.max(...countMashRecords.map((r) => r.tap_count)) : 0
    const avgTapCount = totalTapSessions > 0
      ? Math.round(countMashRecords.reduce((sum, r) => sum + r.tap_count, 0) / totalTapSessions)
      : 0
    // タイム勝負（completion_time_ms が非null）
    const speedMashRecords = myTapRecords.filter((r) => r.completion_time_ms != null)
    const speedMashSessions = speedMashRecords.length
    const bestCompletionTimeMs = speedMashSessions > 0
      ? Math.min(...speedMashRecords.map((r) => r.completion_time_ms as number))
      : 0
    const avgCompletionTimeMs = speedMashSessions > 0
      ? Math.round(speedMashRecords.reduce((sum, r) => sum + (r.completion_time_ms as number), 0) / speedMashSessions)
      : 0

    // 追加指標
    const mvpWinRate = gamesParticipated > 0 ? mvpCount / gamesParticipated : 0

    const shutoutCount = mySubmissions.filter(
      (s) => validGameIds.has(s.game_id) && gamesWithVotes.has(s.game_id) && (voteCountBySubmission[s.id] ?? 0) === 0
    ).length
    const shutoutRate = gamesParticipated > 0 ? shutoutCount / gamesParticipated : 0

    const homeRunRate = gamesParticipated > 0 ? homeRuns / gamesParticipated : 0

    const preambleCount = mySubmissions.filter(
      (s) => validGameIds.has(s.game_id) && s.preamble && (s.preamble as string).trim().length > 0
    ).length
    const preambleUsageRate = gamesParticipated > 0 ? preambleCount / gamesParticipated : 0

    const maxVotesInGame = mySubmissions
      .filter((s) => validGameIds.has(s.game_id))
      .reduce((max, sub) => Math.max(max, voteCountBySubmission[sub.id] ?? 0), 0)

    // 個性指標
    const myVotesCast = initialVotes.filter((v) => v.voter_user_id === user.id && validGameIds.has(v.game_id))
    // 自分がMVPだったゲームは多数派投票率の集計から除外（自分の作品に投票できないため不公平）
    const myWinGameIds = new Set(
      mySubmissions.filter((s) => (winnersByGame[s.game_id] ?? []).includes(s.id)).map((s) => s.game_id)
    )
    const fairVotesCast = myVotesCast.filter((v) => !myWinGameIds.has(v.game_id))
    const votesCastCount = fairVotesCast.length
    const majorityVotes = fairVotesCast.filter((v) => (winnersByGame[v.game_id] ?? []).includes(v.submission_id))
    const majorityVoteRate = votesCastCount > 0 ? majorityVotes.length / votesCastCount : 0

    const loneVoteCount = myVotesCast.filter(
      (v) => (voteCountBySubmission[v.submission_id] ?? 0) === 1 && !(winnersByGame[v.game_id] ?? []).includes(v.submission_id)
    ).length

    const selfCardUsedCount = mySubmissions.filter(
      (s) => validGameIds.has(s.game_id) && myCardIds.has(s.hand_card_id)
    ).length
    const selfCardUsageRate = gamesParticipated > 0 ? selfCardUsedCount / gamesParticipated : 0

    const preambledSubs = mySubmissions.filter(
      (s) => validGameIds.has(s.game_id) && s.preamble && (s.preamble as string).trim().length > 0
    )
    const avgPreambleLength = preambledSubs.length > 0
      ? Math.round(preambledSubs.reduce((sum, s) => sum + (s.preamble as string).trim().length, 0) / preambledSubs.length)
      : 0

    return {
      userId: user.id,
      userName: user.name,
      cardUsageRate,
      cardsCreated,
      cardsUsed,
      singles,
      doubles,
      triples,
      homeRuns,
      totalHits,
      mvpCount,
      avgVotesPerGame,
      totalVotesReceived,
      gamesParticipated,
      buttonMashWins,
      buttonMashGames,
      buttonMashWinRate,
      bestTapCount,
      avgTapCount,
      totalTapSessions,
      bestCompletionTimeMs,
      avgCompletionTimeMs,
      speedMashSessions,
      mvpWinRate,
      shutoutCount,
      shutoutRate,
      homeRunRate,
      preambleCount,
      preambleUsageRate,
      maxVotesInGame,
      majorityVoteRate,
      votesCastCount,
      loneVoteCount,
      selfCardUsageRate,
      selfCardUsedCount,
      avgPreambleLength,
    }
  })

  return NextResponse.json({ stats })
}
