import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { voter_user_id, game_id, submission_id } = await request.json()

  const { data: game } = await supabase
    .from('games')
    .select('id, status')
    .eq('id', game_id)
    .single()

  if (!game || game.status !== 'waiting_vote') {
    return NextResponse.json({ error: '投票フェーズではありません' }, { status: 400 })
  }

  // 既存の投票を削除して作り直し（修正対応）
  await supabase.from('votes').delete().eq('game_id', game_id).eq('voter_user_id', voter_user_id)

  const { error } = await supabase.from('votes').insert({
    game_id,
    voter_user_id,
    submission_id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
