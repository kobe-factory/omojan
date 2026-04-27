import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function CurrentPage() {
  const { data: active } = await supabaseServer
    .from('tournaments')
    .select('token')
    .eq('mode', 'production')
    .in('status', ['waiting_users', 'creating_cards', 'playing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active) {
    redirect(`/${active.token}`)
  }

  const { data: latest } = await supabaseServer
    .from('tournaments')
    .select('token')
    .eq('mode', 'production')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest) {
    redirect(`/${latest.token}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-2xl mb-2">🎴</p>
        <p className="text-gray-600">現在開催中の大会はありません</p>
      </div>
    </div>
  )
}
