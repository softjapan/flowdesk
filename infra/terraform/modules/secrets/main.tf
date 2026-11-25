# Secrets Manager（docs/architecture.md の「シークレット」）。
# ECS がタスクの起動時に読み、環境変数としてコンテナに渡す（タスク定義の
# secrets）。タスク定義・state・ログには値が出ない。
#
# | シークレット       | 値を入れるのは                       | 中身                                     |
# |--------------------|--------------------------------------|------------------------------------------|
# | database-url       | Terraform（書き込み専用、state なし）| DATABASE_URL                             |
# | better-auth-secret | Terraform（書き込み専用、state なし）| BETTER_AUTH_SECRET                       |
# | stripe             | 人（ダッシュボードの値）             | JSON：STRIPE_SECRET_KEY・STRIPE_WEBHOOK_SECRET・STRIPE_PRICE_PRO |
# | smtp               | 人（SES の SMTP の認証情報）         | JSON：SMTP_USER・SMTP_PASSWORD           |
#
# stripe と smtp は器だけを作る。値は初回のデプロイの前に人が入れる
# （手順は docs/architecture.md。Terraform のコードと state に鍵を置かない）。
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each                = toset(["database-url", "better-auth-secret", "stripe", "smtp"])
  name                    = "${var.name_prefix}/${each.key}"
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id                = aws_secretsmanager_secret.this["database-url"].id
  secret_string_wo         = var.database_url_wo
  secret_string_wo_version = var.database_url_wo_version
}

resource "aws_secretsmanager_secret_version" "better_auth_secret" {
  secret_id                = aws_secretsmanager_secret.this["better-auth-secret"].id
  secret_string_wo         = var.better_auth_secret_wo
  secret_string_wo_version = var.better_auth_secret_wo_version
}
