/**
 * 個人AIキャラクター用データ生成スクリプト
 *
 * 使い方:
 *   npx tsx scripts/generate-ai-data.ts
 *
 * 必要な環境変数（.env.local から自動読み込み）:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 出力先: data/ai_characters/{username}.json
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// .env.local を読み込む
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ 環境変数が設定されていません。.env.local を確認してください。')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 個人AIキャラの対象ユーザー名
const TARGET_USERS = ['こんべ', 'スラパン', 'はじむ', 'カズさん', 'かっぴー']

// ファイル名マッピング
const FILE_NAME_MAP: Record<string, string> = {
  'こんべ': 'konbe',
  'スラパン': 'surapan',
  'はじむ': 'hajimu',
  'カズさん': 'kazusan',
  'かっぴー': 'kappii',
}

interface WorkData {
  topicText: string
  handText: string
  position: 'before' | 'after'
  fullText: string
  preamble: string | null
  voteCount: number
}

interface VotedWorkData {
  topicText: string
  handText: string
  position: 'before' | 'after'
  fullText: string
  creatorName: string
}

interface CharacterData {
  userId: string
  userName: string
  createdCards: string[]
  works: WorkData[]
  votedWorks: VotedWorkData[]
}

async function generateForUser(userId: string, userName: string): Promise<CharacterData> {
  console.log(`  📦 ${userName} のデータを取得中...`)

  // 作成した札
  const { data: cards } = await supabase
    .from('cards')
    .select('text')
    .eq('creator_user_id', userId)
    .order('created_at', { ascending: true })

  const createdCards = (cards ?? []).map((c) => c.text)

  // 作品一覧（手札＋お題＋位置＋前口上）
  const { data: subs } = await supabase
    .from('submissions')
    .select(`
      id,
      position,
      preamble,
      hand_card_id,
      game_id,
      cards!hand_card_id(text),
      games!game_id(topic_card_id)
    `)
    .eq('user_id', userId)

  const works: WorkData[] = []
  for (const s of subs ?? []) {
    const handText = (s.cards as { text: string } | null)?.text ?? ''
    const topicCardId = (s.games as { topic_card_id: string } | null)?.topic_card_id
    if (!topicCardId) continue

    const { data: topicCard } = await supabase
      .from('cards')
      .select('text')
      .eq('id', topicCardId)
      .single()

    const topicText = topicCard?.text ?? ''
    const fullText = s.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`

    const { count: voteCount } = await supabase
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .eq('submission_id', s.id)
      .eq('is_tiebreaker', false)

    works.push({
      topicText,
      handText,
      position: s.position as 'before' | 'after',
      fullText,
      preamble: s.preamble ?? null,
      voteCount: voteCount ?? 0,
    })
  }

  // 投票した作品一覧
  const { data: votes } = await supabase
    .from('votes')
    .select(`
      submission_id,
      submissions!submission_id(
        position,
        preamble,
        hand_card_id,
        game_id,
        user_id,
        cards!hand_card_id(text)
      )
    `)
    .eq('voter_user_id', userId)
    .eq('is_tiebreaker', false)

  const votedWorks: VotedWorkData[] = []
  for (const v of votes ?? []) {
    const sub = v.submissions as {
      position: string
      hand_card_id: string
      game_id: string
      user_id: string
      cards: { text: string } | null
    } | null
    if (!sub) continue

    const handText = sub.cards?.text ?? ''

    const { data: game } = await supabase
      .from('games')
      .select('topic_card_id')
      .eq('id', sub.game_id)
      .single()

    const { data: topicCard } = await supabase
      .from('cards')
      .select('text')
      .eq('id', game?.topic_card_id ?? '')
      .single()

    const topicText = topicCard?.text ?? ''
    const fullText = sub.position === 'before' ? `${handText}${topicText}` : `${topicText}${handText}`

    const { data: creator } = await supabase
      .from('users')
      .select('name')
      .eq('id', sub.user_id)
      .single()

    votedWorks.push({
      topicText,
      handText,
      position: sub.position as 'before' | 'after',
      fullText,
      creatorName: creator?.name ?? '???',
    })
  }

  console.log(`  ✅ ${userName}: 札${createdCards.length}枚 / 作品${works.length}件 / 投票${votedWorks.length}件`)

  return { userId, userName, createdCards, works, votedWorks }
}

async function main() {
  console.log('🚀 個人AIキャラクターデータ生成スクリプト開始\n')

  // 対象ユーザーをDBから取得
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .in('name', TARGET_USERS)

  if (error || !users || users.length === 0) {
    console.error('❌ ユーザーの取得に失敗しました:', error?.message ?? 'ユーザーが見つかりません')
    console.error('   対象ユーザー名:', TARGET_USERS.join(', '))
    process.exit(1)
  }

  console.log(`📋 対象ユーザー: ${users.map((u) => u.name).join(', ')}\n`)

  const outputDir = path.resolve(process.cwd(), 'data/ai_characters')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  for (const user of users) {
    const data = await generateForUser(user.id, user.name)
    const fileName = FILE_NAME_MAP[user.name] ?? user.name
    const filePath = path.join(outputDir, `${fileName}.json`)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    console.log(`  💾 保存: ${filePath}\n`)
  }

  console.log('🎉 全ユーザーのデータ生成が完了しました！')
  console.log(`📁 出力先: data/ai_characters/`)
}

main().catch((err) => {
  console.error('❌ エラー:', err)
  process.exit(1)
})
