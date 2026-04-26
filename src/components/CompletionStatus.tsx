import UserIcon from './UserIcon'

interface User {
  id: string
  name: string
}

interface Props {
  completedUserIds: string[]
  participants: User[]
  completedLabel?: string
  pendingLabel?: string
}

export default function CompletionStatus({
  completedUserIds,
  participants,
  completedLabel = '完了',
  pendingLabel = '未完了',
}: Props) {
  const completed = participants.filter((p) => completedUserIds.includes(p.id))
  const pending = participants.filter((p) => !completedUserIds.includes(p.id))

  return (
    <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
      {completed.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-1">{completedLabel}</p>
          <div className="flex flex-wrap gap-2">
            {completed.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 bg-white text-emerald-600 text-sm px-3 py-1 rounded-full font-medium border border-emerald-200">
                <UserIcon name={p.name} size="xs" />
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-1">{pendingLabel}</p>
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 bg-white text-gray-300 text-sm px-3 py-1 rounded-full border border-gray-100">
                <UserIcon name={p.name} size="xs" />
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 ? (
        <p className="text-xs text-gray-400">あと{pending.length}名の完了を待っています。全員完了すると次のフェーズへ進みます</p>
      ) : (
        <p className="text-xs text-emerald-600 font-medium">全員完了しました！次のフェーズへ進みます</p>
      )}
    </div>
  )
}
