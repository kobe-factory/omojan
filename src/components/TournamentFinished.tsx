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
  wins: number
  isTied: boolean
  isFinalWinner: boolean
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
  isWinByButtonMash: boolean
  votingMode: string | null
  isRematch: boolean
  isVoided: boolean
}

interface Props {
  tournamentId: string
  participants: User[]
}

export default function TournamentFinished({ tournamentId, participants }: Props) {
  const [scores, setScores] = useState<PlayerScore[]>([])
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [finalWinnerName, setFinalWinnerName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'result' | 'archive'>('result')

  useEffect(() => {
    async function fetchData() {
      const { data: allGames } = await supabase
        .from('games')
        .select('id, round_number, topic_card_id, status, is_rematch, voting_mode')
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: true })
        .order('created_at', { ascending: true })

      if (!allGames || allGames.length === 0) {
        setLoading(false)
        return
      }

      // round_number=0 は大会決戦ゲーム
      const finalTiebreakerGame = allGames.find((g) => g.round_number === 0)
      const games = allGames.filter((g) => g.round_number > 0)

      const gameIds = games.map((g) => g.id)

      const [{ data: allVotes }, { data: allSubs }, { data: allMashResults }] = await Promise.all([
        supabase.from('votes').select('game_id, submission_id, is_tiebreaker').in('game_id', gameIds),
        supabase.from('submissions').select('id, game_id, user_id, hand_card_id, position, preamble, preamble_position').in('game_id', gameIds),
        supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round').in('game_id', gameIds),
      ])

      // 大会決戦の勝者を取得
      let finalTiebreakerWinnerId: string | null = null
      if (finalTiebreakerGame) {
        const tiedUserIds = (finalTiebreakerGame.voting_mode ?? '')
          .replace('final_tiebreaker:', '')
          .split(',')
          .filter(Boolean)

        const { data: finalMashResults } = await supabase
          .from('button_mash_results')
          .select('user_id, tap_count, mash_round')
          .eq('game_id', finalTiebreakerGame.id)
          .order('mash_round', { ascending: false })

        if (finalMashResults && finalMashResults.length > 0) {
          const latestRound = Math.max(...finalMashResults.map((r) => r.mash_round))
          const latest = finalMashResults.filter((r) => r.mash_round === latestRound)
          const maxTaps = Math.max(...latest.map((r) => r.tap_count))
          const winners = latest.filter((r) => r.tap_count === maxTaps)
          if (winners.length === 1) {
            finalTiebreakerWinnerId = winners[0].user_id
          }
        }

        if (!finalTiebreakerWinnerId && tiedUserIds.length > 0) {
          // 未完了の場合はnull のまま
        }

        if (finalTiebreakerWinnerId) {
          setFinalWinnerName(participants.find((p) => p.id === finalTiebreakerWinnerId)?.name ?? null)
        }
      }

      // ゲーム別の連打結果（最終ラウンドのみ）
      const mashResults = allMashResults ?? []
      const mashWinnerByGame: Record<string, string> = {}
      for (const gameId of gameIds) {
        const results = mashResults.filter((r) => r.game_id === gameId)
        if (results.length < 2) continue
        const latestRound = Math.max(...results.map((r) => r.mash_round))
        const latest = results.filter((r) => r.mash_round === latestRound)
        const maxTaps = Math.max(...latest.map((r) => r.tap_count))
        const winners = latest.filter((r) => r.tap_count === maxTaps)
        if (winners.length === 1) mashWinnerByGame[gameId] = winners[0].user_id
      }

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
      const tiebreakerVoteCount: Record<string, number> = {}
      for (const v of allVotes ?? []) {
        if (v.is_tiebreaker) {
          tiebreakerVoteCount[v.submission_id] = (tiebreakerVoteCount[v.submission_id] ?? 0) + 1
        } else {
          regularVoteCount[v.submission_id] = (regularVoteCount[v.submission_id] ?? 0) + 1
        }
      }

      const scoreMap: Record<string, { totalVotes: number; wins: number }> = {}
      for (const p of participants) {
        scoreMap[p.id] = { totalVotes: 0, wins: 0 }
      }

      const roundSummaries: RoundSummary[] = []

      // 流局判定
      const rematchRounds = new Set(
        (games ?? []).filter((g) => g.is_rematch).map((g) => g.round_number)
      )

      for (const game of games) {
        const isVoided =
          game.status === 'showing_rematch' ||
          (!game.is_rematch && rematchRounds.has(game.round_number))

        const gameSubs = (allSubs ?? []).filter((s) => s.game_id === game.id)
        let maxRegularVotes = 0
        let winnerSub: typeof gameSubs[0] | null = null
        let hasTie = false
        let isWinByTiebreaker = false
        let isWinByButtonMash = false

        if (!isVoided) {
          // 通常投票でスコア集計（時間ベースのタイブレーカーは使用しない）
          for (const sub of gameSubs) {
            const count = regularVoteCount[sub.id] ?? 0
            if (scoreMap[sub.user_id]) {
              scoreMap[sub.user_id].totalVotes += count
            }
            if (count > maxRegularVotes) {
              maxRegularVotes = count
              winnerSub = sub
              hasTie = false
            } else if (count === maxRegularVotes && count > 0) {
              hasTie = true
            }
          }

          // 同票の場合は連打ゲームまたは決選投票で勝者を決定
          if (hasTie) {
            const mashWinnerUserId = mashWinnerByGame[game.id]
            if (mashWinnerUserId) {
              const mashWinnerSub = gameSubs.find((s) => s.user_id === mashWinnerUserId)
              if (mashWinnerSub) {
                winnerSub = mashWinnerSub
                isWinByButtonMash = true
                hasTie = false
              }
            } else {
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
          }

          if (hasTie) {
            // 解決されなかった同票 → 全員に +1勝
            const tiedSubs = gameSubs.filter((s) => (regularVoteCount[s.id] ?? 0) === maxRegularVotes)
            for (const ts of tiedSubs) {
              if (scoreMap[ts.user_id]) scoreMap[ts.user_id].wins += 1
            }
          } else if (winnerSub) {
            if (scoreMap[winnerSub.user_id]) {
              scoreMap[winnerSub.user_id].wins += 1
              if (isWinByTiebreaker) scoreMap[winnerSub.user_id].totalVotes += 1
            }
          }
        }

        const displayVotes = maxRegularVotes + (isWinByTiebreaker ? 1 : 0)

        const topicText = topicMap[game.topic_card_id] ?? ''

        let winnerText = ''
        let winnerName = '???'
        let winnerPreamble: string | null = null
        let winnerPreamblePosition: 'above' | 'below' = 'above'

        if (hasTie) {
          const tiedSubs = gameSubs.filter((s) => (regularVoteCount[s.id] ?? 0) === maxRegularVotes)
          winnerName = tiedSubs
            .map((ts) => participants.find((p) => p.id === ts.user_id)?.name ?? '???')
            .join('・')
        } else if (winnerSub) {
          const handText = handMap[winnerSub.hand_card_id] ?? ''
          winnerText = winnerSub.position === 'before'
            ? `${handText}${topicText}`
            : `${topicText}${handText}`
          winnerName = participants.find((p) => p.id === winnerSub!.user_id)?.name ?? '???'
          winnerPreamble = winnerSub.preamble ?? null
          winnerPreamblePosition = (winnerSub.preamble_position ?? 'above') as 'above' | 'below'
        }

        roundSummaries.push({
          roundNumber: game.round_number,
          topicText,
          winnerName,
          winnerText,
          winnerPreamble,
          winnerPreamblePosition,
          votes: displayVotes,
          isTied: hasTie,
          isWinByTiebreaker,
          isWinByButtonMash,
          votingMode: game.voting_mode ?? null,
          isRematch: game.is_rematch,
          isVoided,
        })
      }

      const unsorted = participants.map((p) => ({
        userId: p.id,
        userName: p.name,
        totalVotes: scoreMap[p.id]?.totalVotes ?? 0,
        wins: scoreMap[p.id]?.wins ?? 0,
        isTied: false,
        isFinalWinner: p.id === finalTiebreakerWinnerId,
      }))

      const sorted = unsorted.sort((a, b) => {
        // 大会決戦勝者を最上位に
        if (a.isFinalWinner && !b.isFinalWinner) return -1
        if (!a.isFinalWinner && b.isFinalWinner) return 1
        if (b.wins !== a.wins) return b.wins - a.wins
        if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes
        return 0
      })

      sorted.forEach((s, i) => {
        // 大会決戦があった場合、同点でも isTied=false（決戦で決着済み）
        if (finalTiebreakerWinnerId) {
          s.isTied = false
        } else {
          s.isTied = sorted.some(
            (o, j) => j !== i && o.wins === s.wins && o.totalVotes === s.totalVotes
          )
        }
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
    if (!s.isFinalWinner && !prev.isFinalWinner && s.wins === prev.wins && s.totalVotes === prev.totalVotes) return [...acc, prevRank]
    return [...acc, i + 1]
  }, [])

  return (
    <>
    <div className="flex border-b border-gray-200 bg-white sticky top-[77px] z-10">
      {([
        { key: 'result', label: '大会結果' },
        { key: 'archive', label: '過去結果' },
      ] as const).map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === tab.key ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-gray-400'
          }`}
        >
          {tab.label}
        </button>
      ))}
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

      {/* 大会決戦バナー */}
      {finalWinnerName && (
        <div className="bg-red-50 border-2 border-red-400 rounded-2xl p-4 text-center">
          <p className="text-xs font-bold text-red-500 mb-1">⚔️ 大会決戦</p>
          <p className="text-sm text-gray-600">同点のため5秒間の連打決戦が行われました</p>
          <p className="text-lg font-black text-red-600 mt-1">優勝：{finalWinnerName}</p>
        </div>
      )}

      {/* MVP */}
      {mvp && (
        <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-5 text-center">
          <p className="text-xs font-bold text-yellow-500 mb-1">👑 {finalWinnerName ? '大会優勝' : 'MVP'}</p>
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
                {s.isFinalWinner && (
                  <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">⚔️決戦優勝</span>
                )}
              </div>
              {s.isTied && !s.isFinalWinner && (
                <span className="text-xs text-gray-400">同点</span>
              )}
              <span className="text-xs text-gray-400"><span className="text-base font-bold text-yellow-500">{s.wins}</span>勝</span>
              <span className="text-xs text-gray-400"><span className="text-base font-bold text-emerald-600">{s.totalVotes}</span>票</span>
            </div>
            )
          })}
        </div>
        {scores.some((s) => s.isTied) && (
          <p className="text-xs text-gray-400 mt-3 text-center">※勝数→得票数で順位を決定</p>
        )}
        {finalWinnerName && (
          <p className="text-xs text-gray-400 mt-3 text-center">※同点のため大会決戦（5秒連打）で優勝を決定</p>
        )}
      </div>

      {/* 回戦別結果 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">回戦別MVP</h3>
        <div className="space-y-3">
          {rounds.filter((r) => !r.isVoided).map((r) => (
            <div key={`${r.roundNumber}-${r.isRematch}`} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-emerald-600">第{r.roundNumber}回戦</span>
                  {r.isRematch && (
                    <span className="text-[9px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">再戦</span>
                  )}
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
                  {r.isTied && (
                    <span className="text-xs text-gray-400">（同点）</span>
                  )}
                  {r.isWinByTiebreaker && (
                    <span className="text-[9px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full">決選</span>
                  )}
                  {r.isWinByButtonMash && (
                    <span className="text-[9px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">⚡連打</span>
                  )}
                  {!r.isTied && <span className="text-xs text-gray-400">{r.votes}票</span>}
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-2">お題：{r.topicText}</p>
              {r.isTied ? (
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <p className="text-xs text-gray-500 text-center">同点（未決着）</p>
                </div>
              ) : (
                <div className="bg-yellow-50 rounded-xl px-3 py-2">
                  {r.winnerPreamble && r.winnerPreamblePosition === 'above' && (
                    <p className="text-xs text-gray-500 italic mb-1">「{r.winnerPreamble}」</p>
                  )}
                  <p className="text-sm font-bold text-gray-800">{r.winnerText}</p>
                  {r.winnerPreamble && r.winnerPreamblePosition === 'below' && (
                    <p className="text-xs text-gray-500 italic mt-1">「{r.winnerPreamble}」</p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-3">
                {r.winnerName.includes('・') ? (
                  <p className="text-xs text-gray-400">{r.winnerName}</p>
                ) : (
                  <>
                    <UserIcon name={r.winnerName} size="xs" />
                    <p className="text-xs text-gray-400">{r.winnerName}</p>
                  </>
                )}
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
