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
  impersonation_mode: boolean
}

interface Game {
  id: string
  round_number: number
  topic_card_id: string
  status: string
  is_rematch: boolean
}

interface ResultItem {
  submissionId: string
  userId: string
  userName: string
  impersonatedUserName: string | null
  topicText: string
  handText: string
  position: 'before' | 'after'
  preamble: string | null
  preamble_position: 'above' | 'below'
  voteCount: number
  displayVoteCount: number
  voterNames: string[]
  tbVoteCount: number
  tbVoterNames: string[]
  isWinner: boolean
  decidedByTiebreaker: boolean
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
  const isRematch = game.status === 'showing_rematch'

  useEffect(() => {
    async function fetchResults() {
      const [{ data: topicCard }, { data: subs }, { data: votes }] = await Promise.all([
        supabase.from('cards').select('text').eq('id', game.topic_card_id).single(),
        supabase.from('submissions').select('id, user_id, hand_card_id, position, preamble, preamble_position, impersonated_user_id').eq('game_id', game.id),
        supabase.from('votes').select('submission_id, voter_user_id, is_tiebreaker').eq('game_id', game.id),
      ])

      const topicText = topicCard?.text ?? ''
      const allVotes = votes ?? []
      const initialVotes = allVotes.filter((v) => !v.is_tiebreaker)
      const tiebreakerVotes = allVotes.filter((v) => v.is_tiebreaker)
      const hasTiebreaker = tiebreakerVotes.length > 0

      const initVoteCount: Record<string, number> = {}
      const initVoterNames: Record<string, string[]> = {}
      for (const v of initialVotes) {
        initVoteCount[v.submission_id] = (initVoteCount[v.submission_id] ?? 0) + 1
        const voter = participants.find((p) => p.id === v.voter_user_id)
        if (!initVoterNames[v.submission_id]) initVoterNames[v.submission_id] = []
        initVoterNames[v.submission_id].push(voter?.name ?? '???')
      }

      const tbVoteCount: Record<string, number> = {}
      const tbVoterNames: Record<string, string[]> = {}
      for (const v of tiebreakerVotes) {
        tbVoteCount[v.submission_id] = (tbVoteCount[v.submission_id] ?? 0) + 1
        const voter = participants.find((p) => p.id === v.voter_user_id)
        if (!tbVoterNames[v.submission_id]) tbVoterNames[v.submission_id] = []
        tbVoterNames[v.submission_id].push(voter?.name ?? '???')
      }

      const items: ResultItem[] = await Promise.all(
        (subs ?? []).map(async (s) => {
          const { data: card } = await supabase.from('cards').select('text').eq('id', s.hand_card_id).single()
          const user = participants.find((p) => p.id === s.user_id)
          const impersonatedUser = s.impersonated_user_id
            ? participants.find((p) => p.id === s.impersonated_user_id)
            : null
          return {
            submissionId: s.id,
            userId: s.user_id,
            userName: user?.name ?? '???',
            impersonatedUserName: impersonatedUser?.name ?? null,
            topicText,
            handText: card?.text ?? '',
            position: s.position as 'before' | 'after',
            preamble: s.preamble,
            preamble_position: (s.preamble_position ?? 'above') as 'above' | 'below',
            voteCount: initVoteCount[s.id] ?? 0,
            displayVoteCount: initVoteCount[s.id] ?? 0,
            voterNames: initVoterNames[s.id] ?? [],
            tbVoteCount: tbVoteCount[s.id] ?? 0,
            tbVoterNames: tbVoterNames[s.id] ?? [],
            isWinner: false,
            decidedByTiebreaker: false,
          }
        })
      )

      const sorted = items.sort((a, b) => b.voteCount - a.voteCount)

      if (!isRematch) {
        if (hasTiebreaker) {
          const maxTb = Math.max(...items.map((i) => i.tbVoteCount), 0)
          sorted.forEach((item) => {
            if (maxTb > 0 && item.tbVoteCount === maxTb) {
              item.isWinner = true
              item.decidedByTiebreaker = true
              item.displayVoteCount = item.voteCount + 1
            }
          })
        } else {
          const maxVotes = sorted.length > 0 ? sorted[0].voteCount : 0
          if (maxVotes > 0) {
            const topItems = sorted.filter((i) => i.voteCount === maxVotes)
            if (topItems.length === 1) {
              topItems[0].isWinner = true
            }
          }
        }
      }

      // 決選投票で+1した場合、表示順を再ソート
      sorted.sort((a, b) => b.displayVoteCount - a.displayVoteCount)

      setResults(sorted)
      setLoading(false)
    }

    fetchResults()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, game.topic_card_id, game.status, participants])

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
        {isRematch ? (
          <>
            <p className="text-5xl mb-2">⚔️</p>
            <p className="text-xl font-bold text-red-600">第{game.round_number}回戦 再戦！</p>
            <p className="text-sm text-gray-500 mt-2">全員同票のためこの回はお流れです</p>
          </>
        ) : (
          <>
            <p className="text-5xl mb-2">🎊</p>
            <p className="text-xl font-bold text-gray-800">第{game.round_number}回戦 結果発表！</p>
          </>
        )}
      </div>

