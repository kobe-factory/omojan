# セットアップガイド

## 1. Supabase のセットアップ

### 1-1. プロジェクト作成
1. [Supabase](https://supabase.com) にログイン
2. 「New project」をクリック
3. プロジェクト名: `omojan`（任意）、リージョン: `Northeast Asia (Tokyo)` を選択
4. データベースパスワードを設定してプロジェクトを作成

### 1-2. DBスキーマの適用
1. Supabaseダッシュボード → 左メニュー「SQL Editor」
2. 「New query」をクリック
3. `supabase/migrations/001_initial_schema.sql` の内容を貼り付けて「RUN」を実行
4. テーブルとユーザー初期データが作成される

### 1-3. 接続情報の取得
1. Supabaseダッシュボード → 左メニュー「Settings」→「API」
2. 以下をコピー:
   - **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`)
   - **anon public key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)

### 1-4. 環境変数ファイルの作成
プロジェクトルートに `.env.local` を作成:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxxxxxxxxxxxxx
```

---

## 2. GitHub のセットアップ

### 2-1. リモートリポジトリの作成
1. [GitHub](https://github.com) にログイン
2. 「New repository」→ リポジトリ名: `omojan`
3. Privateに設定して作成

### 2-2. ローカルリポジトリとの連携
```bash
git remote add origin https://github.com/<your-username>/omojan.git
git branch -M main
git push -u origin main
```

---

## 3. Vercel のセットアップ

### 3-1. プロジェクトのインポート
1. [Vercel](https://vercel.com) にログイン
2. 「Add New Project」→「Import Git Repository」
3. GitHubアカウントを連携し、`omojan` リポジトリを選択
4. 「Import」をクリック

### 3-2. 環境変数の設定
「Configure Project」画面 → 「Environment Variables」で以下を追加:

| 変数名 | 値 |
|--------|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseのProject URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseのanon public key |

### 3-3. デプロイ
「Deploy」をクリックするとビルド＆デプロイが開始される。

以降は `main` ブランチへのpushで自動デプロイされる。

---

## 4. ローカル開発環境の起動

```bash
# 依存関係のインストール（初回のみ）
npm install

# 開発サーバー起動
npm run dev
```

ブラウザで `http://localhost:3000` を開く。

---

## 5. 大会URLの発行方法

1. `/admin` ページにアクセス
2. ゲーム数（デフォルト5、テスト時は3）と札作成枚数（デフォルト20、テスト時は10）を設定
3. 「大会URLを発行する」ボタンをクリック
4. 表示されたURLをLINEグループに貼り付ける
