'use client'

import { useState, useEffect } from 'react'
import type { UserStats } from '@/app/api/analytics/route'
import UserIcon from './UserIcon'

function formatRate(rate: number): string {
  return rate.toFixed(3).replace(/^0/, '')
}

function rankLabel(rank: number): string {
  if (rank === 1) return '👑'
  if (rank === 2) return '2位'
  if (rank === 3) return '3位'
  return `${rank}位`
}

function getRank(stats: UserStats[], userId: string, getValue: (s: UserStats) => number): number {
  const sorted = [...stats].sort((a, b) => getValue(b) - getValue(a))
  const myIndex = sorted.findIndex((s) => s.userId === userId)
  if (myIndex === 0) return 1
  const myVal = getValue(sorted[myIndex])
  const rank = sorted.filter((s, i) => i < myIndex && getValue(s) > myVal).length + 1
  return rank
}

interface RankingRowProps {
  label: string
  stats: UserStats[]
  getValue: (s: UserStats) => number
  formatValue: (v: number) => string
  colorClass?: string
}

function RankingRow({ label, stats, getValue, formatValue, colorClass = 'text-emerald-600' }: RankingRowProps) {
  const sorted = [...stats].sort((a, b) => getValue(b) - getValue(a))
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-600">{label}</p>
      </div>
      <div className="divide-y divide-gray-50">
        {sorted.map((s, i) => {
          const rank = i === 0 ? 1 : getValue(s) === getValue(sorted[i - 1]) ? getRank(stats, s.userId, getValue) : i + 1
          const isFirst = rank === 1
          return (
            <div key={s.userId} className={`flex items-center justify-between px-3 py-2 ${isFirst ? 'bg-yellow-50' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs w-6 text-center font-bold text-gray-400">
                  {isFirst ? '👑' : `${rank}位`}
                </span>
                <UserIcon name={s.userName} size="xs" />
                <span className="text-xs text-gray-700">{s.userName}</span>
              </div>
              <span className={`text-sm font-bold ${isFirst ? 'text-yellow-600' : colorClass}`}>
                {formatValue(getValue(s))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PersonalStats() {
  const [stats, setStats] = useState<UserStats[]>([])
  const [loading, setLoading] = useState(true)
  const [openUserId, setOpenUserId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'individual' | 'ranking'>('ranking')

  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.json())
      .then((d) => {
        setStats(d.stats ?? [])
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div className="p-8 text-center text-gray-400 text-sm">成績を集計中...</div>
  }

  const hasMashData = stats.some((s) => s.buttonMashGames > 0)

  return (
    <div className="p-4 space-y-4">
      {/* サブタブ */}
      <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
        {(['ranking', 'individual'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === tab ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
            }`}
          >
            {tab === 'ranking' ? '🏆 ランキング' : '👤 個人成績'}
          </button>
        ))}
      </div>

      {activeTab === 'ranking' && (
        <div className="space-y-3">
          <RankingRow
            label="MVP回数"
            stats={stats}
            getValue={(s) => s.mvpCount}
            formatValue={(v) => `${v}回`}
            colorClass="text-yellow-600"
          />
          <RankingRow
            label="作成札採用率"
            stats={stats}
            getValue={(s) => s.cardUsageRate}
            formatValue={(v) => formatRate(v)}
            colorClass="text-blue-600"
          />
          <RankingRow
            label="ホームラン数"
            stats={stats}
            getValue={(s) => s.homeRuns}
            formatValue={(v) => `${v}本`}
            colorClass="text-red-600"
          />
          <RankingRow
            label="総ヒット数"
            stats={stats}
            getValue={(s) => s.totalHits}
            formatValue={(v) => `${v}本`}
            colorClass="text-emerald-600"
          />
          <RankingRow
            label="投票的中率"
            stats={stats}
            getValue={(s) => s.voteAccuracy}
            formatValue={(v) => formatRate(v)}
            colorClass="text-purple-600"
          />
          {hasMashData && (
            <RankingRow
              label="連打ゲーム勝率"
              stats={stats}
              getValue={(s) => s.buttonMashWinRate}
              formatValue={(v) => formatRate(v)}
              colorClass="text-orange-600"
            />
          )}
        </div>
      )}

      {activeTab === 'individual' && (
        <div className="space-y-3">
          {stats.map((s) => {
            const isOpen = openUserId === s.userId
            const mvpRank = getRank(stats, s.userId, (x) => x.mvpCount)
            return (
              <div key={s.userId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setOpenUserId(isOpen ? null : s.userId)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <UserIcon name={s.userName} size="sm" />
                    <span className="font-bold text-gray-800 text-sm">{s.userName}</span>
                    {mvpRank === 1 && <span className="text-xs">👑 MVP</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{s.mvpCount}勝</span>
                    <span className={`text-gray-400 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                    {/* MVP */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">MVP回数</span>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-yellow-600">{s.mvpCount}回</span>
                        <span className="text-xs text-gray-400">({rankLabel(mvpRank)})</span>
                      </div>
                    </div>

                    {/* 作成札採用率 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">作成札採用率</span>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-blue-600">{formatRate(s.cardUsageRate)}</span>
                        <span className="text-xs text-gray-400">({s.cardsUsed}/{s.cardsCreated}枚)</span>
                        <span className="text-xs text-gray-400">({rankLabel(getRank(stats, s.userId, (x) => x.cardUsageRate))})</span>
                      </div>
                    </div>

                    {/* ヒット数 */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">ヒット内訳</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { label: '1B', value: s.singles, color: 'bg-emerald-50 text-emerald-700' },
                          { label: '2B', value: s.doubles, color: 'bg-blue-50 text-blue-700' },
                          { label: '3B', value: s.triples, color: 'bg-purple-50 text-purple-700' },
                          { label: 'HR', value: s.homeRuns, color: 'bg-red-50 text-red-700' },
                        ].map((h) => (
                          <div key={h.label} className={`rounded-lg p-2 text-center ${h.color}`}>
                            <p className="text-[10px] font-bold">{h.label}</p>
                            <p className="text-base font-black">{h.value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-right text-xs text-gray-400 mt-1">
                        総ヒット {s.totalHits}本 ({rankLabel(getRank(stats, s.userId, (x) => x.totalHits))})
                        ／HR {rankLabel(getRank(stats, s.userId, (x) => x.homeRuns))}
                      </p>
                    </div>

                    {/* 投票的中率 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">投票的中率</span>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-purple-600">{formatRate(s.voteAccuracy)}</span>
                        <span className="text-xs text-gray-400">({s.voteHitCount}/{s.voteCastCount}票)</span>
                        <span className="text-xs text-gray-400">({rankLabel(getRank(stats, s.userId, (x) => x.voteAccuracy))})</span>
                      </div>
                    </div>

                    {/* 連打ゲーム（データがある場合のみ） */}
                    {hasMashData && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">連打ゲーム勝率</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-bold text-orange-600">
                            {s.buttonMashGames > 0 ? formatRate(s.buttonMashWinRate) : '—'}
                          </span>
                          {s.buttonMashGames > 0 && (
                            <>
                              <span className="text-xs text-gray-400">({s.buttonMashWins}/{s.buttonMashGames}戦)</span>
                              <span className="text-xs text-gray-400">({rankLabel(getRank(stats, s.userId, (x) => x.buttonMashWinRate))})</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
