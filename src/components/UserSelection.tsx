'use client'

import { useState, useEffect } from 'react'
import UserIcon from './UserIcon'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
  token: string
  required_players: number
}

interface Props {
  tournament: Tournament
  allUsers: User[]
  participants: User[]
  currentUserId: string | null
  onJoin: (userId: string) => Promise<void>
  onLeave: (userId: string) => Promise<void>
}

export default function UserSelection({ tournament, allUsers, participants, currentUserId, onJoin, onLeave }: Props) {
  const [optimisticUserId, setOptimisticUserId] = useState<string | null>(currentUserId)
  const [isLoading, setIsLoading] = useState(false)

  // 親からcurrentUserIdが変わったら同期
  useEffect(() => {
    setOptimisticUserId(currentUserId)
  }, [currentUserId])

  const participantIds = new Set(participants.map((p) => p.id))
  const remaining = tournament.required_players - participants.length
  const notJoined = allUsers.filter((u) => !participantIds.has(u.id))

  async function handleSelect(user: User) {
    if (isLoading) return

    if (optimisticUserId === user.id) {
      // 選択解除
      setOptimisticUserId(null)
      setIsLoading(true)
      try {
        await onLeave(user.id)
      } finally {
        setIsLoading(false)
      }
    } else if (!participantIds.has(user.id) || optimisticUserId === user.id) {
      // 新規選択
      setOptimisticUserId(user.id)
      setIsLoading(true)
      try {
        if (currentUserId) await onLeave(currentUserId)
        await onJoin(user.id)
      } finally {
        setIsLoading(false)
      }
    }
  }

  return (
    <div className="p-4">
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <h2 className="text-lg font-bold text-gray-800 mb-1">参加者選択</h2>
        <p className="text-sm text-gray-500 mb-6">あなたの名前を選んでください</p>

        <div className="space-y-3">
          {allUsers.map((user) => {
            const isMe = optimisticUserId === user.id
            const isTaken = participantIds.has(user.id) && currentUserId !== user.id && optimisticUserId !== user.id

            return (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                disabled={isTaken || isLoading}
                className={`w-full py-4 px-5 rounded-xl text-left flex items-center justify-between transition-all ${
                  isMe
                    ? 'bg-emerald-500 text-white shadow-md'
                    : isTaken
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-50 text-gray-700 active:bg-emerald-50 active:text-emerald-600 border border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <UserIcon name={user.name} size="md" />
                  <span className="font-medium text-base">{user.name}</span>
                </div>
                <span className="text-sm">
                  {isMe ? '✓ 選択中' : isTaken ? '参加済み' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 参加状況 */}
      <div className="bg-emerald-50 rounded-2xl p-4 space-y-3">
        <p className="text-sm text-emerald-700 font-medium">
          参加者 {participants.length} / {tournament.required_players}名
        </p>

        {/* 参加済み */}
        {participants.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">参加済み</p>
            <div className="flex flex-wrap gap-2">
              {participants.map((p) => (
                <span key={p.id} className="bg-white text-emerald-600 text-sm px-3 py-1 rounded-full font-medium border border-emerald-200">
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 未参加 */}
        {notJoined.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">未参加</p>
            <div className="flex flex-wrap gap-2">
              {notJoined.map((u) => (
                <span key={u.id} className="bg-white text-gray-300 text-sm px-3 py-1 rounded-full border border-gray-100">
                  {u.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {remaining > 0 ? (
          <p className="text-xs text-gray-400">あと{remaining}名参加すると次のフェーズに進みます</p>
        ) : (
          <p className="text-xs text-green-600 font-medium">全員揃いました！次のフェーズに進みます</p>
        )}
      </div>
    </div>
  )
}
