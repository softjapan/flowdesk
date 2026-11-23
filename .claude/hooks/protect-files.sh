#!/bin/bash
# Edit / Write の実行前に呼ばれる。書き換えてはいけないファイルを守る。
file=$(jq -r '.tool_input.file_path')
rel=${file#"$CLAUDE_PROJECT_DIR"/}

block() {
  echo "Blocked: $1" >&2
  exit 2
}

case "$rel" in
  .env | .env.local | .env.*.local | .env.production)
    block "$rel は編集しない。必要な変数は .env.example に追記する" ;;
  package-lock.json)
    block "package-lock.json は npm に更新させる" ;;
  prisma/migrations/*/migration.sql)
    # 新規作成は許可し、既存ファイルの書き換えだけを止める
    if [ -e "$file" ]; then
      block "適用済みのマイグレーションは書き換えない。新しいマイグレーションを作る"
    fi ;;
esac

exit 0
