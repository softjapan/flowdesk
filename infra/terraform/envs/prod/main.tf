# FlowDesk の本番環境（docs/architecture.md）。第16章では形と主要なリソースを書き、
# 第17章で state・DNS・WAF・CI/CD を足して仕上げる。
# この章では AWS に接続しない（plan・apply しない）。確認は README の手順で
# fmt・validate・test（モックのプロバイダー）だけを行う。
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "flowdesk"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name = "flowdesk-${var.environment}"
  # BETTER_AUTH_URL（第14章）。メールのリンク・Cookie・オリジンの確認に使う。
  # 本番で未設定なら起動時に例外になる（src/server/app-url.ts）
  app_url = "https://${var.domain_name}"
}

# ---- 秘密の値（state に残さない） -------------------------------------------
# ephemeral は実行のたびに新しい値を作るが、受け取る側（password_wo・
# secret_string_wo）は *_version を上げたときだけ書き換える。最初の apply では、
# 同じ実行の同じ値が RDS とシークレットの両方に入る
ephemeral "random_password" "db" {
  length  = 32
  special = false # 接続文字列（URL）にそのまま入れる
}

ephemeral "random_password" "better_auth_secret" {
  length  = 48
  special = false
}

# CloudFront → ALB のヘッダーの値。CloudFront の設定に平文で入るので
# ephemeral にできない（state に残る。state のバケットは暗号化し、読める人を絞る）
resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

# ---- ネットワーク -----------------------------------------------------------
module "network" {
  source = "../../modules/network"

  name                = local.name
  region              = var.region
  cidr_block          = "10.20.0.0/16"
  azs                 = var.azs
  public_subnet_cidrs = ["10.20.0.0/24", "10.20.1.0/24"]
  app_subnet_cidrs    = ["10.20.10.0/24", "10.20.11.0/24"]
  db_subnet_cidrs     = ["10.20.20.0/24", "10.20.21.0/24"]
  single_nat_gateway  = var.single_nat_gateway
}

# ---- データ -----------------------------------------------------------------
module "database" {
  source = "../../modules/database"

  name                = local.name
  vpc_id              = module.network.vpc_id
  subnet_ids          = module.network.db_subnet_ids
  instance_class      = var.db_instance_class
  multi_az            = var.db_multi_az
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = var.db_password_version
  client_security_group_ids = {
    web     = module.ecs.security_group_ids["web"]
    worker  = module.ecs.security_group_ids["worker"]
    migrate = module.ecs.security_group_ids["migrate"]
  }
}

module "storage" {
  source = "../../modules/storage"

  bucket_name          = "${local.name}-uploads-${var.bucket_suffix}"
  cors_allowed_origins = [local.app_url]
}

module "queue" {
  source = "../../modules/queue"

  # docker/elasticmq.conf と同じ名前
  name              = "flowdesk-jobs"
  max_receive_count = 3
  alarm_actions     = var.alarm_topic_arns
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix = "flowdesk/${var.environment}"
  # RDS は TLS を必須にしている（rds.force_ssl）。sslmode=no-verify は暗号化するが
  # サーバー証明書を検証しない。RDS の CA を同梱して verify-full にするのは
  # 第17章（docs/architecture.md の要確認）
  # 書式の行は接続文字列の形に見えるが、値は入っていない（パスワードは ephemeral）
  database_url_wo = format(
    "postgresql://%s:%s@%s:%d/%s?sslmode=no-verify", # secret-scan:allow
    module.database.username,
    ephemeral.random_password.db.result,
    module.database.address,
    module.database.port,
    module.database.db_name,
  )
  database_url_wo_version       = var.db_password_version
  better_auth_secret_wo         = ephemeral.random_password.better_auth_secret.result
  better_auth_secret_wo_version = var.better_auth_secret_version
}

# ---- 入口 -------------------------------------------------------------------
module "alb" {
  source = "../../modules/alb"

  name                       = local.name
  vpc_id                     = module.network.vpc_id
  vpc_cidr_block             = module.network.vpc_cidr_block
  public_subnet_ids          = module.network.public_subnet_ids
  certificate_arn            = var.alb_certificate_arn
  origin_verify_header_value = random_password.origin_verify.result
}

module "cdn" {
  source = "../../modules/cdn"

  name                       = local.name
  domain_name                = var.domain_name
  certificate_arn            = var.cloudfront_certificate_arn
  alb_dns_name               = module.alb.dns_name
  origin_verify_header_value = random_password.origin_verify.result
}

# ---- アプリケーション -------------------------------------------------------
module "ecs" {
  source = "../../modules/ecs"

  name                  = local.name
  region                = var.region
  vpc_id                = module.network.vpc_id
  vpc_cidr_block        = module.network.vpc_cidr_block
  app_subnet_ids        = module.network.app_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arn
  image_tag             = var.image_tag
  s3_bucket_arn         = module.storage.bucket_arn
  queue_arn             = module.queue.queue_arn
  secret_arns           = module.secrets.arns

  # 秘密でない値だけ。S3_ENDPOINT・SQS_ENDPOINT・AWS の鍵は設定しない
  # （AWS の既定の接続先とタスクロールを使う。src/server/aws.ts）
  environment = {
    NODE_ENV        = "production"
    BETTER_AUTH_URL = local.app_url
    AWS_REGION      = var.region
    S3_BUCKET       = module.storage.bucket_name
    SQS_QUEUE_URL   = module.queue.queue_url
    SMTP_HOST       = "email-smtp.${var.region}.amazonaws.com"
    SMTP_PORT       = "587"
    MAIL_FROM       = var.mail_from
  }
}
