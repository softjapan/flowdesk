---
description: 要件定義書の機能 ID（F-01 など）を指定して、FlowDesk の機能を設計・テスト・実装の順で追加する
argument-hint: "[機能ID]"
disable-model-invocation: true
---

# 機能の追加：$ARGUMENTS

次の順で進める。各ステップの結果を短く報告してから次へ進む。

1. `docs/requirements.md` から $ARGUMENTS の記述を引用し、受け入れ条件を箇条書きにする
2. `docs/authz-matrix.md` から、この機能に関係する行を引用する
3. 変更するファイルと、追加するテストの一覧を示し、確認を待つ
4. テストを先に書き、失敗することを確認する
5. Service 層（`src/server/services/`）から実装し、Server Action・画面の順に進める
6. `npm run check` を実行し、結果をそのまま報告する

守ること：

- クエリは必ず `organizationId` で絞り込む
- 他の組織のデータを指定されたときは 404 にする
- `docs/tech-stack.md` にない依存は追加しない
