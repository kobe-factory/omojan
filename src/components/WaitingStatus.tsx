import UserIcon from './UserIcon'

interface User {
  id: string
  name: string
}

interface Props {
  waitingUserIds: string[]
  participants: User[]
  message: string
}

export default function WaitingStatus({ waitingUserIds, participants, message }: Props) {
  const waitingUsers = participants.filter((p) => waitingUserIds.includes(p.id))

  if (waitingUsers.length === 0) return null

  return (
    <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
      <p className="text-sm font-medium text-amber-700 mb-2">{message}</p>
      <div className="flex flex-wrap gap-2">
        {waitingUsers.map((u) => (
          <span key={u.id} className="flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs px-3 py-1 rounded-full">
            <UserIcon name={u.name} size="xs" />
            {u.name}
          </span>
        ))}
      </div>
    </div>
  )
}
