# RDS の CA（第17章）

本番の `DATABASE_URL` は `sslmode=verify-full&sslrootcert=/etc/ssl/rds/rds-ca-rsa2048-g1.crt` で RDS のサーバー証明書を検証する（`docs/architecture.md` の 4）。Dockerfile が web・worker・migrate のイメージの `/etc/ssl/rds/` に入れる。

| ファイル | 中身 | SHA-256 |
|----------|------|---------|
| `rds-ca-rsa2048-g1.crt` | `Amazon RDS ap-northeast-1 Root CA RSA2048 G1`（有効期限 2061-05-25） | `1e6881a91bf287b6ff2be7c003139a9bb4a7d75171819a72165114258efe93bd` |

- 取得元：`https://truststore.pki.rds.amazonaws.com/ap-northeast-1/ap-northeast-1-bundle.pem`（公開の静的ファイル、認証なし。2026-11-25 に取得。バンドルの SHA-256 は `d1df75221341812a657d7c7b070ff61ce78824fbf05acf499f7e394f5ff58d50`）。バンドルには RSA4096 G1・ECC384 G1・RSA2048 G1 の 3 つのルートがこの順に入っていて、3 番目を取り出した
- **1 つだけのファイルにする理由**：Prisma 7.10 の CLI（`prisma migrate deploy`）の `sslcert` はファイルの最初の証明書しか使わない。バンドルのままだと RSA4096 G1 だけで検証し、RSA2048 G1 の RDS に接続できない（手元の TLS 必須の PostgreSQL で、本物の CA を 3 番目に置いたバンドルが `unable to get local issuer certificate` になることを確かめた）
- RDS の `ca_cert_identifier`（`infra/terraform/modules/database`）と、Terraform が作る `DATABASE_URL` のファイル名はこの CA に合わせる。CA を変えるときは、ファイルを足したイメージを先にデプロイしてから、`ca_cert_identifier` と `db_ca_file` を変え、`db_password_version` を上げて apply する（`DATABASE_URL` のシークレットは版を上げたときだけ書き換わる）
- 名前を `.pem` にしないのは、`.gitignore`・`.dockerignore` が秘密鍵の事故を防ぐために `*.pem` を除いているため（規則を緩めない）
