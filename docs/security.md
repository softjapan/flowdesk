# セキュリティの方針と監査の記録

確認日：2026-11-25（第14章）。認可の判断は `docs/authz-matrix.md`、テストの分担は `docs/testing.md` を正とする。

## 1. AI によるレビュー（第14章）の結果

`.claude/agents/security-reviewer.md` の Subagent を観点ごとに 2 つ（①認可・テナント越境、②入力検証・秘密情報・XSS・オープンリダイレクト）に分け、`src/` 全体を読ませた。指摘はそのまま直さず、コードと依存ライブラリのソースを読んで確かめた。

| # | 指摘 | 判定 | 確かめたこと | 対応 |
|---|------|------|--------------|------|
| 1 | `BETTER_AUTH_URL` が未設定だと公開 URL が既定値・推定になる | **本物** | Better Auth は `baseURL` がないと `request.url`（Host ヘッダー）から作る（`better-auth/dist/auth/base.mjs`）。設定漏れの本番では、パスワード再設定メールのリンクを攻撃者のホストに向けられる。招待・CSV・Stripe の戻り先は `localhost` になる | `src/server/app-url.ts` に集約。本番で未設定・不正なら例外。`auth.ts` に必ず渡す。`app-url.test.ts` |
| 2 | 招待した人が削除・降格されても、その人の招待が使える | **本物** | Admin が出した Admin の招待は、その Admin を削除した後も 48 時間受諾できた（DB テストで再現） | 受諾時に招待者の今のロールで `canInvite` を確かめ直す（組織をロックした後）。画面には「無効」と出す。`members.db.test.ts` |
| 3 | 招待の受諾が、未確認のメールアドレスの一致だけで通る | 仕様の範囲（要判断） | 招待 ID は `randomUUID()` で、リンクを知らないと受諾できない。本人宛ての招待を一覧で返す `/organization/list-user-invitations` は、Better Auth がメール未確認なら 403 にする。Better Auth の既定も「推測できない ID なら確認を求めない」。残るのは、リンクの転送と、本人より先に同じアドレスで登録された場合 | 対応しない。メールアドレスの確認（F-01 の範囲の変更）を入れるときに `emailVerified` を条件に足す |
| 4 | 署名付き PUT の URL が完了の確認後も 5 分使え、先頭のバイトの確認を回避できる | 本物だが影響は小さい | Content-Type と長さは署名で固定され、S3 は別オリジン。同じ組織の利用者が、自分の添付を中身の違うファイルで上書きできるだけ。スクリプトはアプリのオリジンで動かない | 見送り。気になるなら完了時に別のキーへコピーする |
| 5 | `server-only` の import がない | 誤検知（改善提案） | クライアントのコンポーネントが `@/server` から import しているのは型と Zod だけ。Worker が使うモジュールに入れると tsx で例外になる | 見送り（依存の追加になる） |
| 6 | Worker が payload の `organizationId` を信用している | 誤検知 | SQS のメッセージは `jobId` だけで、payload はサーバーが DB に作ったもの。外から書き換える経路がない | 見送り |
| 7 | Worker・Webhook がエラーをそのままログに出す | 低 | ログは内部（CloudWatch）だけ。応答は固定の文言 | 見送り（第15章でログの方針を決めるときに扱う） |
| 8 | CSV の数式対策が電話番号の先頭の `+` にも `'` を付ける | 誤検知 | セキュリティ上は正しい挙動（データの品質の話） | 見送り |
| 9 | Webhook の本文の大きさに上限がない | 低 | 署名の検証の順序（生の本文で検証）は正しい | ALB の上限で扱う（第16〜17章） |

①は、Service 層の認可（表のすべての行）、`organizationId` での絞り込み、他の組織の ID の 404、`disabledPaths` について「問題なし」とした。②は、Zod による入力の検証、オープンリダイレクト（`safeCallbackUrl`）、Webhook の署名の検証について「問題なし」とした。

## 2. 依存関係（npm audit）

`npm run audit:check`（`scripts/audit-check.ts`）が `npm audit --json` を `audit-allowlist.json` と比べる。一覧にない moderate 以上の advisory が出たとき、または一覧の `reviewBy` を過ぎたときに失敗する。レジストリに問い合わせるので `npm run check` には入れず、CI の定期実行（週 1 回）と依存を更新する PR で実行する。

2026-11-25 の結果：7 件（high 3・moderate 4）。元の advisory は 2 つだけ。

| advisory | パッケージ | 経路 | 判断 |
|----------|-----------|------|------|
| GHSA-7589-6fvf-x4pw（high、ReDoS） | effect ≤3.22.0 | prisma（dev）→ @prisma/config → effect | CLI だけが使う。`@prisma/client` の peer 依存なので `--omit=dev` でも出るが、ビルドの成果物（`.next/`）には入らない。修正版の Prisma 7 が出たら更新する |
| GHSA-g3hv-75wg-m249（moderate、DoS） | minimatch 7〜11.0.0 | shadcn → ts-morph → @ts-morph/common → minimatch | shadcn の CLI だけが使う。アプリが読むのは `shadcn/tailwind.css` だけ |

