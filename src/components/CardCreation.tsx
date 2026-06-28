'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import CompletionStatus from './CompletionStatus'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
  cards_per_user: number
  dirty_cards_per_user: number
}

interface Props {
  tournament: Tournament
  token: string
  currentUserId: string
  participants: User[]
  onSubmitted: () => Promise<void>
  allUsers?: User[]
  isExhibitionMode?: boolean
}

export default function CardCreation({ tournament, token, currentUserId, participants, onSubmitted, allUsers, isExhibitionMode }: Props) {
  const draftKey = `omojan:draft:cards:${tournament.id}:${currentUserId}`

  const [texts, setTexts] = useState<string[]>(() => {
    if (typeof window === 'undefined') return Array(tournament.cards_per_user).fill('')
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length === tournament.cards_per_user) return parsed
      }
    } catch { /* ignore */ }
    return Array(tournament.cards_per_user).fill('')
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({})
  const [exhibitionTexts, setExhibitionTexts] = useState<{ regular: string[]; dirty: string[] } | null>(null)

  // texts が変わるたびに下書き保存（送信済みの場合は保存しない）
  useEffect(() => {
    if (submitted) return
    localStorage.setItem(draftKey, JSON.stringify(texts))
  }, [texts, submitted, draftKey])

  useEffect(() => {
    // 既存の作成済みカードを取得
    supabase
      .from('cards')
      .select('creator_user_id, text, is_dirty')
      .eq('tournament_id', tournament.id)
      .then(({ data }) => {
        if (!data) return
        const counts: Record<string, number> = {}
        const myRegular: string[] = []
        const myDirty: string[] = []
        for (const c of data) {
          counts[c.creator_user_id] = (counts[c.creator_user_id] ?? 0) + 1
          if (c.creator_user_id === currentUserId) {
            if (c.is_dirty) myDirty.push(c.text)
            else myRegular.push(c.text)
          }
        }
        setCardCounts(counts)
        const myCards = [...myRegular, ...myDirty]
        if (myCards.length > 0) {
          const padded = [...myCards, ...Array(Math.max(0, tournament.cards_per_user - myCards.length)).fill('')]
          setTexts(padded)
          setSubmitted(true)
          localStorage.removeItem(draftKey)
        }
      })
  }, [tournament.id, tournament.cards_per_user, currentUserId, draftKey])

  // エキシビション：AIが生成した札の候補を取得・リアルタイム監視
  useEffect(() => {
    if (!isExhibitionMode) return

    async function fetchSuggestion() {
      const { data } = await supabase
        .from('exhibition_card_suggestions')
        .select('texts')
        .eq('tournament_id', tournament.id)
        .eq('user_id', currentUserId)
        .maybeSingle()

      if (data?.texts) {
        const { regular, dirty } = data.texts as { regular: string[]; dirty: string[] }
        setExhibitionTexts({ regular, dirty })
        setTexts([...regular, ...dirty])
      }
    }

    fetchSuggestion()

    const channel = supabase
      .channel(`exhibition-cards-${tournament.id}-${currentUserId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'exhibition_card_suggestions',
        filter: `tournament_id=eq.${tournament.id}`,
      }, fetchSuggestion)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isExhibitionMode, tournament.id, currentUserId])

  // 他ユーザーのカード作成をリアルタイムで反映（cardCounts のみ更新）
  useEffect(() => {
    const channel = supabase
      .channel(`cards-${tournament.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'cards', filter: `tournament_id=eq.${tournament.id}` },
        () => {
          supabase
            .from('cards')
            .select('creator_user_id')
            .eq('tournament_id', tournament.id)
            .then(({ data }) => {
              if (!data) return
              const counts: Record<string, number> = {}
              for (const c of data) {
                counts[c.creator_user_id] = (counts[c.creator_user_id] ?? 0) + 1
              }
              setCardCounts(counts)
            })
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournament.id])

  const completedUserIds = participants
    .filter((p) => (cardCounts[p.id] ?? 0) >= tournament.cards_per_user)
    .map((p) => p.id)

  const absentUsers = allUsers
    ? allUsers.filter((u) => !participants.some((p) => p.id === u.id))
    : undefined

  async function handleSubmit() {
    if (isExhibitionMode && exhibitionTexts) {
      setSubmitting(true)
      await fetch(`/api/tournaments/${token}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUserId, texts: exhibitionTexts.regular, dirty_texts: exhibitionTexts.dirty }),
      })
      setSubmitted(true)
      setSubmitting(false)
      setCardCounts(prev => ({ ...prev, [currentUserId]: tournament.cards_per_user }))
      await onSubmitted()
      return
    }

    const filled = texts.filter((t) => t.trim() !== '')
    if (filled.length < tournament.cards_per_user) {
      alert(`${tournament.cards_per_user}枚すべて入力してください`)
      return
    }
    const regularCount = tournament.cards_per_user - tournament.dirty_cards_per_user
    const regularTexts = texts.slice(0, regularCount).filter((t) => t.trim() !== '')
    const dirtyTexts = texts.slice(regularCount).filter((t) => t.trim() !== '')
    setSubmitting(true)
    await fetch(`/api/tournaments/${token}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, texts: regularTexts, dirty_texts: dirtyTexts }),
    })
    localStorage.removeItem(draftKey)
    setSubmitted(true)
    setSubmitting(false)
    setCardCounts(prev => ({ ...prev, [currentUserId]: tournament.cards_per_user }))
    await onSubmitted()
  }

  const filledCount = texts.filter((t) => t.trim() !== '').length

  // エキシビション：AIがまだ生成していない場合
  if (isExhibitionMode && !exhibitionTexts) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
          <div className="animate-pulse mb-4">
            <p className="text-3xl mb-2">🤖</p>
          </div>
          <p className="text-gray-700 font-medium mb-1">AIがあなたの札を作成中...</p>
          <p className="text-sm text-gray-400">しばらくお待ちください</p>
        </div>
        <CompletionStatus
          completedUserIds={completedUserIds}
          participants={participants}
          completedLabel="確認完了"
          pendingLabel="確認待ち"
          absentUsers={absentUsers}
          nextPhaseText="全員が確認するとゲームが始まります"
          allDoneText="全員が完了しました！ゲームが始まります"
        />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        {isExhibitionMode ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🤖</span>
              <h2 className="text-lg font-bold text-gray-800">AIが作った札</h2>
            </div>
            <p className="text-sm text-gray-500 mb-1">あなたのAIが作成した{tournament.cards_per_user}枚の札です</p>
            <p className="text-xs text-gray-400 mb-6">内容を確認して「確認完了」を押してください</p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-gray-800 mb-1">札を作ろう！</h2>
            <p className="text-sm text-gray-500 mb-1">
              {tournament.cards_per_user}枚の札を作成してください
            </p>
            <p className="text-xs text-gray-400 mb-6">単語や短いフレーズを自由に書いてね</p>
          </>
        )}

        <div className="space-y-2">
          {texts.map((text, i) => {
            const isDirtySlot = i >= tournament.cards_per_user - tournament.dirty_cards_per_user
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-300 w-6 text-right">{i + 1}</span>
                <input
                  type="text"
                  value={text}
                  disabled={isExhibitionMode}
                  onChange={(e) => {
                    if (isExhibitionMode) return
                    const next = [...texts]
                    next[i] = e.target.value
                    setTexts(next)
                    if (submitted) setSubmitted(false)
                  }}
                  placeholder={isDirtySlot ? '下ネタ札専用' : `札 ${i + 1}`}
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors ${
                    isExhibitionMode
                      ? isDirtySlot
                        ? 'border-pink-200 bg-pink-50 text-gray-600 cursor-default'
                        : 'border-gray-200 bg-gray-50 text-gray-600 cursor-default'
                      : isDirtySlot
                      ? 'border-pink-200 bg-pink-50 focus:border-pink-400 placeholder:text-pink-300'
                      : 'border-gray-200 focus:border-emerald-400'
                  }`}
                />
              </div>
            )
          })}
        </div>

        <div className="mt-6">
          {!isExhibitionMode && (
            <div className="flex justify-between text-xs text-gray-400 mb-2">
              <span>{filledCount}/{tournament.cards_per_user}枚</span>
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || (!isExhibitionMode && filledCount < tournament.cards_per_user)}
            className={`w-full py-4 rounded-xl font-bold transition-all ${
              submitted
                ? 'bg-green-500 text-white'
                : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {submitting ? '送信中...' : submitted
              ? (isExhibitionMode ? '✓ 確認完了' : '✓ 送信済み（修正できます）')
              : (isExhibitionMode ? 'AIの札を確認して完了する' : '札を送信する')}
          </button>
        </div>
      </div>

      <CompletionStatus
        completedUserIds={completedUserIds}
        participants={participants}
        completedLabel={isExhibitionMode ? '確認完了' : '作成済み'}
        pendingLabel={isExhibitionMode ? '確認待ち' : '未作成'}
        absentUsers={absentUsers}
        nextPhaseText="全員が完了すると、ゲームが始まります"
        allDoneText="全員が完了しました！ゲームが始まります"
      />
    </div>
  )
}
