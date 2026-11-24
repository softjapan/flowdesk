# 認可マトリクス

Better Auth の organization プラグインの既定ロールは `owner` / `admin` / `member`。FlowDesk では `member` の代わりに `staff` を定義する（`createAccessControl` でロールと権限を宣言する。第10章）。

ロールと権限の宣言は `src/server/access-control.ts`（`createAccessControl`）、判定は `src/server/services/authz.ts`。表の「△」のうち、担当や相手のロールで決まる条件（Staff は自分の担当のみ、Admin は Staff⇔Admin のみ）は宣言では表せないので `authz.ts` で足し、DB の状態で決まる条件（最後の Owner）は Service がトランザクションの中で確かめる。organization プラグインの組織・メンバーを変更する HTTP の入口（`/api/auth/organization/update-member-role` など）は `disabledPaths` で閉じ、変更はすべて Service を通す（監査ログを同じトランザクションで残すため）。

○＝可、△＝条件付き、－＝不可。
すべての操作は、まず「ログイン済み」かつ「対象の組織のメンバー」であることを確認し、そのうえでこの表を適用する。

| リソース | 操作 | Owner | Admin | Staff | 備考 |
|----------|------|:-----:|:-----:|:-----:|------|
| 組織 | 名前の変更 | ○ | ○ | － | |
| 組織 | 削除 | ○ | － | － | |
| メンバー | 一覧 | ○ | ○ | ○ | |
| メンバー | 招待 | ○ | ○ | － | Admin は Owner を招待できない |
| メンバー | ロール変更 | ○ | △ | － | Admin は Staff⇔Admin のみ。最後の Owner は降格できない |
| メンバー | 削除 | ○ | △ | － | Admin は Staff のみ削除できる |
| 店舗・メニュー | 閲覧 | ○ | ○ | ○ | |
| 店舗・メニュー | 作成・編集・削除 | ○ | ○ | － | |
| 顧客 | 閲覧・検索 | ○ | ○ | ○ | |
| 顧客 | 作成・編集 | ○ | ○ | ○ | |
| 顧客 | 削除（論理削除） | ○ | ○ | － | |
| 顧客 | CSV エクスポート | ○ | ○ | － | 個人情報の一括持ち出しになるため |
| 添付ファイル | アップロード・閲覧 | ○ | ○ | ○ | 署名付き URL の有効期限は 5 分 |
| 予約 | 閲覧 | ○ | ○ | ○ | |
| 予約 | 作成・変更・キャンセル | ○ | ○ | △ | Staff は自分が担当の予約のみ |
| 料金プラン | 閲覧 | ○ | ○ | － | Admin はメンバー管理（S-13）で上限の使用状況を見る。S-14 の画面は Owner のみ |
| 料金プラン | 変更・解約 | ○ | － | － | Checkout・カスタマーポータル（`docs/billing.md`） |
| 監査ログ | 閲覧 | ○ | ○ | － | |
| ダッシュボード | 売上の表示 | ○ | ○ | － | Staff には予約数のみ表示 |

## テストで必ず確認するケース（第13・14章）

1. 組織 A のメンバーが、組織 B の顧客 ID を URL・Server Action の引数・Route Handler のパスに入れても 404 になる（存在を漏らさないため 403 ではなく 404）
   - 画面（ページ）は Cache Components によりシェルの送信後に判定するため、HTTP ステータスは 200 のまま「見つかりません」を表示し、`noindex` が付く（第5章で確認）。確認するのは、ステータスではなく「データが含まれないこと」
   - Server Action と Route Handler は 404 を返す
2. Staff が他のスタッフ担当の予約を変更しようとすると拒否される
3. Admin が自分を Owner に昇格できない
4. 最後の Owner を削除・降格できない
5. Free プランで 3 人目のスタッフを追加できない
   - 「スタッフ」は有効な `staffProfile` の数（Staff ロールに限らない）。招待（`inviteMember`）と招待の受諾（`acceptInvitation`）の両方で拒否する（`plan_limit`）。受諾は組織をロックしてから数えるので、同時に受諾しても上限を超えない
   - 店舗（Free は 1 つまで）も `createLocation` で同じく拒否する
   - `src/server/services/billing.db.test.ts`（第12章）
6. 権限変更が監査ログに記録される
