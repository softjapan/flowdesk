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
    # コミット済みのマイグレーションだけを守る。他の人や本番の DB にも
    # 適用されうるため。--create-only で作った直後の未コミットのファイルは、
    # 読んで SQL を書き足せるよう編集を許す
    if git -C "$CLAUDE_PROJECT_DIR" ls-files --error-unmatch "$rel" \
      >/dev/null 2>&1; then
      block "コミット済みのマイグレーションは書き換えない。新しいマイグレーションを作る"
    fi ;;
esac

exit 0
