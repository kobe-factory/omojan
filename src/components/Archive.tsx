'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import UserIcon from './UserIcon'

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
  isRematch: boolean
  isVoided: boolean
  hasTiebreaker: boolean
  votingMode: string | null
  buttonMashType: string | null
}

interface ArchiveSubmission {
  id: string
  userId: string
  userName: string
  impersonatedUserName: string | null
  fullText: string
  preamble: string | null
  preamble_position: 'above' | 'below'
  voteCount: number
  displayVoteCount: number
  voterNames: string[]
  tbVoteCount: number
  tbVoterNames: string[]
  isWinner: boolean
  decidedByTiebreaker: boolean
  decidedByButtonMash: boolean
}

interface Props {
  tournamentId: string
  participants: User[]
  impersonationMode?: boolean
  randomVoting?: boolean
}

export default function Archive({ tournamentId, participants, impersonationMode = false, randomVoting = false }: Props) {
  const [games, setGames] = useState<ArchiveGame[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGame, setExpandedGame] = useState<string | null>(null)

  useEffect(() => {
    async function fetchArchive() {
      const { data: finishedGames } = await supabase
        .from('games')
        .select('id, round_number, topic_card_id, status, is_rematch, voting_mode, button_mash_type')
        .eq('tournament_id', tournamentId)
        .in('status', ['showing_result', 'finished', 'showing_rematch'])
        .order('round_number', { ascending: true })
        .order('created_at', { ascending: true })

      if (!finishedGames) {
        setLoading(false)
        return
      }

      // 流局判定: 同じround_numberで再戦(is_rematch=true)が存在する回戦は流局
      const rematchRoundSet = new Set(
        finishedGames.filter((g) => g.is_rematch).map((g) => g.round_number)
      )

      const result: ArchiveGame[] = await Promise.all(
        finishedGames.map(async (g) => {
          const isVoided =
            g.status === 'showing_rematch' ||
            (!g.is_rematch && rematchRoundSet.has(g.round_number))

          const [{ data: topicCard }, { data: subs }, { data: votes }, { data: mashResults }] = await Promise.all([
            supabase.from('cards').select('text').eq('id', g.topic_card_id).single(),
            supabase.from('submissions').select('id, user_id, hand_card_id, position, preamble, preamble_position, impersonated_user_id').eq('game_id', g.id),
            supabase.from('votes').select('submission_id, voter_user_id, is_tiebreaker').eq('game_id', g.id),
            supabase.from('button_mash_results').select('user_id, tap_count, mash_round, completion_time_ms').eq('game_id', g.id),
          ])

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

          const submissions: ArchiveSubmission[] = await Promise.all(
            (subs ?? []).map(async (s) => {
              const { data: card } = await supabase
                .from('cards')
                .select('text')
                .eq('id', s.hand_card_id)
                .single()

              const user = participants.find((p) => p.id === s.user_id)
              const impersonatedUser = s.impersonated_user_id
                ? participants.find((p) => p.id === s.impersonated_user_id)
                : null
              const handText = card?.text ?? ''
              const topicText = topicCard?.text ?? ''
              const fullText =
                s.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`

              return {
                id: s.id,
                userId: s.user_id,
                userName: user?.name ?? '???',
                impersonatedUserName: impersonatedUser?.name ?? null,
                fullText,
                preamble: s.preamble,
                preamble_position: (s.preamble_position ?? 'above') as 'above' | 'below',
                voteCount: initVoteCount[s.id] ?? 0,
                displayVoteCount: initVoteCount[s.id] ?? 0,
                voterNames: initVoterNames[s.id] ?? [],
                tbVoteCount: tbVoteCount[s.id] ?? 0,
                tbVoterNames: tbVoterNames[s.id] ?? [],
                isWinner: false,
                decidedByTiebreaker: false,
                decidedByButtonMash: false,
              }
            })
          )

          const sorted = submissions.sort((a, b) => b.voteCount - a.voteCount)

          if (!isVoided) {
            if (hasTiebreaker) {
              const maxTb = Math.max(...sorted.map((s) => s.tbVoteCount), 0)
              sorted.forEach((s) => {
                if (maxTb > 0 && s.tbVoteCount === maxTb) {
                  s.isWinner = true
                  s.decidedByTiebreaker = true
                  s.displayVoteCount = s.voteCount + 1
                }
              })
            } else {
              const maxVotes = sorted.length > 0 ? sorted[0].voteCount : 0
              if (maxVotes > 0) {
                const topItems = sorted.filter((s) => s.voteCount === maxVotes)
                if (topItems.length === 1) {
                  topItems[0].isWinner = true
                } else if (mashResults && mashResults.length >= 2) {
                  // 連打ゲームで決着
                  const latestRound = Math.max(...mashResults.map((r) => r.mash_round))
                  const latest = mashResults.filter((r) => r.mash_round === latestRound)
                  // speed mode か timed mode か（completion_time_ms の有無で判定）
                  const hasMashSpeedMode = latest.some(
                    (r) => (r as { completion_time_ms?: number | null }).completion_time_ms != null,
                  )
                  let winnerUserId: string | null = null
                  if (hasMashSpeedMode) {
                    const minTime = Math.min(
                      ...latest.map((r) => (r as { completion_time_ms?: number | null }).completion_time_ms ?? Infinity),
                    )
                    const winners = latest.filter(
                      (r) => (r as { completion_time_ms?: number | null }).completion_time_ms === minTime,
                    )
                    if (winners.length === 1) winnerUserId = winners[0].user_id
                  } else {
                    const maxTaps = Math.max(...latest.map((r) => r.tap_count))
                    const winners = latest.filter((r) => r.tap_count === maxTaps)
                    if (winners.length === 1) winnerUserId = winners[0].user_id
                  }
                  if (winnerUserId) {
                    const winnerSub = sorted.find((s) => s.userId === winnerUserId)
                    if (winnerSub) {
                      winnerSub.isWinner = true
                      winnerSub.decidedByButtonMash = true
                    }
                  }
                }
              }
            }
          }

          sorted.sort((a, b) => b.displayVoteCount - a.displayVoteCount)

          return {
            id: g.id,
            round_number: g.round_number,
            topic_card_id: g.topic_card_id,
            topicText: topicCard?.text ?? '',
            submissions: sorted,
            isRematch: g.is_rematch,
            isVoided,
            hasTiebreaker,
            votingMode: (g as { voting_mode?: string | null }).voting_mode ?? null,
            buttonMashType: (g as { button_mash_type?: string | null }).button_mash_type ?? null,
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">第{g.round_number}回戦</span>
                  {g.isVoided && (
                    <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">⚔️流れ</span>
                  )}
                  {g.isRematch && !g.isVoided && (
                    <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">再戦</span>
                  )}
                  {randomVoting && g.votingMode === 'secret' && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">🕵️</span>
                  )}
                  {randomVoting && g.votingMode === 'impersonation' && (
                    <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">🎭</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">お題：{g.topicText}</p>
                {!g.isVoided && winner && (
                  <p className="text-xs text-yellow-600 mt-1">
                    👑 {(randomVoting ? g.votingMode === 'impersonation' : impersonationMode) && winner.impersonatedUserName ? winner.impersonatedUserName : winner.userName}「{winner.fullText}」
                  </p>
                )}
                {g.isVoided && (
                  <p className="text-xs text-orange-600 mt-1">全員同票 - 再戦</p>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 p-4 space-y-3">
                {g.isVoided && (
                  <p className="text-xs text-orange-600 text-center bg-orange-50 rounded-xl py-2">
                    ⚔️ 全員同票のためこの回はお流れ・再戦となりました
                  </p>
                )}
                {(() => {
                  const rankList = g.submissions.reduce<number[]>((acc, s, i) => {
                    if (i === 0) return [1]
                    if (s.displayVoteCount === g.submissions[i - 1].displayVoteCount) return [...acc, acc[i - 1]]
                    return [...acc, i + 1]
                  }, [])
                  return g.submissions.map((s, i) => (
                  <div
                    key={s.id}
                    className={`rounded-xl p-3 ${
                      s.isWinner ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'
                    }`}
                  >
                    {s.isWinner && (
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-yellow-500 text-xs font-bold">👑 WINNER</span>
                        {s.decidedByTiebreaker && (
                          <span className="text-red-500 text-xs">（決選投票で決定）</span>
                        )}
                        {s.decidedByButtonMash && (
                          <span className="text-red-500 text-xs">（⚔️ 連打で決定）</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-xs">{g.isVoided ? '−' : `${rankList[i]}位`}</span>
                      </div>
                      <span className="text-emerald-500 text-xs font-bold">{s.displayVoteCount}票</span>
                    </div>
                    {s.preamble && s.preamble_position === 'above' && (
                      <p className="text-xs text-gray-500 italic mt-1">「{s.preamble}」</p>
                    )}
                    <p className="text-base font-bold text-gray-800 mt-1">{s.fullText}</p>
                    {s.preamble && s.preamble_position === 'below' && (
                      <p className="text-xs text-gray-500 italic mt-1">「{s.preamble}」</p>
                    )}
                    <div className="mt-3">
                      {(randomVoting ? g.votingMode === 'impersonation' : impersonationMode) && s.impersonatedUserName ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <UserIcon name={s.impersonatedUserName} size="xs" />
                          <p className="text-xs text-gray-600">{s.impersonatedUserName}</p>
                          <span className="text-xs text-gray-400 ml-2">（本当は…</span>
                          <UserIcon name={s.userName} size="xs" />
                          <span className="text-xs text-gray-400">{s.userName}）</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <UserIcon name={s.userName} size="xs" />
                          <p className="text-xs text-gray-600">{s.userName}</p>
                        </div>
                      )}
                      {s.voterNames.length > 0 && (
                        <div className="flex items-center justify-end gap-1.5 mt-1.5 pt-1.5 border-t border-gray-100 flex-wrap">
                          <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">投票</span>
                          {s.voterNames.map((name) => (
                            <div key={name} className="flex items-center gap-0.5">
                              <UserIcon name={name} size="xs" />
                              <span className="text-[10px] text-gray-400">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {s.tbVoterNames.length > 0 && (
                        <div className="flex items-center justify-end gap-1.5 mt-1.5 pt-1.5 border-t border-gray-100 flex-wrap">
                          <span className="text-[9px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full">決選</span>
                          {s.tbVoterNames.map((name) => (
                            <div key={name} className="flex items-center gap-0.5">
                              <UserIcon name={name} size="xs" />
                              <span className="text-[10px] text-red-400">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  ))
                })()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
