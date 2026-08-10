# おもじゃん 実装プラン

> **最終更新**: 2026-05-12（順位決め変更・絵文字対応 v1.26.0）

## コンテキスト

「おもじゃん for 男根祭 〜ご神体ワードバトル〜」は、5名の友人がLINEで共有したURLからブラウザを開き、カードゲームを楽しむWebアプリケーション。ログイン機能は不要で、ユーザーは名前リストから自分を選択して参加。Next.js + TailwindCSS + Supabase + Vercelで構築。

## 確定済み要件

| 項目 | 仕様 |
|------|------|
| URL発行 | 管理者画面（/admin）から発行 |
| 手札ルール | 使った手札は消える |
| セッション管理 | localStorageに保存、再度URLを開いた際は自動で前回ユーザーで再開 |
| 自己投票 | 自分の作品にも投票可能 |
| 管理者画面制限 | なし（URLを知っている人のみアクセス） |

## ユーザー

5名固定（DBの `users` テーブルに初期データとして登録済み）：
- はじむ、スラパン、こんべ、かねおか、カズさん

## ゲームの基本ルール

| モード | 人数 | 札作成枚数/人 | 手札枚数/人 | ゲーム数 |
|--------|------|-------------|------------|---------|
| 本番（production） | 5名 | 20枚 | 15枚 | 10回戦 |
| テスト（test） | 2名 | 10枚 | 5枚 | 3回戦 |
| ソロ（solo） | 1名 | 任意 | 任意 | 任意 |

※ 本番設定は `src/config/game.ts` で管理

## システム構成

```
Next.js (App Router) + TypeScript + TailwindCSS + Supabase + Vercel
```

## DBスキーマ（現在適用済み）

```sql
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  mode TEXT DEFAULT 'solo',              -- solo | test | production
  required_players INT DEFAULT 1,
  game_count INT DEFAULT 5,
  cards_per_user INT DEFAULT 20,
  hand_cards_per_player INT DEFAULT 10,
  status TEXT DEFAULT 'waiting_users',   -- waiting_users | creating_cards | playing | finished
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  line_user_id TEXT UNIQUE              -- LIFF連携で保存（migration 002で追加）
);

CREATE TABLE tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, user_id)
);

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  creator_user_id UUID REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE player_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  user_id UUID REFERENCES users(id),
  card_id UUID REFERENCES cards(id),
  is_used BOOLEAN DEFAULT false,
  UNIQUE(tournament_id, user_id, card_id)
);

CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  round_number INT NOT NULL,
  status TEXT DEFAULT 'waiting_submission', -- waiting_submission | waiting_vote | showing_result | finished
  topic_card_id UUID REFERENCES cards(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  user_id UUID REFERENCES users(id),
  hand_card_id UUID REFERENCES cards(id),
  position TEXT NOT NULL,                  -- 'before' | 'after'
  preamble TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id)
);

CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  voter_user_id UUID REFERENCES users(id),
  submission_id UUID REFERENCES submissions(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, voter_user_id)
);
```

### マイグレーション

| ファイル | 内容 | 適用状況 |
|---------|------|---------|
| `supabase/migrations/001_initial.sql` | 初期スキーマ | ✅ 適用済み |
| `supabase/migrations/002_add_line_user_id.sql` | usersにline_user_idカラム追加 | ✅ 適用済み（2026-04-28） |

## ページ構成

| パス | 内容 |
|------|------|
| `/admin` | 管理者画面（大会URL発行・本番大会二重発行防止） |
| `/[token]` | 大会メインページ（状態に応じてコンポーネント切替） |
| `/current` | 進行中の本番大会 → 最新大会の順にリダイレクト |
| `/summary` | 全大会サマリページ（総合MVP・結果一覧） |

## 画面の状態遷移

```
tournaments.status
  waiting_users   → 全員参加完了したら creating_cards へ
  creating_cards  → 全員が規定枚数作成したら playing へ（手札・お題割り当て）
  playing         → 全ゲーム終了したら finished へ

games.status
  waiting_submission → 全員投稿したら waiting_vote へ
  waiting_vote       → 全員投票したら showing_result へ
  showing_result     → 結果確認ボタン押下で finished へ（自動advanceの対象外）
  finished           → 次ラウンド開始（次のgameレコード作成）
```

## LINE LIFF連携

### 概要

LINEアプリ内でURLを開いた際にLINE User IDを取得し、DBの `users.line_user_id` に保存。
フェーズ進行時（本番大会のみ）に、トリガーユーザー以外の参加者へプッシュ通知を送信。

### 通知タイミング

| フェーズ遷移 | メッセージ |
|---|---|
| 全員の札作成完了 → ゲーム開始 | 全員の札作成が完了しました！おもじゃんを開いて作品を投稿しましょう 🎴 |
| 全員の作品投稿完了 → 投票フェーズ | 全員の作品投稿が完了しました！おもじゃんを開いて投票しましょう 🗳️ |
| 全員の投票完了 → 結果発表 | 全員の投票が完了しました！おもじゃんを開いて結果を確認しましょう 🏆 |

- 通知形式：Flex Message（「おもじゃんを開く」ボタン付き）
- ボタンリンク：`https://liff.line.me/2009919064-RhkS05i8`（LIFF URL経由）
- 本番モード（`mode = production`）のみ送信
- トリガーユーザー本人には送らない
- `line_user_id` が未登録のユーザーはスキップ

