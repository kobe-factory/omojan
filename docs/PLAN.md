# おもじゃん 実装プラン

> **最終更新**: 2026-04-24（ゲーム設定config化対応）

## コンテキスト

「おもじゃん for 男根祭 〜ご神体ワードバトル〜」は、5名の友人がLINEで共有したURLからブラウザを開き、カードゲームを楽しむWebアプリケーション。ログイン機能は不要で、ユーザーは名前リストから自分を選択して参加。Next.js + TailwindCSS + Supabase + Vercelで構築するPOC。

## 確定済み要件

| 項目 | 仕様 |
|------|------|
| URL発行 | 管理者画面（/admin）から発行 |
| 手札ルール | 使った手札は消える（5ゲームで最大5枚消費） |
| セッション管理 | localStorageに保存、再度URLを開いた際は自動で前回ユーザーで再開 |
| 自己投票 | 自分の作品にも投票可能 |
| 管理者画面制限 | なし（URLを知っている人のみアクセス） |

## ゲームの基本ルール

- **ユーザー**: はじむ、スラパン、こんべ、かねおか、カズさん（5名）
- **テスト**: こんべ・カズさんの2名で実施
- **手札配布**: 全カードをシャッフルしランダムで配布（作成者に関係なし）
- **1大会**: 5ゲーム（テスト時は3ゲーム）

### 枚数ルール

| モード | 札作成枚数/人 | 手札枚数/人 | お題用 | ゲーム数 |
|--------|-------------|------------|--------|---------|
| 本番（5名） | 20枚 | 10枚 | 50枚 | 5回戦 |
| テスト（2名） | 10枚 | 5枚 | 10枚 | 3回戦 |

## システム構成

```
Next.js (App Router) + TailwindCSS + Supabase + Vercel
```

## DBスキーマ

```sql
-- 大会
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,            -- URLパラメータ（乱数）
  game_count INT DEFAULT 5,              -- 回戦数（テスト時は3）
  cards_per_user INT DEFAULT 20,         -- 1人あたりの札作成枚数（テスト時は10）
  status TEXT DEFAULT 'waiting_users',   -- waiting_users | creating_cards | playing | finished
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ユーザーマスタ（固定5名）
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);
-- 初期データ: はじむ, スラパン, こんべ, かねおか, カズさん

-- 大会参加者
CREATE TABLE tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, user_id)
);

-- 札（全ユーザーが作成したカード）
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  creator_user_id UUID REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 手札配布（全カードをシャッフルして割り当て）
CREATE TABLE player_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  user_id UUID REFERENCES users(id),
  card_id UUID REFERENCES cards(id),
  is_used BOOLEAN DEFAULT false,
  UNIQUE(tournament_id, user_id, card_id)
);

-- ゲーム（各ラウンド）
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  round_number INT NOT NULL,
  status TEXT DEFAULT 'waiting_submission', -- waiting_submission | waiting_vote | showing_result | finished
  topic_card_id UUID REFERENCES cards(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 作品投稿
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  user_id UUID REFERENCES users(id),
  hand_card_id UUID REFERENCES cards(id),
  position TEXT NOT NULL,   -- 'before'（手札＋お題）or 'after'（お題＋手札）
  preamble TEXT,            -- 前口上（任意）
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id)
);

-- 投票
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  voter_user_id UUID REFERENCES users(id),
  submission_id UUID REFERENCES submissions(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, voter_user_id)
);
```

## 状態遷移

```
tournaments.status
  waiting_users     → 全員参加完了したら creating_cards へ
  creating_cards    → 全員が規定枚数作成したら playing へ（手札・お題割り当て）
  playing           → 全ゲーム終了したら finished へ

games.status
  waiting_submission → 全員投稿したら waiting_vote へ
  waiting_vote       → 全員投票したら showing_result へ
  showing_result     → （cookie制御）リロード後 finished へ
  finished           → 次ラウンド開始（次のgameレコード作成）
```

## ローカル開発

| 項目 | 値 |
|------|-----|
| 起動コマンド | `npm run dev` |
| ポート | 3001（固定） |
| ローカルURL | http://localhost:3001 |
| 管理者画面 | http://localhost:3001/admin |

## ディレクトリ構成

```
src/
  app/
    admin/page.tsx            - 管理者画面（大会URL発行）
    [token]/page.tsx          - 大会メインページ
    api/
      tournaments/route.ts    - 大会作成API
      tournaments/[token]/
        join/route.ts         - ユーザー参加
        cards/route.ts        - 札作成
        submit/route.ts       - 作品投稿
        vote/route.ts         - 投票
        advance/route.ts      - ステータス進行（サーバー側チェック）
  components/
    UserSelection.tsx
    CardCreation.tsx
    GamePlay.tsx
    Voting.tsx
    Results.tsx
    Archive.tsx
    WaitingStatus.tsx
  lib/
    supabase.ts
    gameLogic.ts
  hooks/
    useCurrentUser.ts
    useTournament.ts
```

## 実装フェーズ

### Phase 1: 環境構築 ✅（進行中）
- [x] CLAUDE.md更新
- [ ] Next.jsプロジェクト作成
- [ ] Supabase接続設定
- [ ] DBスキーマ適用・初期データ投入
- [ ] Vercel + GitHub連携ドキュメント作成

### Phase 2: 管理者画面・ユーザー選択
- [ ] /admin ページ（大会URL発行・ゲーム数/枚数設定）
- [ ] useCurrentUser フック
- [ ] ユーザー選択画面（排他制御・修正機能付き）

### Phase 3: 札作成画面
- [ ] カード入力UI（規定枚数のテキスト入力）
- [ ] 全員完了チェック → ゲーム開始処理（手札・お題振り分け）

### Phase 4: ゲームプレイ
- [ ] 作品作成画面（お題＋手札選択＋前後配置＋前口上）
- [ ] 投票画面
- [ ] 結果発表画面（cookie制御）

### Phase 5: アーカイブ
- [ ] 次ラウンド遷移
- [ ] アーカイブタブ（過去ラウンドの作品・結果一覧）

### Phase 6: テスト・デプロイ
- [ ] 2名でのE2Eテスト
- [ ] モバイル表示確認
- [ ] 5名対応に変更してリリース

## デザイン方針

- モバイルアプリ風（最大幅480px中央寄せ）
- 白ベース、ポップなアクセントカラー
- タイトル：「おもじゃん for 男根祭 〜ご神体ワードバトル〜」
- バージョン：v1.0

## Supabase / Vercel 無料枠

| サービス | 無料枠 | 5名利用での問題 |
|---------|--------|--------------|
| Supabase Free | 500MB DB, 50,000 MAU, 2GB帯域 | 問題なし |
| Vercel Hobby | 100GB帯域/月, 100GB-Hrs | 問題なし |
