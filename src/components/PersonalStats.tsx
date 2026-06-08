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

// ツールチップモーダル
function TooltipModal({ title, description, onClose }: { title: string; description: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-bold text-gray-800 text-sm mb-2">{title}</p>
        <p className="text-xs text-gray-600 leading-relaxed">{description}</p>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 bg-gray-100 rounded-xl text-xs font-bold text-gray-600"
        >
          閉じる
        </button>
      </div>
    </div>
  )
}

// ツールチップアイコン
function TooltipIcon({ title, description }: { title: string; description: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onPointerDown={(e) => { e.stopPropagation(); setOpen(true) }}
        className="ml-1 w-6 h-6 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold flex items-center justify-center flex-shrink-0"
      >
        ?
      </button>
      {open && <TooltipModal title={title} description={description} onClose={() => setOpen(false)} />}
    </>
  )
}

const TOOLTIPS: Record<string, string> = {
  'MVP回数': 'その回戦で最も多く票を獲得した作品を出した回数です。同票の場合は決選（決選投票・連打ゲーム）で勝った場合も含みます。',
  '作成札採用率': '自分が作成した札が誰かの作品（自分自身も含む）に使われた回数 ÷ 作成した札の総枚数です。どれだけ使いやすい・面白い札を作れているかの指標。野球の打率と同じ形式（.xxx）で表示されます。',
  'ホームラン数': '1つの作品で4票以上を獲得した回数です。全員（または大多数）が自分の作品に投票した神回です。',
  '総ヒット数': '1票以上を獲得した作品の総数です。1B〜HRの合計値です。',
  '平均得票数': '出場した1回戦あたり、自分の作品が平均何票を獲得したかです。高いほど安定した評価を受けていることを意味します。',
  '連打ゲーム勝率': '連打ゲームに出場した回数のうち、勝利した割合です。',
  '連打最高記録': '3秒間の連打ゲームで出した自己最高タップ数です。',
  '連打平均': '連打ゲームに出場した全セッションの平均タップ数です。',
  '1B（シングル）': '1票を獲得した作品の数です。票を入れてもらえた！という基本ヒットです。',
  '2B（ダブル）': '2票を獲得した作品の数です。半数以上に評価されたことを意味します（5人中2票）。',
  '3B（トリプル）': '3票以上を獲得した作品の数です。かなりの高評価！',
  'HR（ホームラン）': '4票以上を獲得した作品の数です。ほぼ全員が認めた神作品！',
  'MVP勝率': '出場した回戦数のうちMVPを取った割合です。コンスタントに勝てるかの安定感指標です。野球の打率と同じ形式（.xxx）で表示されます。',
  'ホームラン率': '出場した回戦数のうち4票以上を獲得した割合です。大きな一発をどれだけ打てるかの指標です。',
  '完封数': '投票が行われた回戦で、1票も入らなかった回数です。少ないほど良い！（笑）',
  '完封率': '投票が行われた回戦のうち、0票だった回の割合です。完封王は不名誉な称号…',
  '前口上使用率': '作品投稿時に前口上（コメント）を入力した回の割合です。前口上でどれだけ場を盛り上げているかの指標です。',
  '最高得票数': '1回戦で獲得した最多票数の自己ベストです。その回戦で何票集めることができたか。',
  '多数派投票率': '自分が投じた票のうち、最終的にMVPになった作品に投票していた割合です。自分がMVPを取ったゲームは自分の作品に投票できないため集計から除外しています。高いほど「みんなと同じ感覚を持っている」＝多数派。低いほど個性派・天邪鬼！野球の打率と同じ形式（.xxx）で表示されます。',
  '孤独投票数': '自分だけが票を入れたのに落選した回数です。誰にも理解されなかった孤高の美学の記録…！',
  '自作札使用率': '自分が出場した回戦のうち、自分が作った札を自分の作品に使った回の割合です。自己プロデュース力の指標？',
  '前口上平均文字数': '前口上を使ったときの平均文字数です。長い前口上で場を盛り上げるタイプか、短く刺すタイプか。',
}

