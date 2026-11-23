#!/bin/bash
# Bash ツールの実行前に呼ばれる。終了コード 2 で実行を止め、
# 標準エラーの内容が Claude に理由として渡る。
command=$(jq -r '.tool_input.command')

block() {
  echo "Blocked: $1" >&2
  exit 2
}

case "$command" in
  *"git push --force"* | *"git push -f"*)
    block "force push は禁止。必要なら人間が実行する" ;;
  *"--no-verify"*)
    block "コミット前の品質ゲートを飛ばさない" ;;
  *"prisma migrate reset"*)
    block "DB をリセットするコマンドは人間が実行する" ;;
esac

# 「rm -rf .」は止めるが「rm -rf ./node_modules」は通す。
# case の * は前方一致になるので、末尾を正規表現で判定する
if grep -Eq 'rm -rf (/|~|\.|\*)/?( |;|&|$)' <<<"$command"; then
  block "広い範囲の削除は禁止"
fi

# .env をシェル経由で読む抜け道をふさぐ（.env.example は許可）
if grep -Eq '\.env(\.local|\.production|\.[a-z]+\.local)?([^.a-zA-Z]|$)' \
  <<<"$command"; then
  block ".env は読まない。変数名は .env.example を見る"
fi

exit 0
