'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import UserIcon from './UserIcon'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
  game_count: number
}

interface Game {
  id: string
  round_number: number
  topic_card_id: string
}

interface ResultItem {
  submissionId: string
  userId: string
  userName: string
  topicText: string
  handText: string
  position: 'before' | 'after'
  preamble: string | null
  voteCount: number
  voteTimeSum: number
  isWinner: boolean
  isTied: boolean
}

interface Props {
  tournament: Tournament
  token: string
  game: Game
  currentUserId: string
  participants: User[]
  onNext: () => Promise<void>
  nextLabel?: string
}

export default function Results({ tournament, game, participants, onNext, nextLabel }: Props) {
  const [results, setResults] = useState<ResultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)

  useEffect(() => {
    async function fetchResults() {
      const [{ data: topicCard }, { data: subs }, { data: votes }] = await Promise.all([
        supabase.from('cards').select('text').eq('id', game.topic_card_id).single(),
        supabase.from('submissions').select('id, user_id, hand_card_id, position, preamble').eq('game_id', game.id),
        supabase.from('votes').select('submission_id, created_at').eq('game_id', game.id),
      ])

      const topicText = topicCard?.text ?? ''

      const voteCount: Record<string, number> = {}
      const voteTimeSum: Record<string, number> = {}
      for (const v of votes ?? []) {
        voteCount[v.submission_id] = (voteCount[v.submission_id] ?? 0) + 1
        voteTimeSum[v.submission_id] = (voteTimeSum[v.submission_id] ?? 0) + new Date(v.created_at).getTime()
      }

      const maxVotes = Math.max(...Object.values(voteCount), 0)

      const items: ResultItem[] = await Promise.all(
        (subs ?? []).map(async (s) => {
          const { data: card } = await supabase.from('cards').select('text').eq('id', s.hand_card_id).single()
          const user = participants.find((p) => p.id === s.user_id)
          const count = voteCount[s.id] ?? 0
          return {
            submissionId: s.id,
            userId: s.user_id,
            userName: user?.name ?? '???',
            topicText,
            handText: card?.text ?? '',
            position: s.position as 'before' | 'after',
            preamble: s.preamble,
            voteCount: count,
            voteTimeSum: voteTimeSum[s.id] ?? 0,
            isWinner: false,
            isTied: false,
          }
        })
      )

      const sorted = items.sort((a, b) => {
        if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount
        return a.voteTimeSum - b.voteTimeSum
      })

      // 同点グループ検出（0票は対象外）
      const countFreq: Record<number, number> = {}
      for (const item of sorted) {
        if (item.voteCount > 0) countFreq[item.voteCount] = (countFreq[item.voteCount] ?? 0) + 1
      }
      const tiedCounts = new Set(Object.entries(countFreq).filter(([, n]) => n > 1).map(([c]) => Number(c)))

      sorted.forEach((item, i) => {
        item.isWinner = i === 0 && maxVotes > 0
        item.isTied = tiedCounts.has(item.voteCount)
      })

      setResults(sorted)
      setLoading(false)
    }

    fetchResults()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, game.topic_card_id, participants])

  async function handleNext() {
    setAdvancing(true)
    await onNext()
    setAdvancing(false)
  }

  const isLastRound = game.round_number >= tournament.game_count

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400">結果を集計中...</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="text-center py-6">
        <p className="text-5xl mb-2">🎊</p>
        <p className="text-xl font-bold text-gray-800">第{game.round_number}回戦 結果発表！</p>
      </div>

      <div className="space-y-3">
        {results.map((r, i) => {
          return (
            <div
              key={r.submissionId}
              className={`rounded-2xl p-4 border-2 ${
                r.isWinner ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
              }`}
            >
              {r.isWinner && (
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-yellow-500 text-lg">👑</span>
                  <span className="text-yellow-600 text-xs font-bold">WINNER</span>
                  {r.isTied && (
                    <span className="text-yellow-500 text-xs ml-1">（同点・投票時間で決定）</span>
                  )}
                </div>
              )}

              <div className="flex items-start justify-between gap-2 mb-3">
                <span className="text-gray-400 text-xs">{i + 1}位</span>
                <span className="text-emerald-500 text-sm font-bold">{r.voteCount}票</span>
              </div>

              {/* 作品（お題＋手札の組み合わせ） */}
              <p className="text-lg font-bold text-gray-800 mb-3">
                {r.position === 'before' ? `${r.handText}${r.topicText}` : `${r.topicText}${r.handText}`}
              </p>

              {r.preamble && (
                <p className="text-sm text-gray-500 italic mb-2">「{r.preamble}」</p>
              )}
              <div className="flex items-center gap-1.5">
                <UserIcon name={r.userName} size="xs" />
                <p className="text-xs text-gray-400">{r.userName}</p>
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={handleNext}
        disabled={advancing}
        className="w-full py-4 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50"
      >
        {advancing ? '移動中...' : nextLabel ?? (isLastRound ? '大会結果へ' : `第${game.round_number + 1}回戦へ`)}
      </button>
    </div>
  )
}
