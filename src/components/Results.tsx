'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

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
  isWinner: boolean
}

interface Props {
  tournament: Tournament
  token: string
  game: Game
  currentUserId: string
  participants: User[]
  onNext: () => Promise<void>
}

export default function Results({ tournament, game, participants, onNext }: Props) {
  const [results, setResults] = useState<ResultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)

  const cookieKey = `omojan:result:${game.id}`
  const isFirstView = typeof document !== 'undefined' && !document.cookie.includes(cookieKey)

  useEffect(() => {
    if (isFirstView) {
      document.cookie = `${cookieKey}=1; path=/; max-age=86400`
    }

    async function fetchResults() {
      const [{ data: topicCard }, { data: subs }, { data: votes }] = await Promise.all([
        supabase.from('cards').select('text').eq('id', game.topic_card_id).single(),
        supabase.from('submissions').select('id, user_id, hand_card_id, position, preamble').eq('game_id', game.id),
        supabase.from('votes').select('submission_id').eq('game_id', game.id),
      ])

      const topicText = topicCard?.text ?? ''

      const voteCount: Record<string, number> = {}
      for (const v of votes ?? []) {
        voteCount[v.submission_id] = (voteCount[v.submission_id] ?? 0) + 1
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
            isWinner: count === maxVotes && maxVotes > 0,
          }
        })
      )

      setResults(items.sort((a, b) => b.voteCount - a.voteCount))
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
      {isFirstView && (
        <div className="text-center py-6">
          <p className="text-5xl mb-2">🎊</p>
          <p className="text-xl font-bold text-gray-800">第{game.round_number}回戦 結果発表！</p>
        </div>
      )}

      <div className="space-y-3">
        {results.map((r, i) => {
          const before = r.position === 'before' ? r.handText : r.topicText
          const after = r.position === 'before' ? r.topicText : r.handText
          const beforeIsHand = r.position === 'before'

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
                </div>
              )}

              <div className="flex items-start justify-between gap-2 mb-3">
                <span className="text-gray-400 text-xs">{i + 1}位</span>
                <span className="text-emerald-500 text-sm font-bold">{r.voteCount}票</span>
              </div>

              {/* 作品（お題＋手札の組み合わせ） */}
              <div className="flex items-center flex-wrap gap-1 mb-3">
                <span
                  className={`px-2 py-1 rounded-lg text-base font-bold ${
                    beforeIsHand
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {before}
                </span>
<span
                  className={`px-2 py-1 rounded-lg text-base font-bold ${
                    beforeIsHand
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {after}
                </span>
              </div>

              {/* 凡例 */}
              <div className="flex gap-3 text-xs text-gray-400 mb-2">
                <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-200 mr-1" />手札</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-yellow-200 mr-1" />お題</span>
              </div>

              {r.preamble && (
                <p className="text-sm text-gray-500 italic mb-2">「{r.preamble}」</p>
              )}
              <p className="text-xs text-gray-400">{r.userName}</p>
            </div>
          )
        })}
      </div>

      <button
        onClick={handleNext}
        disabled={advancing}
        className="w-full py-4 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50"
      >
        {advancing ? '移動中...' : isLastRound ? '大会終了' : `第${game.round_number + 1}回戦へ`}
      </button>
    </div>
  )
}
