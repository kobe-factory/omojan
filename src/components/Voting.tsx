'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import CompletionStatus from './CompletionStatus'
import UserIcon from './UserIcon'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
}

interface Game {
  id: string
  round_number: number
  topic_card_id: string
}

interface Submission {
  id: string
  user_id: string
  hand_card_id: string
  position: 'before' | 'after'
  preamble: string | null
  created_at: string
  userName: string
  handCardText: string
}

interface Props {
  tournament: Tournament
  token: string
  game: Game
  currentUserId: string
  participants: User[]
  onVoted: () => Promise<void>
}

export default function Voting({ tournament, token, game, currentUserId, participants, onVoted }: Props) {
  const [topicText, setTopicText] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)
  const [voted, setVoted] = useState(false)
  const [votedUserIds, setVotedUserIds] = useState<string[]>([])

  useEffect(() => {
    supabase
      .from('cards')
      .select('text')
      .eq('id', game.topic_card_id)
      .single()
      .then(({ data }) => {
        if (data) setTopicText(data.text)
      })

    Promise.all([
      supabase
        .from('submissions')
        .select('id, user_id, hand_card_id, position, preamble, created_at')
        .eq('game_id', game.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('votes')
        .select('voter_user_id, submission_id')
        .eq('game_id', game.id),
    ]).then(async ([subRes, voteRes]) => {
      const subs = subRes.data ?? []
      const votes = voteRes.data ?? []

      setVotedUserIds(votes.map((v) => v.voter_user_id))

      // 自分の投票済み作品を復元
      const myVote = votes.find((v) => v.voter_user_id === currentUserId)
      if (myVote) {
        setVoted(true)
        setSelectedSubmissionId(myVote.submission_id)
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
          return {
            ...s,
            position: s.position as 'before' | 'after',
            userName: user?.name ?? '???',
            handCardText: card?.text ?? '',
          }
        })
      )

      setSubmissions(enriched)
    })
  }, [game.id, game.topic_card_id, currentUserId, participants])

  const completedUserIds = votedUserIds

  async function handleVote() {
    if (!selectedSubmissionId) {
      alert('投票する作品を選んでください')
      return
    }
    setVoting(true)
    await fetch(`/api/tournaments/${token}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voter_user_id: currentUserId,
        game_id: game.id,
        submission_id: selectedSubmissionId,
      }),
    })
    setVoted(true)
    setVoting(false)
    setVotedUserIds(prev => [...prev, currentUserId])
    await onVoted()
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-emerald-500 rounded-2xl p-4 text-center">
        <p className="text-emerald-100 text-xs mb-1">第{game.round_number}回戦</p>
        <h2 className="text-white text-lg font-bold">投票</h2>
        <p className="text-white text-xl font-bold mt-2 bg-emerald-600 rounded-xl px-4 py-3">
          お題：{topicText}
        </p>
      </div>

      <p className="text-sm text-gray-500 text-center">一番面白い作品に投票しよう！</p>

      <div className="space-y-3">
        {submissions.map((sub) => {
          const fullText =
            sub.position === 'before'
              ? `${sub.handCardText}${topicText}`
              : `${topicText}${sub.handCardText}`
          const isSelected = selectedSubmissionId === sub.id
          const isOwnSubmission = sub.user_id === currentUserId

          return (
            <button
              key={sub.id}
              disabled={isOwnSubmission}
              onClick={() => {
                if (!isOwnSubmission) {
                  setSelectedSubmissionId(sub.id)
                }
              }}
              className={`w-full text-left rounded-2xl p-4 transition-all border-2 ${
                isOwnSubmission
                  ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                  : isSelected
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-gray-200 bg-white hover:border-emerald-200'
              }`}
            >
              <p className="text-lg font-bold text-gray-800 mb-2">{fullText}</p>
              {sub.preamble && (
                <p className="text-sm text-gray-500 italic mb-2">「{sub.preamble}」</p>
              )}
              <div className="flex items-center gap-1.5 mt-1">
                <UserIcon name={sub.userName} size="xs" />
                <p className="text-xs text-gray-400">{sub.userName}</p>
              </div>
              {isOwnSubmission ? (
                <div className="mt-2 flex items-center gap-1">
                  <span className="text-gray-400 text-xs">自分の作品には投票できません</span>
                </div>
              ) : isSelected ? (
                <div className="mt-2 flex items-center gap-1">
                  <span className="text-emerald-500 text-xs font-medium">✓ 選択中</span>
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      <button
        onClick={handleVote}
        disabled={voting || !selectedSubmissionId}
        className={`w-full py-4 rounded-xl font-bold transition-all ${
          voted
            ? 'bg-green-500 text-white'
            : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
        }`}
      >
        {voting ? '投票中...' : voted ? '✓ 投票済み（変更できます）' : '投票する'}
      </button>

      <CompletionStatus
        completedUserIds={completedUserIds}
        participants={participants}
        completedLabel="投票完了"
        pendingLabel="投票中"
        nextPhaseText="全員が投票すると、結果発表へ進みます"
        allDoneText="全員が投票しました！結果発表へ進みます"
      />
    </div>
  )
}
