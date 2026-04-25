import { getUserIcon } from '@/lib/userIcons'

interface Props {
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASS = {
  xs: 'w-5 h-5',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
}

export default function UserIcon({ name, size = 'sm', className = '' }: Props) {
  const icon = getUserIcon(name)
  if (!icon) return null

  return (
    <img
      src={icon}
      alt={name}
      className={`${SIZE_CLASS[size]} rounded-full object-cover shrink-0 ${className}`}
    />
  )
}
