# おもじゃん for 男根祭 〜ご神体ワードバトル〜

v1.0

## 概要

5名の友人がLINEで共有したURLからブラウザを開き、カードゲームを楽しむWebアプリケーション。

## ゲームルール

1. **ユーザー選択** — 5名の中から自分の名前を選択
2. **札作成** — 各自が規定枚数の札（単語・フレーズ）を作成
3. **作品作成** — お題札と手札を組み合わせて面白い文章を作る
4. **投票** — 全員の作品から一番面白いものに1票
5. **結果発表** — 最多得票作品が勝者

## 開発環境のセットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local にSupabaseの接続情報を記入
npm run dev
```

詳細は [docs/SETUP.md](docs/SETUP.md) を参照。

## 技術スタック

- **Frontend**: Next.js (App Router) + TailwindCSS
- **DB**: Supabase (PostgreSQL)
- **Deploy**: Vercel

## ドキュメント

- [実装プラン](docs/PLAN.md)
- [セットアップガイド](docs/SETUP.md)
