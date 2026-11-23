# FlowDesk

@AGENTS.md

予約・顧客管理 SaaS。Next.js（App Router）でフロントとバックエンドを一つのリポジトリにまとめる。

## 最初に読むもの

- 要件と用語：`docs/requirements.md`
- 権限：`docs/authz-matrix.md`（認可の判断はこの表を正とする）
- データ構造：`docs/er.md`
- 使ってよいライブラリと版：`docs/tech-stack.md`（表にない依存を追加するときは、先に提案して確認を取る）

## コマンド

- 開発サーバー：`npm run dev`
- 型チェック：`npm run typecheck`
- Lint：`npm run lint`
- 単体テスト：`npm test`
- 完了前に必ず実行する：`npm run check`（型チェック・Lint・テストをまとめて実行）

## 設計のルール

- 業務ロジックは `src/server/services/` に置く。Server Action と Route Handler は、入力の検証・認証・Service の呼び出しだけを行う
- DB アクセスはすべて `organizationId` で絞り込む。ID だけで取得するクエリを書かない
- 認可は Service 層で `docs/authz-matrix.md` に従って判定する。画面でボタンを隠すだけにしない
- 他の組織のデータを指定された場合は 403 ではなく 404 を返す（存在を漏らさない）
- 外部からの入力は Zod で検証する
- 金額は円の整数（`priceYen`）で扱う。浮動小数点を使わない
- 日時は DB に UTC で保存し、表示時に店舗のタイムゾーンへ変換する

## 禁止事項

- `.env` や `.env.local` を読んだり、内容を出力したりしない。必要な変数名は `.env.example` を見る
- 適用済みのマイグレーション（`prisma/migrations/` の既存ファイル）を書き換えない。変更は新しいマイグレーションで行う
- `git push --force`、`git commit --no-verify` を使わない
- テストを通すためにテストを削除・スキップしない。失敗の原因を報告する

## 作業の進め方

- 3 ファイル以上にまたがる変更は、Plan Mode で計画を示してから実装する
- 実装が終わったら、変更したファイルと `npm run check` の結果を報告する
