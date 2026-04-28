import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush } from '@/lib/line-push'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, mode')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  if (tournament.mode !== 'production') {
    return NextResponse.json({ error: '本番大会のみ通知できます' }, { status: 400 })
  }

  const { data: users } = await supabase
    .from('users')
    .select('line_user_id')
    .not('line_user_id', 'is', null)

  const lineUserIds = (users ?? []).map((u) => u.line_user_id).filter(Boolean) as string[]

  if (lineUserIds.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  await sendLinePush(
    lineUserIds,
    '新しい大会が始まりました！\nおもじゃんを開いてユーザー登録してください 🎴',
    LIFF_URL
  )

  return NextResponse.json({ sent: lineUserIds.length })
}
