'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import UserIcon from './UserIcon'
import Archive from './Archive'

interface User {
  id: string
  name: string
}

interface PlayerScore {
  userId: string
  userName: string
  totalVotes: number
  totalVoteTimeSum: number
  wins: number
  isTied: boolean
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
  isWinByTiebreaker: boolean
}

interface Props {
  tournamentId: string
  participants: User[]
}

export default function TournamentFinished({ tournamentId, participants }: Props) {
  const [scores, setScores] = useState<PlayerScore[]>([])
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'result' | 'archive'>('result')

  useEffect(() => {
    async function fetchData() {
      const { data: games } = await supabase
        .from('games')
        .select('id, round_number, topic_card_id, status')
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: true })

      if (!games || games.length === 0) {
        setLoading(false)
        return
      }

      const gameIds = games.map((g) => g.id)

      const [{ data: allVotes }, { data: allSubs }] = await Promise.all([
        supabase.from('votes').select('game_id, submission_id, created_at, is_tiebreaker').in('game_id', gameIds),
        supabase.from('submissions').select('id, game_id, user_id, hand_card_id, position, preamble, preamble_position').in('game_id', gameIds),
      ])

      const topicIds = games.map((g) => g.topic_card_id)
      const { data: topicCards } = await supabase
        .from('cards')
        .select('id, text')
        .in('id', topicIds)

      const handIds = (allSubs ?? []).map((s) => s.hand_card_id)
      const { data: handCards } = await supabase
        .from('cards')
        .select('id, text')
        .in('id', handIds)

      const topicMap = Object.fromEntries((topicCards ?? []).map((c) => [c.id, c.text]))
      const handMap = Object.fromEntries((handCards ?? []).map((c) => [c.id, c.text]))

      // 通常投票・決選投票を分けてカウント
      const regularVoteCount: Record<string, number> = {}
      const regularVoteTimeSum: Record<string, number> = {}
      const tiebreakerVoteCount: Record<string, number> = {}
      for (const v of allVotes ?? []) {
        if (v.is_tiebreaker) {
          tiebreakerVoteCount[v.submission_id] = (tiebreakerVoteCount[v.submission_id] ?? 0) + 1
        } else {
          regularVoteCount[v.submission_id] = (regularVoteCount[v.submission_id] ?? 0) + 1
          regularVoteTimeSum[v.submission_id] = (regularVoteTimeSum[v.submission_id] ?? 0) + new Date(v.created_at).getTime()
        }
      }

      const scoreMap: Record<string, { totalVotes: number; totalVoteTimeSum: number; wins: number }> = {}
      for (const p of participants) {
        scoreMap[p.id] = { totalVotes: 0, totalVoteTimeSum: 0, wins: 0 }
      }

      const roundSummaries: RoundSummary[] = []

      for (const game of games) {
        const gameSubs = (allSubs ?? []).filter((s) => s.game_id === game.id)
        let maxRegularVotes = 0
        let winnerTimeSum = Infinity
        let winnerSub: typeof gameSubs[0] | null = null
        let hasTie = false
        let isWinByTiebreaker = false

        // 通常投票で集計
        for (const sub of gameSubs) {
          const count = regularVoteCount[sub.id] ?? 0
          const timeSum = regularVoteTimeSum[sub.id] ?? 0
          if (scoreMap[sub.user_id]) {
            scoreMap[sub.user_id].totalVotes += count
            scoreMap[sub.user_id].totalVoteTimeSum += timeSum
          }
          if (count > maxRegularVotes) {
            maxRegularVotes = count
            winnerSub = sub
            winnerTimeSum = timeSum
            hasTie = false
          } else if (count === maxRegularVotes && count > 0) {
            hasTie = true
            if (timeSum < winnerTimeSum) {
              winnerSub = sub
              winnerTimeSum = timeSum
            }
          }
        }

        // 同票の場合は決選投票で勝者を決定
        if (hasTie) {
          let maxTbVotes = 0
          let tbWinner: typeof gameSubs[0] | null = null
          for (const sub of gameSubs) {
            const tbCount = tiebreakerVoteCount[sub.id] ?? 0
            if (tbCount > maxTbVotes) {
              maxTbVotes = tbCount
              tbWinner = sub
            }
          }
          if (tbWinner) {
            winnerSub = tbWinner
            isWinByTiebreaker = true
            hasTie = false
          }
        }

        // 表示票数: 通常最多票 + 決選投票の場合+1
        const displayVotes = maxRegularVotes + (isWinByTiebreaker ? 1 : 0)

        if (winnerSub && scoreMap[winnerSub.user_id]) {
          scoreMap[winnerSub.user_id].wins += 1
          if (isWinByTiebreaker) scoreMap[winnerSub.user_id].totalVotes += 1
        }

        const topicText = topicMap[game.topic_card_id] ?? ''
        const handText = winnerSub ? (handMap[winnerSub.hand_card_id] ?? '') : ''
        const winnerText = winnerSub
          ? winnerSub.position === 'before'
            ? `${handText}${topicText}`
            : `${topicText}${handText}`
          : ''
        const winnerUser = winnerSub ? participants.find((p) => p.id === winnerSub!.user_id) : null

        roundSummaries.push({
          roundNumber: game.round_number,
          topicText,
          winnerName: winnerUser?.name ?? '???',
          winnerText,
          winnerPreamble: winnerSub?.preamble ?? null,
          winnerPreamblePosition: (winnerSub?.preamble_position ?? 'above') as 'above' | 'below',
          votes: displayVotes,
          isTied: hasTie,
          isWinByTiebreaker,
        })
      }

      const unsorted = participants.map((p) => ({
        userId: p.id,
        userName: p.name,
        totalVotes: scoreMap[p.id]?.totalVotes ?? 0,
        totalVoteTimeSum: scoreMap[p.id]?.totalVoteTimeSum ?? 0,
        wins: scoreMap[p.id]?.wins ?? 0,
        isTied: false,
      }))

      const sorted = unsorted.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins
        if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes
        return 0
      })

      sorted.forEach((s, i) => {
        s.isTied = sorted.some((o, j) => j !== i && o.wins === s.wins && o.totalVotes === s.totalVotes)
      })

      setScores(sorted)
      setRounds(roundSummaries)
      setLoading(false)
    }

    fetchData()
  }, [tournamentId, participants])

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400">集計中...</p>
      </div>
    )
  }

  const mvp = scores[0]

  const rankList = scores.reduce<number[]>((acc, s, i) => {
    if (i === 0) return [1]
    const prev = scores[i - 1]
    const prevRank = acc[i - 1]
    if (s.wins === prev.wins && s.totalVotes === prev.totalVotes) return [...acc, prevRank]
    return [...acc, i + 1]
  }, [])

  return (
    <>
    <div className="flex border-b border-gray-200 bg-white sticky top-[77px] z-10">
      <button
        onClick={() => setActiveTab('result')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'result' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-gray-400'
        }`}
      >
        大会結果
      </button>
      <button
        onClick={() => setActiveTab('archive')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'archive' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-gray-400'
        }`}
      >
        過去結果
      </button>
    </div>

    {activeTab === 'archive' ? (
      <Archive tournamentId={tournamentId} participants={participants} />
    ) : (
    <div className="p-4 space-y-4 pb-10">
      {/* 大会終了ヘッダー */}
      <div className="text-center py-6">
        <p className="text-5xl mb-3">🎊</p>
        <p className="text-2xl font-bold text-gray-800">大会終了！</p>
        <p className="text-sm text-gray-400 mt-1">お疲れ様でした</p>
      </div>

      {/* MVP */}
      {mvp && (
        <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-5 text-center">
          <p className="text-xs font-bold text-yellow-500 mb-1">👑 MVP</p>
          <div className="flex items-center justify-center gap-2 mb-1">
            <UserIcon name={mvp.userName} size="lg" />
            <p className="text-2xl font-black text-gray-800">{mvp.userName}</p>
          </div>
          <p className="text-sm text-gray-500">
            <span className="text-xl font-bold text-yellow-500">{mvp.wins}</span>勝
            　総得票数 <span className="text-xl font-bold text-emerald-600">{mvp.totalVotes}</span>票
          </p>
          {mvp.isTied && (
            <p className="text-xs text-yellow-500 mt-1">（同点）</p>
          )}
        </div>
      )}

      {/* 順位表 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">総合順位</h3>
        <div className="space-y-2">
          {scores.map((s, i) => {
            const rank = rankList[i]
            return (
            <div key={s.userId} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
              rank === 1 ? 'bg-yellow-50' : rank === 2 ? 'bg-gray-50' : 'bg-white'
            }`}>
              <span className={`text-sm font-bold w-6 text-center ${
                rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-gray-400' : 'text-gray-300'
              }`}>
                {rank}位
              </span>
              <div className="flex items-center gap-2 flex-1">
                <UserIcon name={s.userName} size="xs" />
                <span className="text-sm font-medium text-gray-800">{s.userName}</span>
              </div>
              {s.isTied && (
                <span className="text-xs text-gray-400">同点</span>
              )}
              <span className="text-xs text-gray-400">{s.wins}勝</span>
              <span className="text-sm font-bold text-emerald-600">{s.totalVotes}票</span>
            </div>
            )
          })}
        </div>
        {scores.some((s) => s.isTied) && (
          <p className="text-xs text-gray-400 mt-3 text-center">※勝数→得票数で順位を決定</p>
        )}
      </div>

      {/* 回戦別結果 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">回戦別MVP</h3>
        <div className="space-y-3">
          {rounds.map((r) => (
            <div key={r.roundNumber} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-emerald-600">第{r.roundNumber}回戦</span>
                <div className="flex items-center gap-2">
                  {r.isTied && (
                    <span className="text-xs text-gray-400">（同点・投票時間で決定）</span>
                  )}
                  {r.isWinByTiebreaker && (
                    <span className="text-[9px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full">決選</span>
                  )}
                  <span className="text-xs text-gray-400">{r.votes}票</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-2">お題：{r.topicText}</p>
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
                <p className="text-xs text-gray-400">{r.winnerName}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    )}
    </>
  )
}
