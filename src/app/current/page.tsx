'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export const PENDING_LINE_USER_ID_KEY = 'omojan:pendingLineUserId'

export default function CurrentPage() {
  const router = useRouter()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function init() {
      // 1. LIFF init を /current（LIFFエンドポイント）で行う
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID
      if (liffId) {
        try {
          const { default: liff } = await import('@line/liff')
          await liff.init({ liffId })
          if (liff.isInClient()) {
            const profile = await liff.getProfile()
            sessionStorage.setItem(PENDING_LINE_USER_ID_KEY, profile.userId)
          }
        } catch {}
      }

      // 2. 進行中の本番大会 → 最新大会の順に取得
      const { data: active } = await supabase
        .from('tournaments')
        .select('token')
        .eq('mode', 'production')
        .in('status', ['waiting_users', 'creating_cards', 'playing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let token = active?.token

      if (!token) {
        const { data: latest } = await supabase
          .from('tournaments')
          .select('token')
          .eq('mode', 'production')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        token = latest?.token
      }

      if (!token) {
        setNotFound(true)
        return
      }

      // 3. liff.state を渡さずクリーンに遷移
      router.replace(`/${token}`)
    }

    init()
  }, [router])

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-2xl mb-2">🎴</p>
          <p className="text-gray-600">現在開催中の大会はありません</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-400 text-sm">読み込み中...</p>
    </div>
  )
}
