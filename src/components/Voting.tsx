'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import CompletionStatus from './CompletionStatus'
import UserIcon from './UserIcon'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
  mode: string
  game_count: number
  secret_voting: boolean
  impersonation_mode: boolean
}

interface Game {
  id: string
  round_number: number
  topic_card_id: string
  status: string
  voting_mode?: string | null
}

const VOTING_MODE_INFO = {
  normal:        { emoji: '🎯', label: '通常モード',       desc: '作者名が表示されます'           },
  secret:        { emoji: '🕵️', label: 'シークレットモード', desc: '作者名は非表示です'             },
  impersonation: { emoji: '🎭', label: 'なりすましモード',   desc: '他のユーザーとして投稿できます' },
}

interface Submission {
  id: string
  user_id: string
  hand_card_id: string
  position: 'before' | 'after'
  preamble: string | null
  preamble_position: 'above' | 'below'
  created_at: string
  impersonated_user_id: string | null
  userName: string
  impersonatedUserName: string | null
  handCardText: string
}

interface Props {
  tournament: Tournament
  token: string
  game: Game
  currentUserId: string
  participants: User[]
  onVoted: () => Promise<void>
  isExhibitionMode?: boolean
}

export default function Voting({ tournament, token, game, currentUserId, participants, onVoted, isExhibitionMode }: Props) {
  const isTiebreaker = game.status === 'waiting_tiebreaker_vote'
  const isLastRound = game.round_number >= tournament.game_count
  const roundLabel = isLastRound ? '最終戦' : `第${game.round_number}回戦`

  const shuffleKeyRef = useRef('')
  const shuffledIdsRef = useRef<string[]>([])

  const [topicText, setTopicText] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [tiedSubmissionIds, setTiedSubmissionIds] = useState<Set<string>>(new Set())
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)
  const [voted, setVoted] = useState(false)
  const [votedUserIds, setVotedUserIds] = useState<string[]>([])
  const [voteError, setVoteError] = useState(false)
  const [exhibitionVoteSubmissionId, setExhibitionVoteSubmissionId] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('cards')
      .select('text')
      .eq('id', game.topic_card_id)
      .single()
      .then(({ data }) => { if (data) setTopicText(data.text) })

    Promise.all([
      supabase
        .from('submissions')
        .select('id, user_id, hand_card_id, position, preamble, preamble_position, created_at, impersonated_user_id')
        .eq('game_id', game.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('votes')
        .select('voter_user_id, submission_id, is_tiebreaker')
        .eq('game_id', game.id),
    ]).then(async ([subRes, voteRes]) => {
      const subs = subRes.data ?? []
      const votes = voteRes.data ?? []

      // 初回投票で同票の2作品を特定
      const initialVotes = votes.filter((v) => !v.is_tiebreaker)
      const initCount: Record<string, number> = {}
      for (const v of initialVotes) {
        initCount[v.submission_id] = (initCount[v.submission_id] ?? 0) + 1
      }
      if (isTiebreaker) {
        const maxInit = Math.max(...Object.values(initCount), 0)
        const tiedIds = new Set(
          Object.entries(initCount).filter(([, c]) => c === maxInit).map(([id]) => id)
        )
        setTiedSubmissionIds(tiedIds)
      }

      // 現フェーズの投票済みユーザーを設定
      const phaseVotes = votes.filter((v) => v.is_tiebreaker === isTiebreaker)
      setVotedUserIds(phaseVotes.map((v) => v.voter_user_id))

      // 自分の投票済み作品を復元（フェーズ切り替え時は必ずリセット）
      const myVote = phaseVotes.find((v) => v.voter_user_id === currentUserId)
      if (myVote) {
        setVoted(true)
        setSelectedSubmissionId(myVote.submission_id)
      } else {
        setVoted(false)
        setSelectedSubmissionId(null)
      }

      // 手札テキストとユーザー名を取得
      const enriched: Submission[] = await Promise.all(
        subs.map(async (s) => {
          const { data: card } = await supabase
            .from('cards')
            .select('text')
            .eq('id', s.hand_card_id)
            .single()
          const user = participants.find((p) => p.id === s.user_id)
          const impersonatedUser = s.impersonated_user_id
            ? participants.find((p) => p.id === s.impersonated_user_id)
            : null
          return {
            ...s,
            position: s.position as 'before' | 'after',
            preamble_position: (s.preamble_position ?? 'above') as 'above' | 'below',
            userName: user?.name ?? '???',
            impersonatedUserName: impersonatedUser?.name ?? null,
            handCardText: card?.text ?? '',
          }
        })
      )

      // ゲーム・フェーズごとに並び順をlocalStorageで永続化（LINEのWebView再起動後も順序を保持）
      const shuffleKey = `omojan:shuffle:${game.id}-${isTiebreaker}`
      const stored = localStorage.getItem(shuffleKey)
      let orderedIds: string[]
      if (stored) {
        orderedIds = JSON.parse(stored)
      } else {
        const shuffled = [...enriched].sort(() => Math.random() - 0.5)
        orderedIds = shuffled.map((s) => s.id)
        localStorage.setItem(shuffleKey, JSON.stringify(orderedIds))
      }
      shuffleKeyRef.current = shuffleKey
      shuffledIdsRef.current = orderedIds
      const orderMap = Object.fromEntries(orderedIds.map((id, i) => [id, i]))
      setSubmissions([...enriched].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999)))
    })
  }, [game.id, game.topic_card_id, game.status, currentUserId, participants, isTiebreaker])

  // エキシビション：AIの投票候補を取得・リアルタイム監視
  useEffect(() => {
    if (!isExhibitionMode) return

    async function fetchExhibitionVote() {
      const { data } = await supabase
        .from('exhibition_votes')
        .select('submission_id')
        .eq('game_id', game.id)
        .eq('user_id', currentUserId)
        .eq('is_tiebreaker', isTiebreaker)
        .maybeSingle()

      if (data?.submission_id) {
        setExhibitionVoteSubmissionId(data.submission_id)
        setSelectedSubmissionId(data.submission_id)
      }
    }

    fetchExhibitionVote()

    const channel = supabase
      .channel(`exhibition-vote-${game.id}-${currentUserId}-${isTiebreaker}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'exhibition_votes',
        filter: `game_id=eq.${game.id}`,
      }, fetchExhibitionVote)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isExhibitionMode, game.id, currentUserId, isTiebreaker])

  // 決選投票：表示する作品は同票の2つのみ
  const visibleSubmissions = isTiebreaker
    ? submissions.filter((s) => tiedSubmissionIds.has(s.id))
    : submissions

  // 決選投票の投票資格チェック
  function isExcludedFromTiebreaker(sub: Submission): boolean {
    if (!isTiebreaker) return false
    if (tournament.mode !== 'production') return false
    return sub.user_id === currentUserId && tiedSubmissionIds.has(sub.id)
  }

  const isSolo = participants.length === 1
  const currentUserIsExcluded = isTiebreaker && tournament.mode === 'production'
    && visibleSubmissions.some((s) => s.user_id === currentUserId)

  // 完了ユーザーID（投票済み + 決選投票の作者は自動完了扱い）
  let completedUserIds: string[]
  if (isTiebreaker && tournament.mode === 'production') {
    const authorIds = new Set(visibleSubmissions.map((s) => s.user_id))
    const eligibleVoted = votedUserIds.filter((id) => !authorIds.has(id))
    completedUserIds = [...eligibleVoted, ...Array.from(authorIds)]
  } else {
    completedUserIds = votedUserIds
  }

  // シークレット・なりすましの決選投票：作者を除いた投票資格者のみをステータス表示対象にする（0/3 スタート）
  const isSecretOrImpersonation = tournament.secret_voting || tournament.impersonation_mode
  const tiebreakerExcludesAuthors = isTiebreaker && tournament.mode === 'production' && isSecretOrImpersonation
  const statusParticipants = tiebreakerExcludesAuthors
    ? (() => {
        const authorIds = new Set(visibleSubmissions.map((s) => s.user_id))
        return participants.filter((p) => !authorIds.has(p.id))
      })()
    : participants
  const statusCompletedIds = tiebreakerExcludesAuthors
    ? (() => {
        const authorIds = new Set(visibleSubmissions.map((s) => s.user_id))
        return votedUserIds.filter((id) => !authorIds.has(id))
      })()
    : completedUserIds

  async function handleVote() {
    const voteSubmissionId = isExhibitionMode ? exhibitionVoteSubmissionId : selectedSubmissionId
    if (!voteSubmissionId) return
    setVoting(true)
    setVoteError(false)
    try {
      const res = await fetch(`/api/tournaments/${token}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voter_user_id: currentUserId,
          game_id: game.id,
          submission_id: voteSubmissionId,
          is_tiebreaker: isTiebreaker,
        }),
      })
      if (!res.ok) throw new Error()
      setVoted(true)
      setVotedUserIds(prev => prev.includes(currentUserId) ? prev : [...prev, currentUserId])
      await onVoted()
    } catch {
      setVoteError(true)
    } finally {
      setVoting(false)
    }
  }

  // エキシビション：AIの投票候補がまだ届いていない場合（作品一覧が揃っているのにAI提案がない）
  if (isExhibitionMode && !exhibitionVoteSubmissionId && !voted && visibleSubmissions.length > 0) {
    return (
      <div className="p-4 space-y-4">
        <div className={`rounded-2xl p-4 text-center ${isTiebreaker ? 'bg-red-500' : 'bg-emerald-500'}`}>
          <h2 className="text-white text-lg font-bold">{isTiebreaker ? '⚔️ 決選投票' : '投票'}</h2>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
          <div className="animate-pulse mb-4">
            <p className="text-3xl mb-2">🤖</p>
          </div>
          <p className="text-gray-700 font-medium mb-1">AIが投票先を考え中...</p>
          <p className="text-sm text-gray-400">しばらくお待ちください</p>
        </div>
        <CompletionStatus
          completedUserIds={statusCompletedIds}
          participants={statusParticipants}
          completedLabel="投票完了"
          pendingLabel="投票中"
          nextPhaseText="全員が投票すると、結果発表へ進みます"
          allDoneText="全員が投票しました！結果発表へ進みます"
          secret={tournament.secret_voting || (isTiebreaker && tournament.impersonation_mode)}
        />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className={`rounded-2xl p-4 text-center ${isTiebreaker ? 'bg-red-500' : 'bg-emerald-500'}`}>
        <p className={`text-xs font-bold ${game.voting_mode ? 'mb-2' : 'mb-0.5'} ${isTiebreaker ? 'text-red-100' : 'text-emerald-100'}`}>{roundLabel}</p>
        {game.voting_mode && VOTING_MODE_INFO[game.voting_mode as keyof typeof VOTING_MODE_INFO] && (() => {
          const info = VOTING_MODE_INFO[game.voting_mode as keyof typeof VOTING_MODE_INFO]
          return (
            <div className="flex items-center justify-center gap-1 mb-1">
              <span className="text-xs leading-none">{info.emoji}</span>
              <span className={`text-[10px] font-bold leading-none ${isTiebreaker ? 'text-red-100' : 'text-emerald-100'}`}>{info.label}</span>
              <span className={`text-[9px] leading-none ${isTiebreaker ? 'text-red-200' : 'text-emerald-200'}`}>{info.desc}</span>
            </div>
          )
        })()}
        <h2 className="text-white text-lg font-bold">
          {isTiebreaker ? '⚔️ 決選投票' : '投票'}
        </h2>
        <p className={`text-white text-xl font-bold mt-2 rounded-xl px-4 py-3 ${isTiebreaker ? 'bg-red-600' : 'bg-emerald-600'}`}>
          お題：{topicText}
        </p>
      </div>

      {isTiebreaker && (
        <div className={`rounded-xl px-4 py-3 text-center text-sm font-medium ${
          currentUserIsExcluded
            ? 'bg-gray-100 text-gray-500'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {isSolo
            ? 'テストモード：決選投票フローの確認です'
            : currentUserIsExcluded
            ? '🏆 あなたの作品が決選に残っています！作者は投票できません。'
            : '同票！上位2作品で決選投票です'}
        </div>
      )}

      {!isTiebreaker && (
        <p className="text-sm text-gray-500 text-center">一番面白い作品に投票しよう！</p>
      )}

      <div className="space-y-3">
        {visibleSubmissions.map((sub) => {
          const fullText =
            sub.position === 'before'
              ? `${sub.handCardText}${topicText}`
              : `${topicText}${sub.handCardText}`
          const isSelected = selectedSubmissionId === sub.id
          const isOwnSubmission = !isSolo && sub.user_id === currentUserId && !isTiebreaker
          const isTiebreakerExcluded = isExcludedFromTiebreaker(sub)
          const isDisabled = isOwnSubmission || isTiebreakerExcluded || currentUserIsExcluded

          return (
            <button
              key={sub.id}
              disabled={isDisabled}
              onClick={() => { if (!isDisabled) setSelectedSubmissionId(sub.id) }}
              className={`w-full text-left rounded-2xl p-4 transition-all border-2 ${
                isDisabled
                  ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                  : isSelected
                  ? isTiebreaker ? 'border-red-500 bg-red-50' : 'border-emerald-500 bg-emerald-50'
                  : 'border-gray-200 bg-white hover:border-emerald-200'
              }`}
            >
              {sub.preamble && sub.preamble_position === 'above' && (
                <p className="text-sm text-gray-500 italic mb-2">「{sub.preamble}」</p>
              )}
              <p className="text-lg font-bold text-gray-800 mb-2">{fullText}</p>
              {sub.preamble && sub.preamble_position === 'below' && (
                <p className="text-sm text-gray-500 italic mb-2">「{sub.preamble}」</p>
              )}
              {!tournament.secret_voting && (
                <div className="flex items-center gap-1.5 mt-3">
                  <UserIcon name={tournament.impersonation_mode ? (sub.impersonatedUserName ?? sub.userName) : sub.userName} size="xs" />
                  <p className="text-xs text-gray-400">{tournament.impersonation_mode ? (sub.impersonatedUserName ?? sub.userName) : sub.userName}</p>
                </div>
              )}
              {isOwnSubmission ? (
                <div className="mt-2">
                  <span className="text-gray-400 text-xs">自分の作品には投票できません</span>
                </div>
              ) : isSelected ? (
                <div className="mt-2">
                  <span className={`text-xs font-medium ${isTiebreaker ? 'text-red-500' : 'text-emerald-500'}`}>✓ 選択中</span>
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      {!currentUserIsExcluded && (
        <>
          {isExhibitionMode && exhibitionVoteSubmissionId && !voted && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <span className="text-base">🤖</span>
              <div>
                <p className="text-xs font-bold text-violet-700">AIが投票先を選びました</p>
                <p className="text-[11px] text-violet-500">確認してボタンを押してください</p>
              </div>
            </div>
          )}
          <button
            onClick={handleVote}
            disabled={voting || (isExhibitionMode ? !exhibitionVoteSubmissionId : !selectedSubmissionId)}
            className={`w-full py-4 rounded-xl font-bold transition-all ${
              voted
                ? 'bg-green-500 text-white'
                : isTiebreaker
                ? 'bg-red-500 text-white hover:bg-red-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
                : isExhibitionMode
                ? 'bg-violet-500 text-white hover:bg-violet-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
                : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {voting ? '投票中...' : voted
              ? '✓ 投票済み'
              : isExhibitionMode
              ? (isTiebreaker ? 'AIの決選投票を確認して投票する' : 'AIの投票を確認して投票する')
              : isTiebreaker ? '決選投票する' : '投票する'}
          </button>
        </>
      )}

      {tiebreakerExcludesAuthors && (
        <p className="text-xs text-center text-gray-400">※ 決選作者は投票できません（投票資格者のみ表示）</p>
      )}

      <CompletionStatus
        completedUserIds={statusCompletedIds}
        participants={statusParticipants}
        completedLabel="投票完了"
        pendingLabel="投票中"
        nextPhaseText={isTiebreaker ? '全員が決選投票すると、結果発表へ進みます' : '全員が投票すると、結果発表へ進みます'}
        allDoneText={isTiebreaker ? '決選投票が完了しました！結果発表へ進みます' : '全員が投票しました！結果発表へ進みます'}
        secret={tournament.secret_voting || (isTiebreaker && tournament.impersonation_mode)}
      />

      {voteError && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center shadow-xl">
            <p className="text-3xl mb-3">⚠️</p>
            <p className="text-gray-800 font-bold mb-1">投票に失敗しました</p>
            <p className="text-sm text-gray-500 mb-5">通信エラーが発生しました。もう一度投票してください。</p>
            <button
              onClick={() => setVoteError(false)}
              className="w-full py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 active:scale-95 transition-all"
            >
              閉じて再投票する
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