- `npm audit fix --force` は使わない。prisma@6・shadcn@1 に下げる破壊的な変更になる
- 実行時（`next start`・Worker）に入る依存に high 以上が出たら、その週のうちに更新する。更新できなければ、届く経路を書いて一覧に入れ、期限を短くする
- 依存は `package.json` で完全一致に固定し、`package-lock.json` をコミットする。CI は `npm ci` を使う（`docs/tech-stack.md`）

## 3. 秘密情報

- 鍵は `.env.local`（開発）と本番の環境変数（第16〜17章で Secrets Manager）に置く。`.env.example` には変数名とローカル用の値だけを書く
- `npm run secrets:scan`（`scripts/scan-secrets.ts`、ルールは `scripts/secret-rules.ts`）がリポジトリの中身を調べる。依存は足していない
  - 既定：追跡中のファイルと、無視していない未追跡のファイル。`npm run check` に含むので、CI の check ジョブとコミット前の両方で動く
  - `--staged`：ステージした差分の追加行（`.githooks/pre-commit`）
  - `--history`：すべてのコミットの追加行（CI で週 1 回）。2026-11-25 は 0 件
- 本物の鍵の形（接頭辞＋十分な長さ）だけを止める。「`sk_live_` は使わない」のような言及は止めない（第12章）。テストで鍵の形が要るときは、実行時に組み立てるか、行に `secret-scan:allow` を書く
- 見つかった値は先頭 6 文字と長さだけを出す（CI のログに鍵を残さない）
- 履歴に入ってしまった鍵は、履歴を書き換える前に**まず無効化（ローテーション）する**。push 済みなら漏れたものとして扱う

## 4. セキュリティヘッダー

| ヘッダー | 値 | 付ける場所 |
|----------|-----|-----------|
| Content-Security-Policy | 下記 | `src/proxy.ts`（S3 のオリジンを実行時の環境変数から決める） |
| X-Content-Type-Options | `nosniff` | `next.config.ts`（静的ファイルを含むすべて） |
| Referrer-Policy | `strict-origin-when-cross-origin` | 同上。招待の ID などのパスを他のサイトに送らない |
| X-Frame-Options | `DENY` | 同上（古いブラウザ向け。CSP の `frame-ancestors` と同じ） |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=()` | 同上 |
| Cross-Origin-Opener-Policy | `same-origin` | 同上 |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains` | 同上。本番のビルドだけ |
| X-Powered-By | 出さない | `poweredByHeader: false` |

CSP（`src/lib/security-headers.ts`）：

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' blob: data: <S3>; font-src 'self'; connect-src 'self' <S3>;
object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com;
frame-ancestors 'none'; upgrade-insecure-requests（公開 URL が https のとき）
```

- `script-src` に `'unsafe-inline'` を残す。Cache Components（PPR）では、事前に描画したシェルにリクエストごとの nonce を入れられない（`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`）。nonce にするには全ページを動的な描画にする必要があり、第5章からの設計と合わない
- そのため XSS は主に React のエスケープで防ぐ。`dangerouslySetInnerHTML` は shadcn/ui のグラフ（開発者が書いた色の設定だけ）の 1 か所。新しく使うときはレビューで止める
- CSP は、注入されたスクリプトが**外部のスクリプトを読む・外部へ送る**ことと、埋め込み・`<base>` の書き換え・プラグインを止める
- `'unsafe-eval'` は `next dev` だけ（React のデバッグ情報）

## 5. CSRF と XSS の確認（E2E、`e2e/security.spec.ts`）

- Server Actions：Next.js が `Origin` とホストを比べ、違えば実行しない（`Invalid Server Actions request`）。`serverActions.allowedOrigins` は設定しない。ログイン済みの Cookie を持ったまま `Origin` だけを他のサイトにして削除を呼び、顧客が残ることを確かめた
- セッションの Cookie は `HttpOnly`・`SameSite=Lax`。他のサイトからの POST には付かない
- Route Handler（`/api/uploads/presign`）は `application/json` 以外を 415 にする（CORS のプリフライトを経ない送信を受け付けない）。Better Auth は `trustedOrigins`（公開 URL）で `Origin` を確かめる
- XSS：氏名・メモに `<img onerror>`・`<script>`・`<svg onload>` を入れても文字として表示され、実行されない（詳細・一覧）
- CSP：ページの中で外部のスクリプトの読み込みと外部への `fetch` を試し、`securitypolicyviolation` が出て止まることを確かめた。他のオリジンの iframe には表示されない（ヘッダーを外した対照では表示される）

## 6. Claude Code の安全装置（第2・14章）

`.claude/settings.json` の PreToolUse フック（`.claude/hooks/guard-bash.sh`）は、**Subagent の Bash の呼び出しにも効く**。2026-11-25 に、general-purpose の Subagent に `git push --force --dry-run origin HEAD` を一度だけ実行させ、`Blocked: force push は禁止。必要なら人間が実行する` で止まることを確かめた（コマンドは実行されていない）。