      <div className="space-y-3">
        {results.map((r, i) => (
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
                {r.decidedByTiebreaker && (
                  <span className="text-red-500 text-xs ml-1">（決選投票で決定）</span>
                )}
              </div>
            )}

            <div className="flex items-start justify-between gap-2 mb-3">
              <span className="text-gray-400 text-xs">{isRematch ? '−' : `${i + 1}位`}</span>
              <span className="text-emerald-500 text-sm font-bold">{r.displayVoteCount}票</span>
            </div>

            {r.preamble && r.preamble_position === 'above' && (
              <p className="text-sm text-gray-500 italic mb-3">「{r.preamble}」</p>
            )}
            <p className="text-lg font-bold text-gray-800 mb-3">
              {r.position === 'before' ? `${r.handText}${r.topicText}` : `${r.topicText}${r.handText}`}
            </p>
            {r.preamble && r.preamble_position === 'below' && (
              <p className="text-sm text-gray-500 italic mb-2">「{r.preamble}」</p>
            )}
            <div className="mt-2">
              {tournament.impersonation_mode && r.impersonatedUserName ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <UserIcon name={r.impersonatedUserName} size="xs" />
                  <p className="text-xs text-gray-600">{r.impersonatedUserName}</p>
                  <span className="text-xs text-gray-400">（本当は…</span>
                  <UserIcon name={r.userName} size="xs" />
                  <span className="text-xs text-gray-400">{r.userName}）</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <UserIcon name={r.userName} size="xs" />
                  <p className="text-xs text-gray-600">{r.userName}</p>
                </div>
              )}
              {r.voterNames.length > 0 && (
                <div className="flex items-center justify-end gap-1.5 mt-1.5 pt-1.5 border-t border-gray-100 flex-wrap">
                  <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">投票</span>
                  {r.voterNames.map((name) => (
                    <div key={name} className="flex items-center gap-0.5">
                      <UserIcon name={name} size="xs" />
                      <span className="text-[10px] text-gray-400">{name}</span>
                    </div>
                  ))}
                </div>
              )}
              {r.tbVoterNames.length > 0 && (
                <div className="flex items-center justify-end gap-1.5 mt-1.5 pt-1.5 border-t border-gray-100 flex-wrap">
                  <span className="text-[9px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full">決選</span>
                  {r.tbVoterNames.map((name) => (
                    <div key={name} className="flex items-center gap-0.5">
                      <UserIcon name={name} size="xs" />
                      <span className="text-[10px] text-red-400">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleNext}
        disabled={advancing}
        className={`w-full py-4 font-bold rounded-xl hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 ${
          isRematch ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
        }`}
      >
        {advancing ? '移動中...' : nextLabel ?? (isLastRound ? '大会結果へ' : `第${game.round_number + 1}回戦へ`)}
      </button>
    </div>
  )
}
