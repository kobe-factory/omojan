'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

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
  votes: number
  isTied: boolean
}

interface Props {
  tournamentId: string
  participants: User[]
}

export default function TournamentFinished({ tournamentId, participants }: Props) {
  const [scores, setScores] = useState<PlayerScore[]>([])
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [loading, setLoading] = useState(true)

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
        supabase.from('votes').select('game_id, submission_id, created_at').in('game_id', gameIds),
        supabase.from('submissions').select('id, game_id, user_id, hand_card_id, position').in('game_id', gameIds),
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

      // submission_id → 票数・投票時間合計
      const voteCount: Record<string, number> = {}
      const voteTimeSum: Record<string, number> = {}
      for (const v of allVotes ?? []) {
        voteCount[v.submission_id] = (voteCount[v.submission_id] ?? 0) + 1
        voteTimeSum[v.submission_id] = (voteTimeSum[v.submission_id] ?? 0) + new Date(v.created_at).getTime()
      }

      const scoreMap: Record<string, { totalVotes: number; totalVoteTimeSum: number; wins: number }> = {}
      for (const p of participants) {
        scoreMap[p.id] = { totalVotes: 0, totalVoteTimeSum: 0, wins: 0 }
      }

      const roundSummaries: RoundSummary[] = []

      for (const game of games) {
        const gameSubs = (allSubs ?? []).filter((s) => s.game_id === game.id)
        let maxVotes = 0
        let winnerTimeSum = Infinity
        let winnerSub: typeof gameSubs[0] | null = null
        let hasTie = false

        for (const sub of gameSubs) {
          const count = voteCount[sub.id] ?? 0
          const timeSum = voteTimeSum[sub.id] ?? 0
          if (scoreMap[sub.user_id]) {
            scoreMap[sub.user_id].totalVotes += count
            scoreMap[sub.user_id].totalVoteTimeSum += timeSum
          }
          if (count > maxVotes) {
            maxVotes = count
            winnerSub = sub
            winnerTimeSum = timeSum
            hasTie = false
          } else if (count === maxVotes && count > 0) {
            hasTie = true
            if (timeSum < winnerTimeSum) {
              winnerSub = sub
              winnerTimeSum = timeSum
            }
          }
        }

        if (winnerSub && scoreMap[winnerSub.user_id]) {
          scoreMap[winnerSub.user_id].wins += 1
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
          votes: maxVotes,
          isTied: hasTie,
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
        if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes
        if (a.totalVoteTimeSum !== b.totalVoteTimeSum) return a.totalVoteTimeSum - b.totalVoteTimeSum
        return b.wins - a.wins
      })

      // 総合順位の同点検出
      const totalVoteFreq: Record<number, number> = {}
      for (const s of sorted) {
        if (s.totalVotes > 0) totalVoteFreq[s.totalVotes] = (totalVoteFreq[s.totalVotes] ?? 0) + 1
      }
      const tiedTotalCounts = new Set(
        Object.entries(totalVoteFreq).filter(([, n]) => n > 1).map(([c]) => Number(c))
      )
      sorted.forEach((s) => { s.isTied = tiedTotalCounts.has(s.totalVotes) })

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

  return (
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
          <p className="text-2xl font-black text-gray-800 mb-1">{mvp.userName}</p>
          <p className="text-sm text-gray-500">
            総獲得票数 <span className="text-xl font-bold text-yellow-500">{mvp.totalVotes}</span>票
            　{mvp.wins}回戦優勝
          </p>
          {mvp.isTied && (
            <p className="text-xs text-yellow-500 mt-1">（同点・投票時間で決定）</p>
          )}
        </div>
      )}

      {/* 順位表 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">総合順位</h3>
        <div className="space-y-2">
          {scores.map((s, i) => (
            <div key={s.userId} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
              i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-gray-50' : 'bg-white'
            }`}>
              <span className={`text-sm font-bold w-6 text-center ${
                i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : 'text-gray-300'
              }`}>
                {i + 1}位
              </span>
              <span className="flex-1 text-sm font-medium text-gray-800">{s.userName}</span>
              {s.isTied && (
                <span className="text-xs text-gray-400">同点</span>
              )}
              <span className="text-xs text-gray-400">{s.wins}勝</span>
              <span className="text-sm font-bold text-emerald-600">{s.totalVotes}票</span>
            </div>
          ))}
        </div>
        {scores.some((s) => s.isTied) && (
          <p className="text-xs text-gray-400 mt-3 text-center">※同点は投票時間の早い順で順位を決定</p>
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
                  <span className="text-xs text-gray-400">{r.votes}票</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-1">お題：{r.topicText}</p>
              <p className="text-sm font-bold text-gray-800">{r.winnerText}</p>
              <p className="text-xs text-gray-400 mt-1">{r.winnerName}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
