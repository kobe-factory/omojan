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
}

export default function CardCreation({ tournament, token, currentUserId, participants, onSubmitted }: Props) {
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

  async function handleSubmit() {
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

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">札を作ろう！</h2>
        <p className="text-sm text-gray-500 mb-1">
          {tournament.cards_per_user}枚の札を作成してください
        </p>
        <p className="text-xs text-gray-400 mb-6">単語や短いフレーズを自由に書いてね</p>

        <div className="space-y-2">
          {texts.map((text, i) => {
            const isDirtySlot = i >= tournament.cards_per_user - tournament.dirty_cards_per_user
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-300 w-6 text-right">{i + 1}</span>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => {
                    const next = [...texts]
                    next[i] = e.target.value
                    setTexts(next)
                    if (submitted) setSubmitted(false)
                  }}
                  placeholder={isDirtySlot ? '下ネタ札専用' : `札 ${i + 1}`}
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors ${
                    isDirtySlot
                      ? 'border-pink-200 bg-pink-50 focus:border-pink-400 placeholder:text-pink-300'
                      : 'border-gray-200 focus:border-emerald-400'
                  }`}
                />
              </div>
            )
          })}
        </div>

        <div className="mt-6">
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span>{filledCount}/{tournament.cards_per_user}枚</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || filledCount < tournament.cards_per_user}
            className={`w-full py-4 rounded-xl font-bold transition-all ${
              submitted
                ? 'bg-green-500 text-white'
                : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {submitting ? '送信中...' : submitted ? '✓ 送信済み（修正できます）' : '札を送信する'}
          </button>
        </div>
      </div>

      <CompletionStatus
        completedUserIds={completedUserIds}
        participants={participants}
        completedLabel="作成完了"
        pendingLabel="作成中"
        nextPhaseText="全員が作成すると、ゲームが始まります"
        allDoneText="全員が完了しました！ゲームが始まります"
      />
    </div>
  )
}
