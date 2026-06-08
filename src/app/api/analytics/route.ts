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
  // 連打回数
  bestTapCount: number     // 最高連打数（1セッション）
  avgTapCount: number      // 平均連打数
  totalTapSessions: number // 出場セッション数
  // 追加指標
  mvpWinRate: number       // MVP勝率 = mvpCount / gamesParticipated
  shutoutCount: number     // 完封（0票）回数
  shutoutRate: number      // 完封率
  homeRunRate: number      // ホームラン率 = homeRuns / gamesParticipated
  preambleCount: number    // 前口上使用回数
  preambleUsageRate: number // 前口上使用率
  maxVotesInGame: number   // 1ゲームでの最高得票数
}

export async function GET() {
  // 全ユーザー取得
  const { data: users } = await supabase.from('users').select('id, name')
  if (!users || users.length === 0) {
    return NextResponse.json({ stats: [] })
  }

  // 本番大会のみ対象
  const { data: prodTournaments } = await supabase
    .from('tournaments')
    .select('id')
    .eq('mode', 'production')
  const prodTournamentIds = (prodTournaments ?? []).map((t) => t.id)
  if (prodTournamentIds.length === 0) {
    return NextResponse.json({ stats: users.map((u) => ({ userId: u.id, userName: u.name, cardUsageRate: 0, cardsCreated: 0, cardsUsed: 0, singles: 0, doubles: 0, triples: 0, homeRuns: 0, totalHits: 0, mvpCount: 0, avgVotesPerGame: 0, totalVotesReceived: 0, gamesParticipated: 0, buttonMashWins: 0, buttonMashGames: 0, buttonMashWinRate: 0, bestTapCount: 0, avgTapCount: 0, totalTapSessions: 0, mvpWinRate: 0, shutoutCount: 0, shutoutRate: 0, homeRunRate: 0, preambleCount: 0, preambleUsageRate: 0, maxVotesInGame: 0 })) })
  }

  // 本番大会の全ゲームIDを取得（status問わず。summary pageと同じ集計範囲にする）
  const { data: prodGames } = await supabase
    .from('games')
    .select('id, is_rematch, round_number')
    .in('tournament_id', prodTournamentIds)
  const prodGameIds = (prodGames ?? []).map((g) => g.id)

  // 流局で再戦になった回戦のround_numberを特定して流局ゲームを除外（summaryと同ロジック）
  const rematchRoundNumbers = new Set(
    (prodGames ?? []).filter((g) => g.is_rematch).map((g) => g.round_number),
  )
  const validGameIds = new Set(
    (prodGames ?? [])
      .filter((g) => !(g.is_rematch === false && rematchRoundNumbers.has(g.round_number)))
      .map((g) => g.id),
  )

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
    prodGameIds.length > 0 ? supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round').in('game_id', prodGameIds) : Promise.resolve({ data: [] }),
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
      const maxTaps = Math.max(...latestMash.map((r) => r.tap_count))
      const mashWinner = latestMash.find((r) => r.tap_count === maxTaps)
      if (mashWinner) {
        const winnerSub = gameSubs.find((s) => s.userId === mashWinner.user_id)
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
    const maxTaps = Math.max(...latest.map((r) => r.tap_count))
    const winner = latest.find((r) => r.tap_count === maxTaps)
    if (winner && latest.filter((r) => r.tap_count === maxTaps).length === 1) {
      mashWinnerByGame[gameId] = winner.user_id
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
    const totalTapSessions = myTapRecords.length
    const bestTapCount = totalTapSessions > 0 ? Math.max(...myTapRecords.map((r) => r.tap_count)) : 0
    const avgTapCount = totalTapSessions > 0
      ? Math.round(myTapRecords.reduce((sum, r) => sum + r.tap_count, 0) / totalTapSessions)
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
      mvpWinRate,
      shutoutCount,
      shutoutRate,
      homeRunRate,
      preambleCount,
      preambleUsageRate,
      maxVotesInGame,
    }
  })

  return NextResponse.json({ stats })
}
