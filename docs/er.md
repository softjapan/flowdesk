# ER 図

認証・組織まわり（`user`〜`invitation`）は Better Auth と organization プラグインが定義するテーブルで、`npx auth@1.7.27 generate --config src/server/auth.ts` で Prisma スキーマに出力する（旧 `@better-auth/cli` は非推奨）。図にない `verification`（メール確認などのトークン）も出力される。
業務テーブルはすべて `organizationId` を持ち、Service 層のクエリで必ず条件に含める（N-01）。
予約・添付ファイルから店舗・スタッフ・顧客・メニューへの参照は `(organizationId, xxxId)` → `(organizationId, id)` の複合外部キーにしてあり、他の組織の行を参照する INSERT・UPDATE は DB が拒否する。
日時の列は `timestamptz` で、UTC として保存する。

```mermaid
erDiagram
    user ||--o{ session : has
    user ||--o{ account : has
    user ||--o{ member : "belongs via"
    organization ||--o{ member : has
    organization ||--o{ invitation : has
    organization ||--o{ location : has
    organization ||--o{ service : has
    organization ||--o{ customer : has
    organization ||--o{ reservation : has
    organization ||--o| subscription : has
    organization ||--o{ auditLog : has
    member ||--o| staffProfile : "is staff"
    location ||--o{ reservation : at
    staffProfile ||--o{ reservation : handles
    customer ||--o{ reservation : books
    service ||--o{ reservation : for
    customer ||--o{ attachment : has

    organization {
        string id PK
        string name
        string slug UK
    }
    member {
        string id PK
        string organizationId FK
        string userId FK
        string role "owner | admin | staff"
    }
    staffProfile {
        string id PK
        string organizationId FK
        string memberId FK,UK
        string displayName
        boolean active
    }
    location {
        string id PK
        string organizationId FK
        string name
        string timezone "Asia/Tokyo"
    }
    service {
        string id PK
        string organizationId FK
        string name
        int durationMinutes
        int priceYen
    }
    customer {
        string id PK
        string organizationId FK
        string name
        string nameKana
        string email
        string phone
        string note
        datetime deletedAt "論理削除"
    }
    reservation {
        string id PK
        string organizationId FK
        string locationId FK
        string staffProfileId FK
        string customerId FK
        string serviceId FK
        datetime startsAt
        datetime endsAt
        string status "pending | confirmed | cancelled | done"
        int priceYen "予約時点の料金を保存"
        int version "楽観ロック"
    }
    attachment {
        string id PK
        string organizationId FK
        string customerId FK
        string s3Key
        string contentType
        int sizeBytes
    }
    subscription {
        string id PK
        string organizationId FK,UK
        string stripeCustomerId
        string stripeSubscriptionId
        string plan "free | pro"
        string status
        datetime currentPeriodEnd
    }
    auditLog {
        string id PK
        string organizationId FK
        string actorUserId
        string action "customer.update など"
        string targetType
        string targetId
        json diff
        datetime createdAt
    }
```

## スキーマでは表せない制約（マイグレーション SQL で追加）

Prisma のスキーマ言語は排他制約を表現できないため、`prisma migrate dev --create-only` で生成した SQL に追記する（第9章）。

> 検証済み（2026-11-23、`postgres:18` イメージ＝PostgreSQL 18.7）：同じスタッフで時間が重なる INSERT と、キャンセル済みを `confirmed` に戻す UPDATE は排他制約違反で拒否された。終了時刻ちょうどに始まる予約（`tstzrange` は既定で `[)` の半開区間）、別スタッフの同時刻予約、キャンセル済みとの重複は登録できた。

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservation
  ADD CONSTRAINT reservation_no_overlap
  EXCLUDE USING gist (
    "staffProfileId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  )
  WHERE (status <> 'cancelled');
```

アプリ側の「重複チェックしてから INSERT」だけでは、同時リクエストで二重予約が起きる。DB 制約で最終的に防ぎ、アプリは制約違反を「その時間は埋まっています」に変換する。AI に実装させるとアプリ側チェックだけになりやすい箇所なので、第9章の「AI 生成コードの問題と改善例」で扱う。

## インデックス方針（第15章で計測して確定）

- 業務テーブルは `(organizationId, ...)` の複合インデックスを基本にする
- `reservation (organizationId, startsAt)`：カレンダーとダッシュボード
- `customer (organizationId, nameKana)`：一覧と検索
