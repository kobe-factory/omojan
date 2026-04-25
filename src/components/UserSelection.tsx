'use client'

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
  const participantIds = new Set(participants.map((p) => p.id))
  const remaining = tournament.required_players - participants.length

  async function handleSelect(user: User) {
    if (currentUserId === user.id) {
      await onLeave(user.id)
    } else if (!participantIds.has(user.id)) {
      if (currentUserId) {
        await onLeave(currentUserId)
      }
      await onJoin(user.id)
    }
  }

  return (
    <div className="p-4">
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <h2 className="text-lg font-bold text-gray-800 mb-1">参加者選択</h2>
        <p className="text-sm text-gray-500 mb-6">あなたの名前を選んでください</p>

        <div className="space-y-3">
          {allUsers.map((user) => {
            const isMe = currentUserId === user.id
            const isTaken = participantIds.has(user.id) && !isMe

            return (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                disabled={isTaken}
                className={`w-full py-4 px-5 rounded-xl text-left flex items-center justify-between transition-all ${
                  isMe
                    ? 'bg-emerald-500 text-white shadow-md'
                    : isTaken
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 border border-gray-200'
                }`}
              >
                <span className="font-medium text-base">{user.name}</span>
                <span className="text-sm">
                  {isMe ? '✓ 選択中' : isTaken ? '参加済み' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-emerald-50 rounded-2xl p-4">
        <p className="text-sm text-emerald-700 font-medium mb-2">
          参加者 {participants.length} / {tournament.required_players}名
        </p>
        {participants.length === 0 ? (
          <p className="text-sm text-gray-400">まだ誰も参加していません</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {participants.map((p) => (
              <span key={p.id} className="bg-white text-emerald-600 text-sm px-3 py-1 rounded-full font-medium border border-emerald-200">
                {p.name}
              </span>
            ))}
          </div>
        )}
        {remaining > 0 ? (
          <p className="text-xs text-gray-400 mt-3">あと{remaining}名参加すると次のフェーズに進みます</p>
        ) : (
          <p className="text-xs text-green-600 mt-3 font-medium">全員揃いました！次のフェーズに進みます</p>
        )}
      </div>
    </div>
  )
}
