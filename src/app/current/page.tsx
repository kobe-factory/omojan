'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function CurrentPage() {
  const router = useRouter()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function findAndRedirect() {
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

      // liff.state クエリパラメータをそのまま引き継いで LIFF 認証を維持する
      const search = window.location.search
      router.replace(`/${token}${search}`)
    }

    findAndRedirect()
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
