#!/bin/bash
# Edit / Write の実行後に呼ばれる。編集したファイルだけを Prettier で整形する。
file=$(jq -r '.tool_input.file_path')

case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.json | *.css) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0
# 整形に失敗しても編集自体は止めない（終了コード 0）。構文エラーは typecheck で拾う
npx --no-install prettier --write --ignore-unknown "$file" >/dev/null 2>&1
exit 0
