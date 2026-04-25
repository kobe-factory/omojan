'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  tournamentId: string
  prevRoundNumber: number
}

interface WinnerInfo {
  roundNumber: number
  winnerName: string
  workText: string
  votes: number
  isTied: boolean
}

export default function PrevRoundBanner({ tournamentId, prevRoundNumber }: Props) {
  const [winner, setWinner] = useState<WinnerInfo | null>(null)

  useEffect(() => {
    async function fetch() {
      const { data: game } = await supabase
        .from('games')
        .select('id, topic_card_id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', prevRoundNumber)
        .single()

      if (!game) return

      const [{ data: subs }, { data: votes }, { data: topicCard }] = await Promise.all([
        supabase.from('submissions').select('id, user_id, hand_card_id, position').eq('game_id', game.id),
        supabase.from('votes').select('submission_id, created_at').eq('game_id', game.id),
        supabase.from('cards').select('text').eq('id', game.topic_card_id).single(),
      ])

      const topicText = topicCard?.text ?? ''
      const voteCount: Record<string, number> = {}
      const voteTimeSum: Record<string, number> = {}
      for (const v of votes ?? []) {
        voteCount[v.submission_id] = (voteCount[v.submission_id] ?? 0) + 1
        voteTimeSum[v.submission_id] = (voteTimeSum[v.submission_id] ?? 0) + new Date(v.created_at).getTime()
      }

      let maxVotes = 0
      let winnerTimeSum = Infinity
      let winnerSub = null
      let hasTie = false

      for (const s of subs ?? []) {
        const count = voteCount[s.id] ?? 0
        const timeSum = voteTimeSum[s.id] ?? 0
        if (count > maxVotes) {
          maxVotes = count
          winnerSub = s
          winnerTimeSum = timeSum
          hasTie = false
        } else if (count === maxVotes && count > 0) {
          hasTie = true
          if (timeSum < winnerTimeSum) {
            winnerSub = s
            winnerTimeSum = timeSum
          }
        }
      }

      if (!winnerSub) return

      const [{ data: handCard }, { data: winnerUser }] = await Promise.all([
        supabase.from('cards').select('text').eq('id', winnerSub.hand_card_id).single(),
        supabase.from('users').select('name').eq('id', winnerSub.user_id).single(),
      ])

      const handText = handCard?.text ?? ''
      const workText = winnerSub.position === 'before'
        ? `${handText}${topicText}`
        : `${topicText}${handText}`

      setWinner({
        roundNumber: prevRoundNumber,
        winnerName: winnerUser?.name ?? '???',
        workText,
        votes: maxVotes,
        isTied: hasTie,
      })
    }

    fetch()
  }, [tournamentId, prevRoundNumber])

  if (!winner) return null

  return (
    <div className="mx-4 mt-4 bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
      <div className="flex items-center gap-1 mb-2">
        <span className="text-sm">👑</span>
        <span className="text-xs font-bold text-yellow-600">第{winner.roundNumber}回戦 Winner</span>
        {winner.isTied && (
          <span className="text-xs text-yellow-500 ml-1">（同点・投票時間で決定）</span>
        )}
      </div>
      <p className="text-base font-bold text-gray-800 mb-1">{winner.workText}</p>
      <p className="text-xs text-gray-400">{winner.winnerName} ・ {winner.votes}票</p>
    </div>
  )
}