### 通知数の試算（5名・10回戦）

1回の送信 = 最大4通（5名 − トリガー1名）

| タイミング | 回数 | 通知数 |
|---|---|---|
| 札作成完了（大会1回） | 1回 | 4通 |
| 作品投稿完了（回戦ごと） | 10回 | 40通 |
| 投票完了（回戦ごと） | 10回 | 40通 |
| **合計** | | **84通/大会** |

- LINE Messaging API 無料枠：200通/月 → **月2大会**が目安
- ライトプラン（約500円/月）：5,000通/月 → **月59大会**まで対応
- 投票完了通知は「結果確認ボタンを押さないと次回戦に進めない」ため削除不可

### ID連携の仕組み

- LIFFアプリURL（`https://liff.line.me/{liffId}`）経由でアクセスした場合のみ動作
- `liff.isInClient()` が true の場合のみ `liff.getProfile()` を呼び出す
- `userId`（ゲームユーザー）と `lineUserId` が揃ったタイミングでDBに保存
- 既にDBに保存済みの場合はスキップ（上書きなし）
- 1ユーザー1回限り、大会をまたいで有効

### LINE Developer Console設定

| 項目 | 値 |
|------|-----|
| LIFFアプリID | `2009919064-RhkS05i8` |
| LIFFエンドポイントURL | `https://omojan.vercel.app/current` |
| LIFFアプリURL | `https://liff.line.me/2009919064-RhkS05i8` |
| スコープ | `profile` |

### リッチメニュー設定

| ボタン | リンク |
|-------|--------|
| おもじゃん（現在の大会） | `https://liff.line.me/2009919064-RhkS05i8` |
| 総合結果 | `https://omojan.vercel.app/summary` |

### 環境変数

| 変数名 | 設定場所 | 値 |
|--------|---------|-----|
| `NEXT_PUBLIC_LIFF_ID` | Vercel (Production) | `2009919064-RhkS05i8` |
| `LINE_CHANNEL_ACCESS_TOKEN` | Vercel (Production, Sensitive) | （非公開） |
| `NEXT_PUBLIC_APP_URL` | Vercel (Production) | `https://omojan.vercel.app` |

## ディレクトリ構成

```
src/
  app/
    admin/page.tsx                        - 管理者画面
    [token]/page.tsx                      - 大会メインページ
    current/page.tsx                      - 進行中大会へのリダイレクト
    summary/page.tsx                      - 全大会サマリ
    api/
      tournaments/route.ts               - 大会作成API（本番二重発行防止）
      tournaments/[token]/
        join/route.ts                    - ユーザー参加
        cards/route.ts                   - 札作成
        submit/route.ts                  - 作品投稿
        vote/route.ts                    - 投票
        advance/route.ts                 - ステータス進行 + LINE通知
      users/[userId]/
        line-id/route.ts                 - LINE User ID保存（PATCH）
  components/
    UserSelection.tsx
    CardCreation.tsx
    GamePlay.tsx
    Voting.tsx
    Results.tsx
    Archive.tsx
    TournamentFinished.tsx
    WaitingStatus.tsx
  lib/
    supabase.ts
    line-push.ts                         - LINE Messaging API push通知
  hooks/
    useCurrentUser.ts
  config/
    game.ts                              - ゲーム設定（本番プリセット等）
  types/
    database.ts
```

## ローカル開発

| 項目 | 値 |
|------|-----|
| 起動コマンド | `npm run dev` |
| ポート | 3001（固定） |
| ローカルURL | http://localhost:3001 |
| 管理者画面 | http://localhost:3001/admin |

## バージョン履歴

| バージョン | 内容 |
|-----------|------|
| v1.47.0 | シークレットモードの投票完了ステータス匿名化を決選投票のみに限定（通常投票は名前表示に変更） |
| v1.46.0〜v1.46.1 | エキシビション・AIプレイヤー参加モードでAI行動生成が失敗した際の自動リトライ＋管理画面手動リトライを追加 |
| v1.26.0 | 順位決めを勝数優先に変更（勝数→得票数→大勝数）・絵文字表示対応（フォントスタック改善） |
| v1.25.x | なりすまし・シークレットモード改善・管理画面強化・localStorage整理 |
| v1.12.0 | LIFF連携・LINE通知・/currentページ・本番大会二重発行防止 |
| v1.11.0 | 本番設定を手札15枚・10回戦に変更（config/hand15-round10） |
| v1.10.1 | サマリ画面URLコピー削除・「総合MVP」テキスト修正・大会結果詳細リンク追加 |
| v1.9.0 | 全大会サマリページ（/summary）追加 |
| v1.8.0 | バージョン管理ルール強化 |
| v1.0〜v1.7 | ゲーム基本機能実装（ユーザー選択・札作成・投稿・投票・結果・アーカイブ） |

## 今後の対応

- [ ] `feat/liff-integration` を `main` にマージ・デプロイ（v1.12.0）
- [ ] LINE DeveloperコンソールでLIFFエンドポイントURLを `https://omojan.vercel.app/current` に変更
- [ ] リッチメニューのリンクを `https://liff.line.me/2009919064-RhkS05i8` に設定
- [ ] 全参加者がリッチメニューから `/current` を開いてLINE ID連携を完了
- [ ] 次大会でLINE通知が届くことを確認