interface RankingRowProps {
  label: string
  tooltipKey?: string
  stats: UserStats[]
  getValue: (s: UserStats) => number
  formatValue: (v: number) => string
  colorClass?: string
  filter?: (s: UserStats) => boolean
  ascending?: boolean  // trueなら小さい値が上位（完封数など）
}

function RankingRow({ label, tooltipKey, stats, getValue, formatValue, colorClass = 'text-emerald-600', filter, ascending }: RankingRowProps) {
  const filtered = filter ? stats.filter(filter) : stats
  const sorted = [...filtered].sort((a, b) => ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a))
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center">
        <p className="text-xs font-bold text-gray-600 flex-1">{label}</p>
        {(tooltipKey ?? label) && <TooltipIcon title={tooltipKey ?? label} description={TOOLTIPS[tooltipKey ?? label] ?? ''} />}
      </div>
      <div className="divide-y divide-gray-50">
        {sorted.map((s, i) => {
          const rank = i === 0 ? 1 : getValue(s) === getValue(sorted[i - 1]) ? getRank(filtered, s.userId, getValue) : i + 1
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

interface AiComment {
  user_id: string
  overall_comment: string | null
  last_tournament_comment: string | null
  card_analysis_comment: string | null
  nickname: string | null
}

export default function PersonalStats() {
  const [stats, setStats] = useState<UserStats[]>([])
  const [aiComments, setAiComments] = useState<AiComment[]>([])
  const [loading, setLoading] = useState(true)
  const [openUserId, setOpenUserId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'individual' | 'ranking'>('ranking')

  useEffect(() => {
    Promise.all([
      fetch('/api/analytics').then((r) => r.json()),
      fetch('/api/ai/generate-comments').then((r) => r.json()),
    ]).then(([analytics, aiData]) => {
      setStats(analytics.stats ?? [])
      setAiComments(aiData.comments ?? [])
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
            label="平均得票数"
            stats={stats}
            getValue={(s) => s.avgVotesPerGame}
            formatValue={(v) => v.toFixed(2)}
            colorClass="text-purple-600"
          />
          <RankingRow
            label="MVP勝率"
            stats={stats}
            getValue={(s) => s.mvpWinRate}
            formatValue={(v) => formatRate(v)}
            colorClass="text-yellow-600"
            filter={(s) => s.gamesParticipated > 0}
          />
          <RankingRow
            label="ホームラン率"
            stats={stats}
            getValue={(s) => s.homeRunRate}
            formatValue={(v) => formatRate(v)}
            colorClass="text-red-600"
            filter={(s) => s.gamesParticipated > 0}
          />
          <RankingRow
            label="最高得票数"
            stats={stats}
            getValue={(s) => s.maxVotesInGame}
            formatValue={(v) => `${v}票`}
            colorClass="text-emerald-600"
          />
          <RankingRow
            label="前口上使用率"
            stats={stats}
            getValue={(s) => s.preambleUsageRate}
            formatValue={(v) => formatRate(v)}
            colorClass="text-teal-600"
            filter={(s) => s.gamesParticipated > 0}
          />
          <RankingRow
            label="完封数"
            stats={stats}
            getValue={(s) => s.shutoutCount}
            formatValue={(v) => `${v}回`}
            colorClass="text-gray-500"
            ascending={true}
            filter={(s) => s.gamesParticipated > 0}
          />
          <div className="pt-1 pb-0.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1">個性ランキング</p>
          </div>
          <RankingRow
            label="多数派投票率"
            stats={stats}
            getValue={(s) => s.majorityVoteRate}
            formatValue={(v) => formatRate(v)}
            colorClass="text-indigo-600"
            filter={(s) => s.votesCastCount > 0}
          />
          <RankingRow
            label="孤独投票数"
            stats={stats}
            getValue={(s) => s.loneVoteCount}
            formatValue={(v) => `${v}回`}
            colorClass="text-pink-600"
            ascending={true}
          />
          <RankingRow
            label="自作札使用率"
            stats={stats}
            getValue={(s) => s.selfCardUsageRate}
            formatValue={(v) => formatRate(v)}
            colorClass="text-violet-600"
            filter={(s) => s.gamesParticipated > 0}
          />
          <RankingRow
            label="前口上平均文字数"
            stats={stats}
            getValue={(s) => s.avgPreambleLength}
            formatValue={(v) => `${v}文字`}
            colorClass="text-teal-600"
            filter={(s) => s.preambleCount > 0}
          />
          {hasMashData && (
            <>
              <RankingRow
                label="連打ゲーム勝率"
                stats={stats}
                getValue={(s) => s.buttonMashWinRate}
                formatValue={(v) => formatRate(v)}
                colorClass="text-orange-600"
                filter={(s) => s.buttonMashGames > 0}
              />
              <RankingRow
                label="連打最高記録"
                tooltipKey="連打最高記録"
                stats={stats}
                getValue={(s) => s.bestTapCount}
                formatValue={(v) => `${v}回`}
                colorClass="text-orange-500"
                filter={(s) => s.totalTapSessions > 0}
              />
              <RankingRow
                label="連打平均"
                tooltipKey="連打平均"
                stats={stats}
                getValue={(s) => s.avgTapCount}
                formatValue={(v) => `${v}回`}
                colorClass="text-orange-400"
                filter={(s) => s.totalTapSessions > 0}
              />
            </>
          )}
        </div>
      )}

      {activeTab === 'individual' && (
        <div className="space-y-3">
          {stats.map((s) => {
            const isOpen = openUserId === s.userId
            const mvpRank = getRank(stats, s.userId, (x) => x.mvpCount)
            const aiComment = aiComments.find((c) => c.user_id === s.userId)
            return (
              <div key={s.userId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setOpenUserId(isOpen ? null : s.userId)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <UserIcon name={s.userName} size="sm" />
                    <div className="flex flex-col items-start">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-gray-800 text-sm">{s.userName}</span>
                        {mvpRank === 1 && <span className="text-xs">👑</span>}
                      </div>
                      {aiComment?.nickname && (
                        <span className="text-[10px] text-purple-500 font-bold bg-purple-50 px-1.5 py-0.5 rounded-full leading-tight">
                          {aiComment.nickname}
                        </span>
                      )}
                    </div>
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
                      <div className="flex items-center">
                        <span className="text-xs text-gray-500">MVP回数</span>
                        <TooltipIcon title="MVP回数" description={TOOLTIPS['MVP回数']} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-yellow-600">{s.mvpCount}回</span>
                        <span className="text-xs text-gray-400">({rankLabel(mvpRank)})</span>
                      </div>
                    </div>

                    {/* 作成札採用率 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="text-xs text-gray-500">作成札採用率</span>
                        <TooltipIcon title="作成札採用率" description={TOOLTIPS['作成札採用率']} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-blue-600">{formatRate(s.cardUsageRate)}</span>
                        <span className="text-xs text-gray-400">({s.cardsUsed}/{s.cardsCreated}枚)</span>
                        <span className="text-xs text-gray-400">({rankLabel(getRank(stats, s.userId, (x) => x.cardUsageRate))})</span>
                      </div>
                    </div>

                    {/* ヒット数 */}
                    <div>
                      <div className="flex items-center mb-1.5">
                        <p className="text-xs text-gray-500">ヒット内訳</p>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { label: '1B', tooltipKey: '1B（シングル）', value: s.singles, color: 'bg-emerald-50 text-emerald-700' },
                          { label: '2B', tooltipKey: '2B（ダブル）', value: s.doubles, color: 'bg-blue-50 text-blue-700' },
                          { label: '3B', tooltipKey: '3B（トリプル）', value: s.triples, color: 'bg-purple-50 text-purple-700' },
                          { label: 'HR', tooltipKey: 'HR（ホームラン）', value: s.homeRuns, color: 'bg-red-50 text-red-700' },
                        ].map((h) => (
                          <div key={h.label} className={`rounded-lg p-2 text-center ${h.color} relative`}>
                            <div className="flex items-center justify-center gap-0.5">
                              <p className="text-[10px] font-bold">{h.label}</p>
                              <TooltipIcon title={h.tooltipKey} description={TOOLTIPS[h.tooltipKey] ?? ''} />
                            </div>
                            <p className="text-base font-black">{h.value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-right text-xs text-gray-400 mt-1">
                        総ヒット {s.totalHits}本 ({rankLabel(getRank(stats, s.userId, (x) => x.totalHits))})
                        ／HR {rankLabel(getRank(stats, s.userId, (x) => x.homeRuns))}
                      </p>
                    </div>

                    {/* 平均得票数 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="text-xs text-gray-500">平均得票数</span>
                        <TooltipIcon title="平均得票数" description={TOOLTIPS['平均得票数']} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-purple-600">{s.avgVotesPerGame.toFixed(2)}</span>
                        <span className="text-xs text-gray-400">({s.totalVotesReceived}票/{s.gamesParticipated}戦)</span>
                        <span className="text-xs text-gray-400">({rankLabel(getRank(stats, s.userId, (x) => x.avgVotesPerGame))})</span>
                      </div>
                    </div>

                    {/* 追加指標 */}
                    {s.gamesParticipated > 0 && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5 space-y-2">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">詳細成績</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">MVP勝率</span>
                            <TooltipIcon title="MVP勝率" description={TOOLTIPS['MVP勝率']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-yellow-600">{formatRate(s.mvpWinRate)}</span>
                            <span className="text-xs text-gray-400">({s.mvpCount}/{s.gamesParticipated}戦)</span>
                            <span className="text-xs text-gray-400">({rankLabel(getRank(stats.filter(x => x.gamesParticipated > 0), s.userId, (x) => x.mvpWinRate))})</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">ホームラン率</span>
                            <TooltipIcon title="ホームラン率" description={TOOLTIPS['ホームラン率']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-red-600">{formatRate(s.homeRunRate)}</span>
                            <span className="text-xs text-gray-400">({s.homeRuns}/{s.gamesParticipated}戦)</span>
                            <span className="text-xs text-gray-400">({rankLabel(getRank(stats.filter(x => x.gamesParticipated > 0), s.userId, (x) => x.homeRunRate))})</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">最高得票数</span>
                            <TooltipIcon title="最高得票数" description={TOOLTIPS['最高得票数']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-emerald-600">{s.maxVotesInGame}票</span>
                            <span className="text-xs text-gray-400">({rankLabel(getRank(stats, s.userId, (x) => x.maxVotesInGame))})</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">前口上使用率</span>
                            <TooltipIcon title="前口上使用率" description={TOOLTIPS['前口上使用率']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-teal-600">{formatRate(s.preambleUsageRate)}</span>
                            <span className="text-xs text-gray-400">({s.preambleCount}/{s.gamesParticipated}戦)</span>
                            <span className="text-xs text-gray-400">({rankLabel(getRank(stats.filter(x => x.gamesParticipated > 0), s.userId, (x) => x.preambleUsageRate))})</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">完封数</span>
                            <TooltipIcon title="完封数" description={TOOLTIPS['完封数']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-gray-500">{s.shutoutCount}回</span>
                            <span className="text-xs text-gray-400">({formatRate(s.shutoutRate)})</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">自作札使用率</span>
                            <TooltipIcon title="自作札使用率" description={TOOLTIPS['自作札使用率']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-violet-600">{formatRate(s.selfCardUsageRate)}</span>
                            <span className="text-xs text-gray-400">({s.selfCardUsedCount}/{s.gamesParticipated}戦)</span>
                            <span className="text-xs text-gray-400">({rankLabel(getRank(stats.filter(x => x.gamesParticipated > 0), s.userId, (x) => x.selfCardUsageRate))})</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* 個性指標 */}
                    {s.votesCastCount > 0 && (
                      <div className="bg-indigo-50 rounded-xl px-3 py-2.5 space-y-2">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide">個性指標</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">多数派投票率</span>
                            <TooltipIcon title="多数派投票率" description={TOOLTIPS['多数派投票率']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-indigo-600">{formatRate(s.majorityVoteRate)}</span>
                            <span className="text-xs text-gray-400">({s.votesCastCount}票投じた)</span>
                            <span className="text-xs text-gray-400">({rankLabel(getRank(stats.filter(x => x.votesCastCount > 0), s.userId, (x) => x.majorityVoteRate))})</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">孤独投票数</span>
                            <TooltipIcon title="孤独投票数" description={TOOLTIPS['孤独投票数']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-pink-600">{s.loneVoteCount}回</span>
                          </div>
                        </div>
                        {s.preambleCount > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="text-xs text-gray-500">前口上平均文字数</span>
                              <TooltipIcon title="前口上平均文字数" description={TOOLTIPS['前口上平均文字数']} />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-sm font-bold text-teal-600">{s.avgPreambleLength}文字</span>
                              <span className="text-xs text-gray-400">({s.preambleCount}回使用)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI総評 */}
                    {aiComment && (aiComment.overall_comment || aiComment.last_tournament_comment || aiComment.card_analysis_comment) && (
                      <div className="bg-linear-to-br from-purple-50 to-indigo-50 rounded-xl p-3 space-y-2">
                        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">🤖 AI総評</p>
                        {aiComment.overall_comment && (
                          <div>
                            <p className="text-[10px] text-purple-400 mb-0.5">通算</p>
                            <p className="text-xs text-gray-700 leading-relaxed">{aiComment.overall_comment}</p>
                          </div>
                        )}
                        {aiComment.last_tournament_comment && (
                          <div>
                            <p className="text-[10px] text-purple-400 mb-0.5">前回大会</p>
                            <p className="text-xs text-gray-700 leading-relaxed">{aiComment.last_tournament_comment}</p>
                          </div>
                        )}
                        {aiComment.card_analysis_comment && (
                          <div>
                            <p className="text-[10px] text-purple-400 mb-0.5">🃏 作成した札の傾向</p>
                            <p className="text-xs text-gray-700 leading-relaxed">{aiComment.card_analysis_comment}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 連打ゲーム */}
                    {hasMashData && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500">連打勝率</span>
                            <TooltipIcon title="連打ゲーム勝率" description={TOOLTIPS['連打ゲーム勝率']} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-orange-600">
                              {s.buttonMashGames > 0 ? formatRate(s.buttonMashWinRate) : '—'}
                            </span>
                            {s.buttonMashGames > 0 && (
                              <>
                                <span className="text-xs text-gray-400">({s.buttonMashWins}/{s.buttonMashGames}戦)</span>
                                <span className="text-xs text-gray-400">({rankLabel(getRank(stats.filter((x) => x.buttonMashGames > 0), s.userId, (x) => x.buttonMashWinRate))})</span>
                              </>
                            )}
                          </div>
                        </div>
                        {s.totalTapSessions > 0 && (
                          <div className="bg-orange-50 rounded-xl px-3 py-2 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                <span className="text-[11px] text-orange-700">最高連打数</span>
                                <TooltipIcon title="連打最高記録" description={TOOLTIPS['連打最高記録']} />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-bold text-orange-600">{s.bestTapCount}回</span>
                                <span className="text-xs text-orange-400">({rankLabel(getRank(stats.filter((x) => x.totalTapSessions > 0), s.userId, (x) => x.bestTapCount))})</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                <span className="text-[11px] text-orange-700">平均連打数</span>
                                <TooltipIcon title="連打平均" description={TOOLTIPS['連打平均']} />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-bold text-orange-500">{s.avgTapCount}回</span>
                                <span className="text-xs text-orange-400">({rankLabel(getRank(stats.filter((x) => x.totalTapSessions > 0), s.userId, (x) => x.avgTapCount))})</span>
                              </div>
                            </div>
                          </div>
                        )}
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
