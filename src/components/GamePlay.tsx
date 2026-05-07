'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import CompletionStatus from './CompletionStatus'
import UserIcon from './UserIcon'
import type { CardPosition } from '@/types/database'

interface User {
  id: string
  name: string
}

interface Tournament {
  id: string
  cards_per_user: number
  impersonation_mode: boolean
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
  const handOrderKey = `omojan:handorder:${tournament.id}:${currentUserId}`

  const [topicText, setTopicText] = useState('')
  const [handCards, setHandCards] = useState<HandCard[]>([])
  const [selectedCard, setSelectedCard] = useState<HandCard | null>(null)
  const [position, setPosition] = useState<CardPosition>('after')
  const [preamble, setPreamble] = useState('')
  const [preamblePosition, setPreamblePosition] = useState<'above' | 'below'>('above')
  const [impersonatedUserId, setImpersonatedUserId] = useState<string | null>(null)
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
      preamblePosition,
      impersonatedUserId,
    }))
  }, [selectedCard, position, preamble, preamblePosition, impersonatedUserId, submitted, draftKey])

  useEffect(() => {
    async function init() {
      const [topicRes, handsRes, subsRes] = await Promise.all([
        supabase.from('cards').select('text').eq('id', game.topic_card_id).single(),
        supabase.from('player_hands').select('card_id, is_used, cards(id, text, created_at)').eq('tournament_id', tournament.id).eq('user_id', currentUserId),
        supabase.from('submissions').select('user_id, hand_card_id, position, preamble, preamble_position, impersonated_user_id').eq('game_id', game.id),
      ])

      if (topicRes.data) setTopicText(topicRes.data.text)

      const cards = (handsRes.data ?? []).map((h) => {
        const card = h.cards as unknown as { id: string; text: string; created_at: string }
        if (!card) return null
        return { ...card, is_used: h.is_used }
      }).filter(Boolean) as HandCard[]

      // 手札の並び順をlocalStorageで固定（全回戦・リロード後も同じ順序）
      const savedOrder = localStorage.getItem(handOrderKey)
      if (savedOrder) {
        const orderMap = Object.fromEntries((JSON.parse(savedOrder) as string[]).map((id, i) => [id, i]))
        setHandCards([...cards].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999)))
      } else {
        const sorted = [...cards].sort((a, b) => a.created_at.localeCompare(b.created_at))
        localStorage.setItem(handOrderKey, JSON.stringify(sorted.map((c) => c.id)))
        setHandCards(sorted)
      }

      const ids = (subsRes.data ?? []).map((s) => s.user_id)
      setSubmittedUserIds(ids)

      // 自分の投稿済みデータを復元（DB優先）
      const mySub = (subsRes.data ?? []).find((s) => s.user_id === currentUserId)
      if (mySub) {
        setSubmitted(true)
        setPosition(mySub.position as CardPosition)
        setPreamble(mySub.preamble ?? '')
        setPreamblePosition(mySub.preamble_position ?? 'above')
        setSubmittedCardId(mySub.hand_card_id)
        if (mySub.impersonated_user_id) setImpersonatedUserId(mySub.impersonated_user_id)
        const myCard = cards.find((c) => c.id === mySub.hand_card_id)
        if (myCard) setSelectedCard(myCard)
        localStorage.removeItem(draftKey)
        return
      }

      // DB に投稿なし → localStorage ドラフトを復元
      try {
        const saved = localStorage.getItem(draftKey)
        if (saved) {
          const { cardId, position: dPos, preamble: dPreamble, preamblePosition: dPreamblePos, impersonatedUserId: dImpersonatedUserId } = JSON.parse(saved)
          const draftCard = cards.find((c) => c.id === cardId)
          if (draftCard) {
            setSelectedCard(draftCard)
            setPosition(dPos as CardPosition)
            setPreamble(dPreamble ?? '')
            setPreamblePosition(dPreamblePos ?? 'above')
            if (dImpersonatedUserId) setImpersonatedUserId(dImpersonatedUserId)
          }
        }
      } catch { /* ignore */ }
    }

    init()
  }, [game.id, game.topic_card_id, tournament.id, currentUserId, draftKey])

  // 他ユーザーの投稿をリアルタイムで反映（submittedUserIds のみ更新）
  useEffect(() => {
    const channel = supabase
      .channel(`submissions-${game.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'submissions', filter: `game_id=eq.${game.id}` },
        () => {
          supabase
            .from('submissions')
            .select('user_id')
            .eq('game_id', game.id)
            .then(({ data }) => {
              if (data) setSubmittedUserIds(data.map((s) => s.user_id))
            })
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [game.id])

  const completedUserIds = submittedUserIds

  async function handleSubmit() {
    if (!selectedCard) return
    if (tournament.impersonation_mode && !impersonatedUserId) return
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
        preamble_position: preamblePosition,
        impersonated_user_id: tournament.impersonation_mode ? impersonatedUserId : null,
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
        {!selectedCard && handCards.length > 0 && (
          <p className="text-xs text-red-400 mt-2 text-center">手札を選択してください</p>
        )}
      </div>

      {/* なりすましユーザー選択 */}
      {tournament.impersonation_mode && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">なりすますユーザー</h3>
          <p className="text-xs text-gray-400 mb-3">投票画面でこのユーザーの作品として表示されます</p>
          <div className="grid grid-cols-2 gap-2">
            {participants.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setImpersonatedUserId(p.id)
                  if (submitted) setSubmitted(false)
                }}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-all border-2 ${
                  impersonatedUserId === p.id
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-200'
                }`}
              >
                <UserIcon name={p.name} size="sm" />
                {p.name}
                {impersonatedUserId === p.id && <span className="ml-auto text-xs">🎭</span>}
              </button>
            ))}
          </div>
          {impersonatedUserId ? (
            <p className="text-xs text-purple-600 mt-2 text-center">
              🎭 {participants.find((p) => p.id === impersonatedUserId)?.name} としてなりすまし中
            </p>
          ) : (
            <p className="text-xs text-red-400 mt-2 text-center">なりすますユーザーを選択してください</p>
          )}
        </div>
      )}

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
            {preamble && preamblePosition === 'above' && (
              <p className="text-sm text-gray-500 italic mb-2">「{preamble}」</p>
            )}
            <p className="text-xl font-bold text-gray-800 leading-relaxed">
              {position === 'before' ? (
                <><span className="text-emerald-600">{selectedCard.text}</span>{topicText}</>
              ) : (
                <>{topicText}<span className="text-emerald-600">{selectedCard.text}</span></>
              )}
            </p>
            {preamble && preamblePosition === 'below' && (
              <p className="text-sm text-gray-500 italic mt-2">「{preamble}」</p>
            )}
            <p className="text-xs text-gray-400 mt-3">
              <span className="text-emerald-500">■</span> 手札　<span className="text-gray-500">■</span> お題
            </p>
            {tournament.impersonation_mode && impersonatedUserId && (() => {
              const imp = participants.find((p) => p.id === impersonatedUserId)
              return imp ? (
                <div className="flex items-center justify-center gap-1.5 mt-3 pt-3 border-t border-emerald-200">
                  <UserIcon name={imp.name} size="xs" />
                  <p className="text-xs text-gray-500">{imp.name}</p>
                </div>
              ) : null
            })()}
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
        {preamble && (
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mt-3">
            <button
              onClick={() => { setPreamblePosition('above'); if (submitted) setSubmitted(false) }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                preamblePosition === 'above' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'
              }`}
            >
              作品の上に表示
            </button>
            <button
              onClick={() => { setPreamblePosition('below'); if (submitted) setSubmitted(false) }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                preamblePosition === 'below' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'
              }`}
            >
              作品の下に表示
            </button>
          </div>
        )}
      </div>

      {/* 投稿ボタン */}
      <button
        onClick={handleSubmit}
        disabled={submitting || !selectedCard || (tournament.impersonation_mode && !impersonatedUserId)}
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
