'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import CompletionStatus from './CompletionStatus'
import type { CardPosition } from '@/types/database'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
  cards_per_user: number
}

interface Game {
  id: string
  round_number: number
  topic_card_id: string
}

interface HandCard {
  id: string
  text: string
  is_used: boolean
  created_at: string
}

interface Props {
  tournament: Tournament
  token: string
  game: Game
  currentUserId: string
  participants: User[]
  onSubmitted: () => Promise<void>
}

export default function GamePlay({ tournament, token, game, currentUserId, participants, onSubmitted }: Props) {
  const draftKey = `omojan:draft:submission:${game.id}:${currentUserId}`

  const [topicText, setTopicText] = useState('')
  const [handCards, setHandCards] = useState<HandCard[]>([])
  const [selectedCard, setSelectedCard] = useState<HandCard | null>(null)
  const [position, setPosition] = useState<CardPosition>('after')
  const [preamble, setPreamble] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedUserIds, setSubmittedUserIds] = useState<string[]>([])
  // 現在このゲームでDBに保存されている投稿カードID
  const [submittedCardId, setSubmittedCardId] = useState<string | null>(null)

  // 選択状態が変わるたびに下書き保存（送信済みの場合は保存しない）
  useEffect(() => {
    if (submitted || !selectedCard) return
    localStorage.setItem(draftKey, JSON.stringify({
      cardId: selectedCard.id,
      position,
      preamble,
    }))
  }, [selectedCard, position, preamble, submitted, draftKey])

  useEffect(() => {
    async function init() {
      const [topicRes, handsRes, subsRes] = await Promise.all([
        supabase.from('cards').select('text').eq('id', game.topic_card_id).single(),
        supabase.from('player_hands').select('card_id, is_used, cards(id, text, created_at)').eq('tournament_id', tournament.id).eq('user_id', currentUserId),
        supabase.from('submissions').select('user_id, hand_card_id, position, preamble').eq('game_id', game.id),
      ])

      if (topicRes.data) setTopicText(topicRes.data.text)

      const cards = (handsRes.data ?? []).map((h) => {
        const card = h.cards as unknown as { id: string; text: string; created_at: string }
        if (!card) return null
        return { ...card, is_used: h.is_used }
      }).filter(Boolean) as HandCard[]
      setHandCards(cards.sort((a, b) => a.created_at.localeCompare(b.created_at)))

      const ids = (subsRes.data ?? []).map((s) => s.user_id)
      setSubmittedUserIds(ids)

      // 自分の投稿済みデータを復元（DB優先）
      const mySub = (subsRes.data ?? []).find((s) => s.user_id === currentUserId)
      if (mySub) {
        setSubmitted(true)
        setPosition(mySub.position as CardPosition)
        setPreamble(mySub.preamble ?? '')
        setSubmittedCardId(mySub.hand_card_id)
        const myCard = cards.find((c) => c.id === mySub.hand_card_id)
        if (myCard) setSelectedCard(myCard)
        localStorage.removeItem(draftKey)
        return
      }

      // DB に投稿なし → localStorage ドラフトを復元
      try {
        const saved = localStorage.getItem(draftKey)
        if (saved) {
          const { cardId, position: dPos, preamble: dPreamble } = JSON.parse(saved)
          const draftCard = cards.find((c) => c.id === cardId)
          if (draftCard) {
            setSelectedCard(draftCard)
            setPosition(dPos as CardPosition)
            setPreamble(dPreamble ?? '')
          }
        }
      } catch { /* ignore */ }
    }

    init()
  }, [game.id, game.topic_card_id, tournament.id, currentUserId, draftKey])

  const completedUserIds = submittedUserIds

  async function handleSubmit() {
    if (!selectedCard) {
      alert('手札を選んでください')
      return
    }
    setSubmitting(true)
    await fetch(`/api/tournaments/${token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUserId,
        game_id: game.id,
        hand_card_id: selectedCard.id,
        position,
        preamble: preamble.trim() || null,
      }),
    })
    // 前回と別のカードに変えた場合、ローカルのis_usedを戻す
    if (submittedCardId && submittedCardId !== selectedCard.id) {
      setHandCards(prev => prev.map(c =>
        c.id === submittedCardId ? { ...c, is_used: false } : c
      ))
    }
    localStorage.removeItem(draftKey)
    setSubmittedCardId(selectedCard.id)
    setSubmitted(true)
    setSubmitting(false)
    setSubmittedUserIds(prev => [...prev, currentUserId])
    await onSubmitted()
  }

  return (
    <div className="p-4 space-y-4">
      {/* 回戦表示 */}
      <p className="text-center text-xs font-medium text-emerald-600 bg-emerald-50 rounded-full py-1">
        第{game.round_number}回戦
      </p>

      {/* お題カード */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <p className="text-xs font-medium text-yellow-600 mb-2">今回のお題</p>
        <p className="text-2xl font-bold text-gray-800 text-center py-2">{topicText || '...'}</p>
      </div>

      {/* 手札選択 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">手札から1枚選ぶ</h3>
        {handCards.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">手札がありません</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {handCards.map((card) => {
              // 過去ラウンドで使用済み（今ゲームの投稿カードは除く）
              const isTrulyUsed = card.is_used && card.id !== submittedCardId
              return (
                <button
                  key={card.id}
                  disabled={isTrulyUsed}
                  onClick={() => {
                    setSelectedCard(card)
                    if (submitted) setSubmitted(false)
                  }}
                  className={`py-3 px-3 rounded-xl text-sm font-medium transition-all text-left border relative ${
                    isTrulyUsed
                      ? 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed'
                      : selectedCard?.id === card.id
                        ? 'bg-emerald-500 text-white border-emerald-500 shadow-md'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-emerald-300'
                  }`}
                >
                  {card.text}
                  {isTrulyUsed && (
                    <span className="absolute top-1 right-1 text-xs text-gray-300">使用済</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 位置選択＋作品プレビュー */}
      {selectedCard && (
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => { setPosition('before'); if (submitted) setSubmitted(false) }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                position === 'before' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'
              }`}
            >
              手札を前につける
            </button>
            <button
              onClick={() => { setPosition('after'); if (submitted) setSubmitted(false) }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                position === 'after' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'
              }`}
            >
              手札を後につける
            </button>
          </div>

          <div className="bg-emerald-50 rounded-xl px-4 py-5 text-center">
            <p className="text-xs text-emerald-500 mb-3">作品プレビュー</p>
            <p className="text-xl font-bold text-gray-800 leading-relaxed">
              {position === 'before' ? (
                <><span className="text-emerald-600">{selectedCard.text}</span>{topicText}</>
              ) : (
                <>{topicText}<span className="text-emerald-600">{selectedCard.text}</span></>
              )}
            </p>
            <p className="text-xs text-gray-400 mt-3">
              <span className="text-emerald-500">■</span> 手札　<span className="text-gray-500">■</span> お題
            </p>
          </div>
        </div>
      )}

      {/* 前口上 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">前口上（任意）</h3>
        <p className="text-xs text-gray-400 mb-3">作品を説明するひと言</p>
        <textarea
          value={preamble}
          onChange={(e) => {
            setPreamble(e.target.value)
            if (submitted) setSubmitted(false)
          }}
          placeholder="例：これはつまり…"
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 resize-none"
        />
      </div>

      {/* 投稿ボタン */}
      <button
        onClick={handleSubmit}
        disabled={submitting || !selectedCard}
        className={`w-full py-4 rounded-xl font-bold transition-all ${
          submitted
            ? 'bg-green-500 text-white'
            : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
        }`}
      >
        {submitting ? '投稿中...' : submitted ? '✓ 投稿済み（修正できます）' : '作品を投稿する'}
      </button>

      <CompletionStatus
        completedUserIds={completedUserIds}
        participants={participants}
        completedLabel="投稿完了"
        pendingLabel="投稿中"
        nextPhaseText="全員が投稿すると、投票へ進みます"
        allDoneText="全員が投稿しました！投票へ進みます"
      />
    </div>
  )
}
