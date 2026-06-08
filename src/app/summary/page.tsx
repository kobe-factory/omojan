'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import UserIcon from '@/components/UserIcon'
import PersonalStats from '@/components/PersonalStats'

interface User {
  id: string
  name: string
}

interface RoundSummary {
  roundNumber: number
  topicText: string
  winnerName: string
  winnerText: string
  winnerPreamble: string | null
  winnerPreamblePosition: 'above' | 'below'
  votes: number
  isTied: boolean
  votingMode: string | null
  isWinByButtonMash: boolean
}

interface TournamentScore {
  userId: string
  userName: string
  totalVotes: number
  wins: number
  isTied: boolean
}

interface TournamentSummary {
  tournamentId: string
  tournamentNumber: number
  createdAt: string
  token: string
  participants: User[]
  scores: TournamentScore[]
  rounds: RoundSummary[]
  randomVoting: boolean
  impersonationMode: boolean
  secretVoting: boolean
  secretRound: number | null
}

interface OverallStanding {
  userId: string
  userName: string
  totalVotes: number
  totalWins: number
  totalRoundWins: number
  isTied: boolean
}

export default function SummaryPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([])
  const [overallStandings, setOverallStandings] = useState<OverallStanding[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'summary' | 'stats'>('summary')

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    const { data: finishedTournaments } = await supabase
      .from('tournaments')
      .select('id, created_at, token, random_voting, impersonation_mode, secret_voting, secret_round')
      .eq('mode', 'production')
      .eq('status', 'finished')
      .order('created_at', { ascending: true })

    if (!finishedTournaments || finishedTournaments.length === 0) {
      setLoading(false)
      return
    }

    const tournamentIds = finishedTournaments.map((t) => t.id)

    const [{ data: allParticipants }, { data: allGames }] = await Promise.all([
      supabase
        .from('tournament_participants')
        .select('tournament_id, users(id, name)')
        .in('tournament_id', tournamentIds),
      supabase
        .from('games')
        .select('id, tournament_id, round_number, topic_card_id, voting_mode, is_rematch')
        .in('tournament_id', tournamentIds)
        .order('round_number', { ascending: true }),
    ])

    const gameIds = (allGames ?? []).map((g) => g.id)

    const [{ data: allSubs }, { data: allVotes }, { data: allMashResults }] = await Promise.all([
      supabase.from('submissions').select('id, game_id, user_id, hand_card_id, position, preamble, preamble_position').in('game_id', gameIds),
      supabase.from('votes').select('game_id, submission_id, is_tiebreaker').in('game_id', gameIds),
      supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round').in('game_id', gameIds),
    ])

    // ゲーム別の連打ゲーム勝者を集計
    const mashWinnerByGame: Record<string, string> = {}
    const mashGameIds = [...new Set((allMashResults ?? []).map((r) => r.game_id))]
    for (const gameId of mashGameIds) {
      const results = (allMashResults ?? []).filter((r) => r.game_id === gameId)
      const latestRound = Math.max(...results.map((r) => r.mash_round))
      const latest = results.filter((r) => r.mash_round === latestRound)
      const maxTaps = Math.max(...latest.map((r) => r.tap_count))
      const winners = latest.filter((r) => r.tap_count === maxTaps)
      if (winners.length === 1) mashWinnerByGame[gameId] = winners[0].user_id
    }

    const topicIds = (allGames ?? []).map((g) => g.topic_card_id)
    const handIds = (allSubs ?? []).map((s) => s.hand_card_id)
    const { data: allCards } = await supabase
      .from('cards')
      .select('id, text')
      .in('id', [...new Set([...topicIds, ...handIds])])

    const cardMap = Object.fromEntries((allCards ?? []).map((c) => [c.id, c.text]))

    const regularVoteCount: Record<string, number> = {}
    const tiebreakerVoteCount: Record<string, number> = {}
    for (const v of allVotes ?? []) {
      if (v.is_tiebreaker) {
        tiebreakerVoteCount[v.submission_id] = (tiebreakerVoteCount[v.submission_id] ?? 0) + 1
      } else {
        regularVoteCount[v.submission_id] = (regularVoteCount[v.submission_id] ?? 0) + 1
      }
    }

    const overallMap: Record<string, { name: string; totalVotes: number; totalWins: number; totalRoundWins: number }> = {}

    const tournamentSummaries: TournamentSummary[] = finishedTournaments.map((t, idx) => {
      const participants = (allParticipants ?? [])
        .filter((p) => p.tournament_id === t.id)
        .map((p) => p.users as unknown as User)
        .filter(Boolean)

      const allTournamentGames = (allGames ?? []).filter((g) => g.tournament_id === t.id)
      // 流局（再戦あり）の無効ゲームを除外（analyticsと同ロジック）
      const rematchRounds = new Set(
        allTournamentGames.filter((g) => g.is_rematch).map((g) => g.round_number)
      )
      const games = allTournamentGames.filter(
        (g) => !(g.is_rematch === false && rematchRounds.has(g.round_number))
      )

      const scoreMap: Record<string, { totalVotes: number; wins: number }> = {}
      for (const p of participants) {
        scoreMap[p.id] = { totalVotes: 0, wins: 0 }
        if (!overallMap[p.id]) overallMap[p.id] = { name: p.name, totalVotes: 0, totalWins: 0, totalRoundWins: 0 }
      }

      const rounds: RoundSummary[] = []
      for (const game of games) {
        const gameSubs = (allSubs ?? []).filter((s) => s.game_id === game.id)
        let maxRegularVotes = 0
        let winnerSub: typeof gameSubs[0] | null = null
        let hasTie = false
        let isWinByTiebreaker = false

        for (const sub of gameSubs) {
          const count = regularVoteCount[sub.id] ?? 0
          if (scoreMap[sub.user_id]) scoreMap[sub.user_id].totalVotes += count
          if (overallMap[sub.user_id]) overallMap[sub.user_id].totalVotes += count
          if (count > maxRegularVotes) {
            maxRegularVotes = count; winnerSub = sub; hasTie = false
          } else if (count === maxRegularVotes && count > 0) {
            hasTie = true
          }
        }

        // 連打ゲームで決まった場合は勝者を上書き
        let isWinByButtonMash = false
        const mashWinnerUserId = mashWinnerByGame[game.id]
        if (hasTie && mashWinnerUserId) {
          const mashWinnerSub = gameSubs.find((s) => s.user_id === mashWinnerUserId)
          if (mashWinnerSub) { winnerSub = mashWinnerSub; isWinByButtonMash = true; hasTie = false }
        }

        if (!isWinByButtonMash && hasTie) {
          let maxTbVotes = 0
          let tbWinner: typeof gameSubs[0] | null = null
          for (const sub of gameSubs) {
            const tbCount = tiebreakerVoteCount[sub.id] ?? 0
            if (tbCount > maxTbVotes) { maxTbVotes = tbCount; tbWinner = sub }
          }
          if (tbWinner) { winnerSub = tbWinner; isWinByTiebreaker = true; hasTie = false }
        }

        const topicText = cardMap[game.topic_card_id] ?? ''
        const votingMode = (game as { voting_mode?: string | null }).voting_mode ?? null

        if (hasTie) {
          // 決戦なし同票：全員が1位
          const tiedSubs = gameSubs.filter((s) => (regularVoteCount[s.id] ?? 0) === maxRegularVotes)
          for (const ts of tiedSubs) {
            if (scoreMap[ts.user_id]) scoreMap[ts.user_id].wins += 1
            if (overallMap[ts.user_id]) overallMap[ts.user_id].totalRoundWins += 1
          }
          const tiedNames = tiedSubs.map((ts) => participants.find((p) => p.id === ts.user_id)?.name ?? '???').join('・')
          rounds.push({ roundNumber: game.round_number, topicText, winnerName: tiedNames, winnerText: '', winnerPreamble: null, winnerPreamblePosition: 'above', votes: maxRegularVotes, isTied: true, votingMode, isWinByButtonMash: false })
        } else {
          // 単独1位または決戦で決定
          if (winnerSub && scoreMap[winnerSub.user_id]) {
            scoreMap[winnerSub.user_id].wins += 1
            if (isWinByTiebreaker) scoreMap[winnerSub.user_id].totalVotes += 1
          }
          if (winnerSub && overallMap[winnerSub.user_id]) {
            overallMap[winnerSub.user_id].totalRoundWins += 1
            if (isWinByTiebreaker) overallMap[winnerSub.user_id].totalVotes += 1
          }
          const handText = winnerSub ? (cardMap[winnerSub.hand_card_id] ?? '') : ''
          const winnerText = winnerSub
            ? winnerSub.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`
            : ''
          const winnerUser = winnerSub ? participants.find((p) => p.id === winnerSub!.user_id) : null
          const displayVotes = maxRegularVotes + (isWinByTiebreaker ? 1 : 0)
          rounds.push({ roundNumber: game.round_number, topicText, winnerName: winnerUser?.name ?? '???', winnerText, winnerPreamble: winnerSub?.preamble ?? null, winnerPreamblePosition: (winnerSub?.preamble_position ?? 'above') as 'above' | 'below', votes: displayVotes, isTied: false, votingMode, isWinByButtonMash })
        }
      }

      const sortedScores = participants
        .map((p) => ({
          userId: p.id,
          userName: p.name,
          totalVotes: scoreMap[p.id]?.totalVotes ?? 0,
          wins: scoreMap[p.id]?.wins ?? 0,
          isTied: false,
        }))
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins
          if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes
          return 0
        })

      if (sortedScores.length > 0 && sortedScores[0].wins > 0 && overallMap[sortedScores[0].userId]) {
        overallMap[sortedScores[0].userId].totalWins += 1
      }

      sortedScores.forEach((s, i) => {
        s.isTied = sortedScores.some((o, j) => j !== i && o.wins === s.wins && o.totalVotes === s.totalVotes)
      })

      return {
        tournamentId: t.id,
        tournamentNumber: idx + 1,
        createdAt: t.created_at,
        token: t.token,
        participants,
        scores: sortedScores,
        rounds,
        randomVoting: (t as { random_voting?: boolean }).random_voting ?? false,
        impersonationMode: (t as { impersonation_mode?: boolean }).impersonation_mode ?? false,
        secretVoting: (t as { secret_voting?: boolean }).secret_voting ?? false,
        secretRound: (t as { secret_round?: number | null }).secret_round ?? null,
      }
    })

    const overall = Object.entries(overallMap)
      .map(([userId, d]) => ({ userId, userName: d.name, totalVotes: d.totalVotes, totalWins: d.totalWins, totalRoundWins: d.totalRoundWins, isTied: false }))
      .sort((a, b) => {
        if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins
        if (b.totalRoundWins !== a.totalRoundWins) return b.totalRoundWins - a.totalRoundWins
        if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes
        return 0
      })

    overall.forEach((s, i) => {
      s.isTied = overall.some((o, j) => j !== i && o.totalWins === s.totalWins && o.totalRoundWins === s.totalRoundWins && o.totalVotes === s.totalVotes)
    })

    setTournaments(tournamentSummaries)
    setOverallStandings(overall)
    if (tournamentSummaries.length > 0) setExpandedId(tournamentSummaries[tournamentSummaries.length - 1].tournamentId)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">集計中...</p>
      </div>
    )
  }

  const mvp = overallStandings[0]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white sticky top-0 z-10 border-b border-gray-200">
        <div className="px-4 py-3 max-w-md mx-auto">
          <p className="text-[10px] text-gray-400">おもじゃん for 男根祭</p>
          <p className="text-base font-bold text-gray-800">全大会サマリ</p>
        </div>
        <div className="flex border-t border-gray-100 max-w-md mx-auto">
          {([
            { key: 'summary', label: '総合結果' },
            { key: 'stats', label: '個人成績' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'stats' && <PersonalStats />}

      {activeTab === 'summary' && <div className="max-w-md mx-auto p-4 space-y-4 pb-10">
        {tournaments.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🎴</p>
            <p className="text-gray-500">終了した本番大会がありません</p>
          </div>
        ) : (
          <>
            {/* 全大会MVP */}
            {mvp && mvp.totalVotes > 0 && (
              <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-5 text-center">
                <p className="text-xs font-bold text-yellow-500 mb-2">👑 総合MVP</p>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <UserIcon name={mvp.userName} size="lg" />
                  <p className="text-2xl font-black text-gray-800">{mvp.userName}</p>
                </div>
                <p className="text-sm text-gray-500">
                  <span className="text-xl font-bold text-yellow-500">{mvp.totalWins}</span>大会優勝
                  　<span className="text-xl font-bold text-yellow-500">{mvp.totalRoundWins}</span>勝
                  　総得票数 <span className="text-base font-bold text-emerald-600">{mvp.totalVotes}</span>票
                </p>
                {mvp.isTied && <p className="text-xs text-yellow-500 mt-1">（同点）</p>}
              </div>
            )}

            {/* 全体順位 */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-3">全体順位</h3>
              <div className="space-y-2">
                {(() => {
                  const overallRanks = overallStandings.reduce<number[]>((acc, s, i) => {
                    if (i === 0) return [1]
                    const prev = overallStandings[i - 1]
                    const prevRank = acc[i - 1]
                    if (s.totalWins === prev.totalWins && s.totalRoundWins === prev.totalRoundWins && s.totalVotes === prev.totalVotes) return [...acc, prevRank]
                    return [...acc, i + 1]
                  }, [])
                  return overallStandings.map((s, i) => {
                    const rank = overallRanks[i]
                    return (
                  <div key={s.userId} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${rank === 1 ? 'bg-yellow-50' : rank === 2 ? 'bg-gray-50' : 'bg-white'}`}>
                    <span className={`text-sm font-bold w-6 text-center ${rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-gray-400' : 'text-gray-300'}`}>{rank}位</span>
                    <div className="flex items-center gap-2 flex-1">
                      <UserIcon name={s.userName} size="xs" />
                      <span className="text-sm font-medium text-gray-800">{s.userName}</span>
                    </div>
                    {s.isTied && <span className="text-xs text-gray-400">同点</span>}
                    <span className="text-xs text-gray-400"><span className="text-base font-bold text-yellow-500">{s.totalWins}</span>大会優勝</span>
                    <span className="text-xs text-gray-400"><span className="text-base font-bold text-yellow-500">{s.totalRoundWins}</span>勝</span>
                    <span className="text-xs font-bold text-emerald-600">{s.totalVotes}票</span>
                  </div>
                    )
                  })
                })()}
              </div>
              {overallStandings.some((s) => s.isTied) && (
                <p className="text-xs text-gray-400 mt-3 text-center">※大会優勝数→回戦勝数→得票数で順位を決定</p>
              )}
            </div>

            {/* 大会別サマリ */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-600">大会別サマリ</h3>
              {tournaments.map((t) => {
                const isOpen = expandedId === t.tournamentId
                const winner = t.scores[0]
                return (
                  <div key={t.tournamentId} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <button
                      onClick={() => setExpandedId(isOpen ? null : t.tournamentId)}
                      className="w-full p-4 text-left flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-gray-700">第{t.tournamentNumber}回大会</span>
                          {t.randomVoting && (
                            <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">🎲 ランダム</span>
                          )}
                          {!t.randomVoting && t.impersonationMode && (
                            <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">🎭 なりすまし</span>
                          )}
                          {!t.randomVoting && t.secretVoting && t.secretRound === null && (
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">🕵️ 全回シークレット</span>
                          )}
                          {!t.randomVoting && t.secretVoting && t.secretRound !== null && (
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">🕵️ 第{t.secretRound}回シークレット</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(t.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                        {winner && winner.wins > 0 && (
                          <p className="text-xs text-yellow-600 mt-1">👑 {winner.userName}（{winner.wins}勝 / {winner.totalVotes}票）</p>
                        )}
                      </div>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {isOpen && (
                      <div className="border-t border-gray-100 p-4 space-y-4">
                        {/* 大会順位 */}
                        <div>
                          <p className="text-xs font-bold text-gray-500 mb-2">順位</p>
                          <div className="space-y-1.5">
                            {(() => {
                              const tRanks = t.scores.reduce<number[]>((acc, s, i) => {
                                if (i === 0) return [1]
                                const prev = t.scores[i - 1]
                                const prevRank = acc[i - 1]
                                if (s.wins === prev.wins && s.totalVotes === prev.totalVotes) return [...acc, prevRank]
                                return [...acc, i + 1]
                              }, [])
                              return t.scores.map((s, i) => {
                                const rank = tRanks[i]
                                return (
                                <div key={s.userId} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${rank === 1 ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                                  <span className={`text-xs font-bold w-6 text-center ${rank === 1 ? 'text-yellow-500' : 'text-gray-400'}`}>{rank}位</span>
                                  <div className="flex items-center gap-1.5 flex-1">
                                    <UserIcon name={s.userName} size="xs" />
                                    <span className="text-xs font-medium text-gray-700">{s.userName}</span>
                                  </div>
                                  {s.isTied && <span className="text-xs text-gray-400">同点</span>}
                                  <span className="text-xs text-gray-400">{s.wins}勝</span>
                                  <span className="text-xs font-bold text-emerald-600">{s.totalVotes}票</span>
                                </div>
                                )
                              })
                            })()}
                          </div>
                        </div>

                        {/* 大会結果詳細リンク */}
                        <a
                          href={`/${t.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 text-center text-sm font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors block"
                        >
                          大会結果詳細を見る →
                        </a>

                        {/* 回戦別MVP */}
                        <div>
                          <p className="text-xs font-bold text-gray-500 mb-2">回戦別MVP</p>
                          <div className="space-y-2">
                            {t.rounds.map((r) => (
                              <div key={r.roundNumber} className="border border-gray-100 rounded-xl p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-emerald-600">第{r.roundNumber}回戦</span>
                                    {r.votingMode === 'normal' && (
                                      <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">🎯 通常モード</span>
                                    )}
                                    {r.votingMode === 'secret' && (
                                      <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">🕵️ シークレット</span>
                                    )}
                                    {r.votingMode === 'impersonation' && (
                                      <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">🎭 なりすまし</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {r.isTied && <span className="text-xs text-orange-400 font-bold">同票</span>}
                                    {r.isWinByButtonMash && (
                                      <span className="text-[9px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">⚡連打</span>
                                    )}
                                    <span className="text-xs text-gray-400">{r.votes}票</span>
                                  </div>
                                </div>
                                <p className="text-xs text-gray-400 mb-2">お題：{r.topicText}</p>
                                {r.isTied ? (
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {r.winnerName.split('・').map((name) => (
                                      <div key={name} className="flex items-center gap-1.5">
                                        <UserIcon name={name} size="xs" />
                                        <p className="text-xs text-gray-600">{name}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <>
                                    <div className="bg-yellow-50 rounded-xl px-3 py-2">
                                      {r.winnerPreamble && r.winnerPreamblePosition === 'above' && (
                                        <p className="text-xs text-gray-500 italic mb-1">「{r.winnerPreamble}」</p>
                                      )}
                                      <p className="text-sm font-bold text-gray-800">{r.winnerText}</p>
                                      {r.winnerPreamble && r.winnerPreamblePosition === 'below' && (
                                        <p className="text-xs text-gray-500 italic mt-1">「{r.winnerPreamble}」</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-3">
                                      <UserIcon name={r.winnerName} size="xs" />
                                      <p className="text-xs text-gray-600">{r.winnerName}</p>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>}

      <footer className="text-center py-4">
        <p className="text-xs text-gray-300">v1.36.0</p>
      </footer>
    </div>
  )
}
