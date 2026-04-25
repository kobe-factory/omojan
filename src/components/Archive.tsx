'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface User {
  id: string
  name: string
}

interface ArchiveGame {
  id: string
  round_number: number
  topic_card_id: string
  topicText: string
  submissions: ArchiveSubmission[]
}

interface ArchiveSubmission {
  id: string
  userId: string
  userName: string
  fullText: string
  preamble: string | null
  voteCount: number
  isWinner: boolean
}

interface Props {
  tournamentId: string
  participants: User[]
}

export default function Archive({ tournamentId, participants }: Props) {
  const [games, setGames] = useState<ArchiveGame[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGame, setExpandedGame] = useState<string | null>(null)

  useEffect(() => {
    async function fetchArchive() {
      const { data: finishedGames } = await supabase
        .from('games')
        .select('id, round_number, topic_card_id, status')
        .eq('tournament_id', tournamentId)
        .in('status', ['showing_result', 'finished'])
        .order('round_number', { ascending: true })

      if (!finishedGames) {
        setLoading(false)
        return
      }

      const result: ArchiveGame[] = await Promise.all(
        finishedGames.map(async (g) => {
          const [{ data: topicCard }, { data: subs }, { data: votes }] = await Promise.all([
            supabase.from('cards').select('text').eq('id', g.topic_card_id).single(),
            supabase.from('submissions').select('id, user_id, hand_card_id, position, preamble').eq('game_id', g.id),
            supabase.from('votes').select('submission_id').eq('game_id', g.id),
          ])

          const voteCount: Record<string, number> = {}
          for (const v of votes ?? []) {
            voteCount[v.submission_id] = (voteCount[v.submission_id] ?? 0) + 1
          }
          const maxVotes = Math.max(...Object.values(voteCount), 0)

          const submissions: ArchiveSubmission[] = await Promise.all(
            (subs ?? []).map(async (s) => {
              const { data: card } = await supabase
                .from('cards')
                .select('text')
                .eq('id', s.hand_card_id)
                .single()

              const user = participants.find((p) => p.id === s.user_id)
              const handText = card?.text ?? ''
              const topicText = topicCard?.text ?? ''
              const fullText =
                s.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`

              const count = voteCount[s.id] ?? 0
              return {
                id: s.id,
                userId: s.user_id,
                userName: user?.name ?? '???',
                fullText,
                preamble: s.preamble,
                voteCount: count,
                isWinner: count === maxVotes && maxVotes > 0,
              }
            })
          )

          return {
            id: g.id,
            round_number: g.round_number,
            topic_card_id: g.topic_card_id,
            topicText: topicCard?.text ?? '',
            submissions: submissions.sort((a, b) => b.voteCount - a.voteCount),
          }
        })
      )

      setGames(result)
      if (result.length > 0) setExpandedGame(result[result.length - 1].id)
      setLoading(false)
    }

    fetchArchive()
  }, [tournamentId, participants])

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    )
  }

  if (games.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400">まだ結果がありません</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-600">過去の結果</h2>
      {games.map((g) => {
        const winner = g.submissions.find((s) => s.isWinner)
        const isOpen = expandedGame === g.id

        return (
          <div key={g.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button
              onClick={() => setExpandedGame(isOpen ? null : g.id)}
              className="w-full p-4 text-left flex items-center justify-between"
            >
              <div>
                <span className="text-sm font-bold text-gray-700">第{g.round_number}回戦</span>
                <p className="text-xs text-gray-400 mt-0.5">お題：{g.topicText}</p>
                {winner && (
                  <p className="text-xs text-yellow-600 mt-1">
                    👑 {winner.userName}「{winner.fullText}」
                  </p>
                )}
              </div>
              <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 p-4 space-y-3">
                {g.submissions.map((s, i) => (
                  <div
                    key={s.id}
                    className={`rounded-xl p-3 ${
                      s.isWinner ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'
                    }`}
                  >
                    {s.isWinner && (
                      <span className="text-yellow-500 text-xs font-bold">👑 WINNER</span>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-gray-400 text-xs">{i + 1}位</span>
                      <span className="text-emerald-500 text-xs font-bold">{s.voteCount}票</span>
                    </div>
                    <p className="text-base font-bold text-gray-800 mt-1">{s.fullText}</p>
                    {s.preamble && (
                      <p className="text-xs text-gray-500 italic mt-1">「{s.preamble}」</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{s.userName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
