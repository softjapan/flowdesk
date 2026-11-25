# 本番の設定の主要な値を、AWS に接続せずに確かめる（第16〜17章）。
#   cd infra/terraform/envs/prod && terraform init -backend=false && terraform test
#
# - aws はモックのプロバイダー（API を呼ばず、計算される属性に仮の値を入れる）。
#   random は本物（手元で値を作るだけで、どこにも接続しない）
# - テストから見えるのは、テストする構成のリソースと、子モジュールの出力だけ。
#   そこで、モジュールの中のリソースは module { source } でモジュールごとに確かめ、
#   つなぎ方（BETTER_AUTH_URL・どのタスクにどのシークレットを渡すか）は
#   本番の構成（envs/prod）全体を apply して ECS モジュールの出力で確かめる
# - モックでもプロバイダーの値の検証（ARN の形など）は動くので、ARN を受け取る
#   属性に渡る値だけ、形の正しい仮の値を決めておく

mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_lb" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:ap-northeast-1:111122223333:loadbalancer/app/mock/0123456789abcdef"
      arn_suffix = "app/mock/0123456789abcdef"
      dns_name   = "mock-alb-123456.ap-northeast-1.elb.amazonaws.com"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:111122223333:targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:111122223333:listener/app/mock/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::flowdesk-prod-uploads-111122223333" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/prod/mock-AbCdEf" }
  }
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:ap-northeast-1:111122223333:mock" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111122223333.dkr.ecr.ap-northeast-1.amazonaws.com/flowdesk-prod/mock" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address = "flowdesk-prod.abcdefghijkl.ap-northeast-1.rds.amazonaws.com"
      port    = 5432
    }
  }
  mock_data "aws_ec2_managed_prefix_list" {
    defaults = { id = "pl-58a04531" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:ap-northeast-1:111122223333:cluster/flowdesk-prod" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn                  = "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-prod-mock:1"
      arn_without_revision = "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-prod-mock"
    }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-northeast-1:111122223333:flowdesk-prod-alarms" }
  }
  # 第18章：監視（KMS・EventBridge → CloudWatch Logs）
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:ap-northeast-1:111122223333:key/00000000-0000-0000-0000-000000000000"
      key_id = "00000000-0000-0000-0000-000000000000"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-northeast-1:111122223333:log-group:/mock" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
}

# CloudFront 用の WAF（us-east-1）
mock_provider "aws" {
  alias = "us_east_1"

  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:111122223333:global/webacl/flowdesk-prod/00000000-0000-0000-0000-000000000000" }
  }
}

variables {
  domain_name                = "app.flowdesk.test"
  alb_certificate_arn        = "arn:aws:acm:ap-northeast-1:111122223333:certificate/alb"
  cloudfront_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/cloudfront"
  bucket_suffix              = "111122223333"
  image_tag                  = "git-abc1234"
  mail_from                  = "FlowDesk <no-reply@flowdesk.test>"
  github_repository          = "example-org/flowdesk"
}

# ==== 本番の構成全体（つなぎ方） ===============================================

run "production_wiring" {
  command = apply

  # 秘密が平文の環境変数（タスク定義に値がそのまま残る）に入っていない
  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs :
        length(setintersection([for e in c.environment : e.name], [
          "DATABASE_URL", "BETTER_AUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
          "STRIPE_PRICE_PRO", "SMTP_USER", "SMTP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
        ])) == 0
      ]
    ]))
    error_message = "秘密を environment に入れない（Secrets Manager から secrets で渡す）。"
  }

  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs : [
          for e in c.environment : !strcontains(e.value, "postgres://") && !strcontains(e.value, "postgresql://")
        ]
      ]
    ]))
    error_message = "接続文字列（パスワードを含む）を環境変数の値に入れない。"
  }

  assert {
    condition = (
      [for s in module.ecs.container_definitions["web"][0].secrets : s.name] ==
      ["BETTER_AUTH_SECRET", "DATABASE_URL", "STRIPE_PRICE_PRO", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
    )
    error_message = "web には DATABASE_URL・BETTER_AUTH_SECRET・STRIPE_* を Secrets Manager から渡す。"
  }

  assert {
    condition = (
      [for s in module.ecs.container_definitions["worker"][0].secrets : s.name] ==
      ["DATABASE_URL", "SMTP_PASSWORD", "SMTP_USER"]
    )
    error_message = "worker には使うものだけを渡す（Stripe の鍵・BETTER_AUTH_SECRET は渡さない）。"
  }

  assert {
    condition = (
      [for s in module.ecs.container_definitions["migrate"][0].secrets : s.name] == ["DATABASE_URL"]
    )
    error_message = "migrate には DATABASE_URL だけを渡す。"
  }

  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs : [for s in c.secrets : startswith(s.valueFrom, "arn:aws:secretsmanager:")]
      ]
    ]))
    error_message = "secrets の valueFrom は Secrets Manager の ARN にする。"
  }

  # 第14章：本番で BETTER_AUTH_URL がないと起動時に例外（src/server/app-url.ts）
  assert {
    condition = alltrue([
      for name in ["web", "worker"] :
      contains(
        [for e in module.ecs.container_definitions[name][0].environment : "${e.name}=${e.value}"],
        "BETTER_AUTH_URL=https://app.flowdesk.test",
      )
    ])
    error_message = "web と worker に BETTER_AUTH_URL（https のアプリの公開 URL）を渡す。"
  }

  assert {
    condition     = output.app_url == "https://app.flowdesk.test"
    error_message = "公開 URL は https://<domain_name>。"
  }

  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs : length(setintersection([for e in c.environment : e.name], ["S3_ENDPOINT", "SQS_ENDPOINT"])) == 0
      ]
    ]))
    error_message = "本番では S3_ENDPOINT・SQS_ENDPOINT を設定しない（AWS の既定の接続先とタスクロールを使う）。"
  }

  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs : c.user == (c.name == "otel-collector" ? "10001:10001" : "1000:1000")
      ]
    ]))
    error_message = "どのコンテナも非 root（アプリは UID 1000、Dockerfile の node ユーザー。Collector は 10001）で動かす。"
  }

  # ---- 第18章：ログとトレース --------------------------------------------------
  assert {
    condition = alltrue([
      for name in ["web", "worker"] : alltrue([
        for kv in [
          "OTEL_SERVICE_NAME=flowdesk-${name}",
          "OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318",
          "OTEL_TRACES_SAMPLER_ARG=0.1",
          "LOG_FORMAT=json",
          "APP_VERSION=git-abc1234",
          "DEPLOYMENT_ENVIRONMENT=prod",
        ] : contains([for e in module.ecs.container_definitions[name][0].environment : "${e.name}=${e.value}"], kv)
      ])
    ])
    error_message = "web・worker は JSON のログを出し、タスクの中の Collector に 10% のトレースを送り、版と環境を付ける。"
  }

  assert {
    condition = contains(
      [for e in module.ecs.container_definitions["web"][0].environment : "${e.name}=${e.value}"],
      "LOG_EMF_NAMESPACE=FlowDesk",
    )
    error_message = "web はアクセスログを EMF にし、RequestDuration（p95 のアラーム）を出す。"
  }

  assert {
    condition = (
      [for c in module.ecs.container_definitions["web"] : c.name] == ["web", "otel-collector"] &&
      [for c in module.ecs.container_definitions["worker"] : c.name] == ["worker", "otel-collector"] &&
      [for c in module.ecs.container_definitions["migrate"] : c.name] == ["migrate"]
    )
    error_message = "web・worker のタスクに ADOT Collector のサイドカーを足す（migrate には足さない）。"
  }

  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs : c.name != "otel-collector" || (
          !c.essential &&
          !endswith(c.image, ":latest") &&
          strcontains(one([for e in c.environment : e.value if e.name == "AOT_CONFIG_CONTENT"]), "https://xray.ap-northeast-1.amazonaws.com/v1/traces") &&
          strcontains(one([for e in c.environment : e.value if e.name == "AOT_CONFIG_CONTENT"]), "127.0.0.1:4318")
        )
      ]
    ]))
    error_message = "Collector は止まってもアプリを止めず（essential = false）、版を固定し、タスクの中だけで受けて X-Ray の OTLP エンドポイントへ送る。"
  }

  assert {
    condition = alltrue(flatten([
      for name, defs in module.ecs.container_definitions : [
        for c in defs : c.logConfiguration.options.mode == "non-blocking"
      ]
    ]))
    error_message = "awslogs は non-blocking（CloudWatch Logs が遅れてもアプリの stdout を止めない）。"
  }

  # ---- 第18章：監視 -----------------------------------------------------------
  assert {
    condition     = toset(keys(output.alarm_topic_arns)) == toset(["critical", "warning"])
    error_message = "通知先は critical（すぐ対応）と warning（次の営業日）の 2 つ。"
  }

  assert {
    condition = alltrue([
      for k in ["alb-5xx-ratio", "alb-unhealthy-targets", "app-p95-critical", "jobs-queue-stalled", "ecs-web-task-stops", "ecs-worker-task-stops", "rds-free-storage"] :
      contains(keys(module.monitoring.alarm_severities), k) && module.monitoring.alarm_severities[k] == "critical"
    ])
    error_message = "利用者に影響があるもの・放っておくと止まるものは critical。"
  }

  assert {
    condition = alltrue([
      for k in ["app-p95-slo", "dlq-not-empty", "app-errors", "rds-cpu", "rds-connections", "rds-freeable-memory"] :
      contains(keys(module.monitoring.alarm_severities), k) && module.monitoring.alarm_severities[k] == "warning"
    ])
    error_message = "遅い・失敗が溜まっているものは warning。"
  }

  assert {
    condition     = module.network.nat_gateway_count == 1
    error_message = "既定では NAT Gateway は 1 つ（費用を抑える）。"
  }

  # 第17章：RDS のサーバー証明書を、イメージに入れた CA で検証する
  assert {
    condition     = output.database_tls_query == "sslmode=verify-full&sslrootcert=/etc/ssl/rds/rds-ca-rsa2048-g1.crt"
    error_message = "DATABASE_URL は verify-full で、RDS に指定した CA（イメージの /etc/ssl/rds/）を使う。"
  }

  assert {
    condition     = output.web_acl_arn == "arn:aws:wafv2:us-east-1:111122223333:global/webacl/flowdesk-prod/00000000-0000-0000-0000-000000000000"
    error_message = "CloudFront に WAF を付ける。"
  }

  assert {
    condition     = output.github_deploy_subject == "repo:example-org/flowdesk:environment:production"
    error_message = "デプロイのロールは、このリポジトリの production の environment だけが引き受けられる。"
  }

  assert {
    condition = (
      output.github_deploy_variables.MIGRATE_SECURITY_GROUPS == module.ecs.security_group_ids["migrate"] &&
      output.github_deploy_variables.ECS_CLUSTER == "flowdesk-prod" &&
      output.github_deploy_variables.NAME_PREFIX == "flowdesk-prod"
    )
    error_message = "デプロイのワークフローに渡す値（migrate の SG・クラスター・名前）。"
  }
}

run "rejects_ca_not_in_image" {
  command = plan

  variables {
    db_ca_cert_identifier = "rds-ca-ecc384-g1"
  }

  expect_failures = [var.db_ca_cert_identifier]
}

run "waf_can_be_disabled" {
  command = plan

  variables {
    enable_waf = false
  }

  assert {
    condition     = length(module.waf) == 0
    error_message = "enable_waf = false なら WAF を作らない。"
  }
}

run "nat_gateway_per_az" {
  command = apply

  variables {
    single_nat_gateway = false
  }

  assert {
    condition     = module.network.nat_gateway_count == 2
    error_message = "single_nat_gateway = false なら AZ ごとに NAT Gateway を置く。"
  }
}

run "rejects_url_as_domain_name" {
  command = plan

  variables {
    domain_name = "https://app.flowdesk.test"
  }

  expect_failures = [var.domain_name]
}

run "rejects_cloudfront_certificate_outside_us_east_1" {
  command = plan

  variables {
    cloudfront_certificate_arn = "arn:aws:acm:ap-northeast-1:111122223333:certificate/cloudfront"
  }

  expect_failures = [var.cloudfront_certificate_arn]
}

# ==== モジュールごと ===========================================================

run "network_db_subnets_have_no_internet_route" {
  command = apply

  module {
    source = "../../modules/network"
  }

  variables {
    name                = "flowdesk-test"
    region              = "ap-northeast-1"
    azs                 = ["ap-northeast-1a", "ap-northeast-1c"]
    public_subnet_cidrs = ["10.20.0.0/24", "10.20.1.0/24"]
    app_subnet_cidrs    = ["10.20.10.0/24", "10.20.11.0/24"]
    db_subnet_cidrs     = ["10.20.20.0/24", "10.20.21.0/24"]
  }

  assert {
    condition = alltrue([
      for r in concat([aws_route.public_internet], aws_route.app_nat) :
      r.route_table_id != aws_route_table.db.id
    ])
    error_message = "db サブネットのルートテーブルに、インターネット・NAT への経路を作らない。"
  }

  assert {
    condition     = alltrue([for a in aws_route_table_association.db : a.route_table_id == aws_route_table.db.id])
    error_message = "db サブネットは db のルートテーブルだけを使う。"
  }

  assert {
    condition     = alltrue([for s in aws_subnet.public : !s.map_public_ip_on_launch])
    error_message = "public サブネットでも自動でパブリック IP を付けない。"
  }
}

run "rds_is_private" {
  command = apply

  module {
    source = "../../modules/database"
  }

  variables {
    name                      = "flowdesk-test"
    vpc_id                    = "vpc-0123456789abcdef0"
    subnet_ids                = ["subnet-db-a", "subnet-db-c"]
    client_security_group_ids = { web = "sg-web", worker = "sg-worker", migrate = "sg-migrate" }
    password_wo               = "test-only-password"
    password_wo_version       = 1
  }

  assert {
    condition     = aws_db_instance.this.publicly_accessible == false
    error_message = "RDS を公開してはいけない（publicly_accessible = false）。"
  }

  assert {
    condition     = aws_db_subnet_group.this.subnet_ids == toset(["subnet-db-a", "subnet-db-c"])
    error_message = "RDS は渡された db サブネットだけに置く。"
  }

  assert {
    condition = alltrue([
      for r in aws_vpc_security_group_ingress_rule.clients :
      r.cidr_ipv4 == null && r.cidr_ipv6 == null && r.prefix_list_id == null && r.from_port == 5432 && r.to_port == 5432
    ])
    error_message = "RDS へはセキュリティグループからの 5432 だけを許す（CIDR で開けない）。"
  }

  assert {
    condition = (
      aws_db_instance.this.storage_encrypted &&
      aws_db_instance.this.deletion_protection &&
      aws_db_instance.this.multi_az &&
      !aws_db_instance.this.skip_final_snapshot &&
      aws_db_instance.this.backup_retention_period >= 7
    )
    error_message = "暗号化・削除保護・Multi-AZ・最後のスナップショット・7 日以上のバックアップを有効にする。"
  }

  # 第18章：ポイントインタイムリカバリ（docs/runbooks/restore.md）
  assert {
    condition = (
      aws_db_instance.this.backup_retention_period == 7 &&
      aws_db_instance.this.delete_automated_backups == false &&
      aws_db_instance.this.copy_tags_to_snapshot &&
      aws_db_instance.this.final_snapshot_identifier == "flowdesk-test-final"
    )
    error_message = "自動バックアップを 7 日残し（PITR で戻せる期間）、インスタンスを消しても自動バックアップを消さない。"
  }

  assert {
    condition = (
      aws_db_instance.this.backup_window == "18:00-18:30" &&
      aws_db_instance.this.maintenance_window == "sun:19:00-sun:19:30"
    )
    error_message = "バックアップは JST 03:00、メンテナンスはその後（日曜 JST 04:00）で重ねない。"
  }

  assert {
    condition     = contains(aws_db_instance.this.enabled_cloudwatch_logs_exports, "postgresql")
    error_message = "PostgreSQL のログ（遅いクエリ・エラー）を CloudWatch Logs に送る（障害の調査で使う）。"
  }

  assert {
    condition     = contains([for p in aws_db_parameter_group.this.parameter : "${p.name}=${p.value}"], "rds.force_ssl=1")
    error_message = "TLS 以外の接続を拒否する（rds.force_ssl = 1）。"
  }

  assert {
    condition     = aws_db_instance.this.password == null
    error_message = "DB のパスワードは書き込み専用の属性（password_wo）で渡し、state に残さない。"
  }
}

run "s3_blocks_public_access" {
  command = apply

  module {
    source = "../../modules/storage"
  }

  variables {
    bucket_name          = "flowdesk-test-uploads"
    cors_allowed_origins = ["https://app.flowdesk.test"]
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.this.block_public_acls &&
      aws_s3_bucket_public_access_block.this.block_public_policy &&
      aws_s3_bucket_public_access_block.this.ignore_public_acls &&
      aws_s3_bucket_public_access_block.this.restrict_public_buckets
    )
    error_message = "S3 のパブリックアクセスのブロックを 4 つとも有効にする。"
  }

  assert {
    condition     = one(aws_s3_bucket_ownership_controls.this.rule).object_ownership == "BucketOwnerEnforced"
    error_message = "ACL を無効にする（BucketOwnerEnforced）。"
  }

  assert {
    condition     = one(aws_s3_bucket_cors_configuration.this.cors_rule).allowed_origins == toset(["https://app.flowdesk.test"])
    error_message = "CORS はアプリの公開 URL（BETTER_AUTH_URL）だけを許す。"
  }

  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.this.policy).Statement[0].Effect == "Deny" &&
      jsondecode(aws_s3_bucket_policy.this.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "TLS 以外の接続を拒否する。"
  }
}

run "s3_rejects_plain_http_cors_origin" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    bucket_name          = "flowdesk-test-uploads"
    cors_allowed_origins = ["http://app.flowdesk.test"]
  }

  expect_failures = [var.cors_allowed_origins]
}

run "sqs_dead_letter_queue" {
  command = apply

  module {
    source = "../../modules/queue"
  }

  variables {
    name = "flowdesk-jobs"
  }

  override_resource {
    target = aws_sqs_queue.dlq
    values = {
      arn  = "arn:aws:sqs:ap-northeast-1:111122223333:flowdesk-jobs-dlq"
      id   = "https://sqs.ap-northeast-1.amazonaws.com/111122223333/flowdesk-jobs-dlq"
      name = "flowdesk-jobs-dlq"
    }
  }

  assert {
    condition     = jsondecode(aws_sqs_queue.this.redrive_policy).maxReceiveCount == 3
    error_message = "3 回受信して消されなかったメッセージを DLQ へ移す（maxReceiveCount = 3、docker/elasticmq.conf と同じ）。"
  }

  assert {
    condition     = jsondecode(aws_sqs_queue.this.redrive_policy).deadLetterTargetArn == "arn:aws:sqs:ap-northeast-1:111122223333:flowdesk-jobs-dlq"
    error_message = "移す先は flowdesk-jobs-dlq。"
  }

  assert {
    condition = (
      aws_sqs_queue.this.name == "flowdesk-jobs" &&
      aws_sqs_queue.this.visibility_timeout_seconds == 60 &&
      aws_sqs_queue.this.sqs_managed_sse_enabled &&
      aws_sqs_queue.dlq.sqs_managed_sse_enabled
    )
    error_message = "名前と可視性タイムアウトを docker/elasticmq.conf と合わせ、暗号化する。"
  }

  assert {
    condition     = output.dlq_name == "flowdesk-jobs-dlq"
    error_message = "DLQ の名前を出力する（modules/monitoring のアラームが使う）。"
  }
}

run "secrets_are_not_stored_in_state" {
  command = apply

  module {
    source = "../../modules/secrets"
  }

  variables {
    name_prefix                   = "flowdesk/test"
    database_url_wo               = "postgresql://flowdesk:test-only@localhost:5432/flowdesk"
    database_url_wo_version       = 1
    better_auth_secret_wo         = "test-only-better-auth-secret"
    better_auth_secret_wo_version = 1
  }

  assert {
    condition = (
      aws_secretsmanager_secret_version.database_url.secret_string == null &&
      aws_secretsmanager_secret_version.better_auth_secret.secret_string == null
    )
    error_message = "Terraform が作る秘密は書き込み専用の属性（secret_string_wo）で入れ、state に残さない。"
  }

  assert {
    condition     = toset(keys(aws_secretsmanager_secret.this)) == toset(["database-url", "better-auth-secret", "stripe", "smtp"])
    error_message = "シークレットは 4 つ。"
  }
}

run "ecs_tasks" {
  command = apply

  module {
    source = "../../modules/ecs"
  }

  variables {
    name                  = "flowdesk-test"
    region                = "ap-northeast-1"
    vpc_id                = "vpc-0123456789abcdef0"
    vpc_cidr_block        = "10.20.0.0/16"
    app_subnet_ids        = ["subnet-app-a", "subnet-app-c"]
    alb_security_group_id = "sg-alb"
    target_group_arn      = "arn:aws:elasticloadbalancing:ap-northeast-1:111122223333:targetgroup/mock/0123456789abcdef"
    s3_bucket_arn         = "arn:aws:s3:::flowdesk-test-uploads"
    queue_arn             = "arn:aws:sqs:ap-northeast-1:111122223333:flowdesk-jobs"
    environment           = { NODE_ENV = "production", BETTER_AUTH_URL = "https://app.flowdesk.test" }
    secret_arns = {
      database-url       = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/database-url-AbCdEf"
      better-auth-secret = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/better-auth-secret-AbCdEf"
      stripe             = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/stripe-AbCdEf"
      smtp               = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/smtp-AbCdEf"
    }
  }

  assert {
    condition = alltrue(flatten([
      for td in aws_ecs_task_definition.this : [
        for c in jsondecode(td.container_definitions) : c.user == (c.name == "otel-collector" ? "10001:10001" : "1000:1000")
      ]
    ]))
    error_message = "タスク定義のどのコンテナも非 root（アプリは UID 1000、Collector は 10001）で動かす。"
  }

  assert {
    condition = (
      toset(keys(aws_iam_role_policy.task_xray)) == toset(["web", "worker"]) &&
      alltrue([
        for p in aws_iam_role_policy.task_xray :
        jsondecode(p.policy).Statement[0].Action == ["xray:PutTraceSegments"]
      ])
    )
    error_message = "トレースを送る web・worker のタスクロールに、X-Ray へ送る権限（PutTraceSegments だけ）を付ける。"
  }

  assert {
    condition = alltrue(flatten([
      for td in aws_ecs_task_definition.this : [
        for c in jsondecode(td.container_definitions) :
        c.readonlyRootFilesystem && !c.privileged && c.linuxParameters.capabilities.drop == ["ALL"]
      ]
    ]))
    error_message = "ルートを読み取り専用にし、特権を与えず、capability をすべて外す。"
  }

  assert {
    condition = (
      [for s in jsondecode(aws_ecs_task_definition.this["web"].container_definitions)[0].secrets : s.valueFrom] == [
        "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/better-auth-secret-AbCdEf",
        "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/database-url-AbCdEf",
        "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/stripe-AbCdEf:STRIPE_PRICE_PRO::",
        "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/stripe-AbCdEf:STRIPE_SECRET_KEY::",
        "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/stripe-AbCdEf:STRIPE_WEBHOOK_SECRET::",
      ]
    )
    error_message = "Stripe の値は JSON のシークレットからキーで取り出す（<ARN>:<キー>::）。"
  }

  assert {
    condition     = alltrue([for td in aws_ecs_task_definition.this : one(td.runtime_platform).cpu_architecture == "ARM64"])
    error_message = "Graviton（ARM64）で動かす。"
  }

  assert {
    condition = alltrue([
      for c in jsondecode(aws_ecs_task_definition.this["web"].container_definitions) :
      c.logConfiguration.options.mode == "non-blocking" && c.logConfiguration.options["awslogs-group"] == aws_cloudwatch_log_group.this["web"].name
    ])
    error_message = "web のログ（アプリと Collector）は web のロググループに non-blocking で送る。"
  }

  assert {
    condition = alltrue([
      for s in [aws_ecs_service.web, aws_ecs_service.worker] : one(s.network_configuration).assign_public_ip == false
    ])
    error_message = "タスクにパブリック IP を付けない（private サブネットから NAT 経由で出る）。"
  }

  assert {
    condition     = !aws_ecs_service.web.enable_execute_command && !aws_ecs_service.worker.enable_execute_command
    error_message = "ECS Exec は既定で無効にする（使うときだけ有効にする）。"
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.execution_secrets.policy).Statement[0].Action == ["secretsmanager:GetSecretValue"] &&
      length(jsondecode(aws_iam_role_policy.execution_secrets.policy).Statement[0].Resource) == 4 &&
      !contains(jsondecode(aws_iam_role_policy.execution_secrets.policy).Statement[0].Resource, "*")
    )
    error_message = "実行ロールが読めるのは、このアプリの 4 つのシークレットだけ。"
  }

  assert {
    condition = alltrue(flatten([
      for p in aws_iam_role_policy.task : [
        for s in jsondecode(p.policy).Statement : s.Resource != "*" && !contains(s.Action, "*")
      ]
    ]))
    error_message = "タスクロールに * の権限を与えない。"
  }

  assert {
    condition     = toset(keys(aws_iam_role.task)) == toset(["web", "worker"])
    error_message = "migrate にはタスクロールを付けない（AWS の API を使わない）。"
  }

  assert {
    condition = alltrue([
      for r in aws_vpc_security_group_egress_rule.this :
      contains([443, 5432, 587], r.from_port) && r.from_port == r.to_port
    ])
    error_message = "外向きは 443・5432・587 だけ。"
  }

  assert {
    condition     = alltrue([for r in aws_ecr_repository.this : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "ECR のタグは上書きできないようにする。"
  }
}

run "ecs_rejects_latest_tag" {
  command = plan

  module {
    source = "../../modules/ecs"
  }

  variables {
    name                  = "flowdesk-test"
    region                = "ap-northeast-1"
    vpc_id                = "vpc-0123456789abcdef0"
    vpc_cidr_block        = "10.20.0.0/16"
    app_subnet_ids        = ["subnet-app-a", "subnet-app-c"]
    alb_security_group_id = "sg-alb"
    target_group_arn      = "arn:aws:elasticloadbalancing:ap-northeast-1:111122223333:targetgroup/mock/0123456789abcdef"
    s3_bucket_arn         = "arn:aws:s3:::flowdesk-test-uploads"
    queue_arn             = "arn:aws:sqs:ap-northeast-1:111122223333:flowdesk-jobs"
    image_tag             = "latest"
    environment           = { DATABASE_URL = "postgresql://should-not-be-here" }
    secret_arns           = { database-url = "x", better-auth-secret = "x", stripe = "x", smtp = "x" }
  }

  expect_failures = [var.image_tag, var.environment]
}

run "alb_accepts_only_cloudfront" {
  command = apply

  module {
    source = "../../modules/alb"
  }

  variables {
    name                       = "flowdesk-test"
    vpc_id                     = "vpc-0123456789abcdef0"
    vpc_cidr_block             = "10.20.0.0/16"
    public_subnet_ids          = ["subnet-public-a", "subnet-public-c"]
    certificate_arn            = "arn:aws:acm:ap-northeast-1:111122223333:certificate/alb"
    origin_verify_header_value = "test-only-origin-verify"
  }

  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.cloudfront.prefix_list_id == "pl-58a04531" &&
      aws_vpc_security_group_ingress_rule.cloudfront.cidr_ipv4 == null &&
      aws_vpc_security_group_ingress_rule.cloudfront.from_port == 443
    )
    error_message = "ALB は CloudFront のプレフィックスリストからの 443 だけを受ける。"
  }

  assert {
    condition = (
      one(aws_lb_listener.https.default_action).type == "fixed-response" &&
      one(one(aws_lb_listener.https.default_action).fixed_response).status_code == "403"
    )
    error_message = "CloudFront のヘッダーがないリクエストは 403。"
  }

  assert {
    condition = (
      one(one(aws_lb_listener_rule.from_cloudfront.condition).http_header).http_header_name == "X-Origin-Verify" &&
      one(one(aws_lb_listener_rule.from_cloudfront.condition).http_header).values == toset(["test-only-origin-verify"])
    )
    error_message = "CloudFront が付けるヘッダーが一致したときだけ Web に転送する。"
  }

  assert {
    condition     = aws_lb.this.drop_invalid_header_fields && aws_lb.this.enable_deletion_protection
    error_message = "不正なヘッダーを落とし、削除保護を有効にする。"
  }

  assert {
    condition     = one(aws_lb_target_group.web.health_check).path == "/login"
    error_message = "ヘルスチェックは DB を使わない画面（/login）にする。"
  }
}

run "cloudfront_forwards_to_alb_over_https" {
  command = apply

  module {
    source = "../../modules/cdn"
  }

  variables {
    name                       = "flowdesk-test"
    domain_name                = "app.flowdesk.test"
    certificate_arn            = "arn:aws:acm:us-east-1:111122223333:certificate/cloudfront"
    alb_dns_name               = "mock-alb-123456.ap-northeast-1.elb.amazonaws.com"
    origin_verify_header_value = "test-only-origin-verify"
  }

  assert {
    condition = (
      one(aws_cloudfront_distribution.this.default_cache_behavior).viewer_protocol_policy == "redirect-to-https" &&
      one(one(aws_cloudfront_distribution.this.origin).custom_origin_config).origin_protocol_policy == "https-only"
    )
    error_message = "利用者 → CloudFront → ALB をすべて HTTPS にする。"
  }

  assert {
    condition = (
      data.aws_cloudfront_cache_policy.caching_disabled.name == "Managed-CachingDisabled" &&
      data.aws_cloudfront_cache_policy.caching_optimized.name == "Managed-CachingOptimized" &&
      data.aws_cloudfront_origin_request_policy.all_viewer.name == "Managed-AllViewer"
    )
    error_message = "マネージドポリシーを名前でも引き、plan のときに ID と照合する（precondition）。"
  }

  assert {
    condition = (
      one(aws_cloudfront_distribution.this.default_cache_behavior).cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" &&
      one(aws_cloudfront_distribution.this.default_cache_behavior).origin_request_policy_id == "216adef6-5c7f-47e4-b989-5492eafa07d3"
    )
    error_message = "画面と API はキャッシュせず（CachingDisabled）、Host・Cookie・RSC のヘッダーを渡す（AllViewer）。"
  }

  assert {
    condition = (
      one([for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b if b.path_pattern == "/_next/static/*"]).cache_policy_id == "658327ea-f89d-4fab-a63d-7e88639e58f6"
    )
    error_message = "/_next/static/* だけをキャッシュする（CachingOptimized）。"
  }

  assert {
    condition     = one(one(aws_cloudfront_distribution.this.origin).custom_header).value == "test-only-origin-verify"
    error_message = "ALB が確かめるヘッダーを付ける。"
  }

  assert {
    condition     = aws_cloudfront_distribution.this.aliases == toset(["app.flowdesk.test"])
    error_message = "CloudFront の別名はアプリのドメイン。"
  }

  assert {
    condition     = contains(aws_cloudfront_origin_request_policy.host_only.headers_config[0].headers[0].items, "host")
    error_message = "静的ファイルにも Host を渡す（ALB の証明書がアプリのドメインのため）。"
  }
}

# ==== 第17章 ===================================================================

run "deploy_role_trusts_only_this_repository_and_environment" {
  command = apply

  module {
    source = "../../modules/deploy"
  }

  variables {
    name                               = "flowdesk-test"
    github_repository                  = "example-org/flowdesk"
    ecr_repository_arns                = ["arn:aws:ecr:ap-northeast-1:111122223333:repository/flowdesk-test/web"]
    cluster_arn                        = "arn:aws:ecs:ap-northeast-1:111122223333:cluster/flowdesk-test"
    service_arns                       = ["arn:aws:ecs:ap-northeast-1:111122223333:service/flowdesk-test/web"]
    migrate_task_definition_family_arn = "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-test-migrate"
    pass_role_arns                     = ["arn:aws:iam::111122223333:role/flowdesk-test-ecs-execution"]
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity" &&
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Principal.Federated == "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    )
    error_message = "GitHub の OIDC のトークンでだけ引き受けられる。"
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals == {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:example-org/flowdesk:environment:production"
      }
    )
    error_message = "sub はこのリポジトリの production の environment だけ（完全一致）、aud は sts.amazonaws.com。"
  }

  assert {
    condition     = keys(jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition) == ["StringEquals"]
    error_message = "StringLike（ワイルドカード）を使わない。"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      s.Resource != "*" || contains(["EcrLogin", "TaskDefinitions"], s.Sid)
    ])
    error_message = "Resource = * はリソースを指定できない操作（ECR のログイン・タスク定義の読み取りと登録）だけ。"
  }

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [
        for a in s.Action : !strcontains(a, "*")
      ]
    ]))
    error_message = "操作に * を使わない。"
  }

  assert {
    condition = (
      one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "PassTaskRoles"]).Condition.StringEquals["iam:PassedToService"] == "ecs-tasks.amazonaws.com"
    )
    error_message = "PassRole は ECS のタスクに渡すときだけ。"
  }

  assert {
    condition = (
      one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "RunMigrate"]).Resource == "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-test-migrate:*" &&
      one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "RunMigrate"]).Condition.ArnEquals["ecs:cluster"] == "arn:aws:ecs:ap-northeast-1:111122223333:cluster/flowdesk-test"
    )
    error_message = "run-task できるのは、このクラスターでの migrate だけ。"
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "WatchMigrate"]).Resource == "arn:aws:ecs:ap-northeast-1:111122223333:task/flowdesk-test/*"
    error_message = "DescribeTasks はこのクラスターのタスクだけ。"
  }

  assert {
    condition     = aws_iam_role.deploy.max_session_duration == 3600
    error_message = "一時的な認証情報は 1 時間まで。"
  }
}

run "deploy_role_rejects_wildcard_repository" {
  command = plan

  module {
    source = "../../modules/deploy"
  }

  variables {
    name                               = "flowdesk-test"
    github_repository                  = "example-org/*"
    github_environment                 = "*"
    ecr_repository_arns                = ["arn:aws:ecr:ap-northeast-1:111122223333:repository/flowdesk-test/web"]
    cluster_arn                        = "arn:aws:ecs:ap-northeast-1:111122223333:cluster/flowdesk-test"
    service_arns                       = ["arn:aws:ecs:ap-northeast-1:111122223333:service/flowdesk-test/web"]
    migrate_task_definition_family_arn = "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-test-migrate"
    pass_role_arns                     = ["*"]
  }

  expect_failures = [var.github_repository, var.github_environment, var.pass_role_arns]
}

run "deploy_role_can_use_existing_oidc_provider" {
  command = apply

  module {
    source = "../../modules/deploy"
  }

  variables {
    name                               = "flowdesk-test"
    github_repository                  = "example-org/flowdesk"
    oidc_provider_arn                  = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    ecr_repository_arns                = ["arn:aws:ecr:ap-northeast-1:111122223333:repository/flowdesk-test/web"]
    cluster_arn                        = "arn:aws:ecs:ap-northeast-1:111122223333:cluster/flowdesk-test"
    service_arns                       = ["arn:aws:ecs:ap-northeast-1:111122223333:service/flowdesk-test/web"]
    migrate_task_definition_family_arn = "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-test-migrate"
    pass_role_arns                     = ["arn:aws:iam::111122223333:role/flowdesk-test-ecs-execution"]
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "既存の OIDC プロバイダーを渡したら作らない（アカウントに 1 つだけ）。"
  }
}

run "ecs_services_leave_task_definition_to_deploy" {
  command = apply

  module {
    source = "../../modules/ecs"
  }

  variables {
    name                  = "flowdesk-test"
    region                = "ap-northeast-1"
    vpc_id                = "vpc-0123456789abcdef0"
    vpc_cidr_block        = "10.20.0.0/16"
    app_subnet_ids        = ["subnet-app-a", "subnet-app-c"]
    alb_security_group_id = "sg-alb"
    target_group_arn      = "arn:aws:elasticloadbalancing:ap-northeast-1:111122223333:targetgroup/mock/0123456789abcdef"
    s3_bucket_arn         = "arn:aws:s3:::flowdesk-test-uploads"
    queue_arn             = "arn:aws:sqs:ap-northeast-1:111122223333:flowdesk-jobs"
    image_tag             = "git-abc1234"
    environment           = { NODE_ENV = "production" }
    secret_arns = {
      database-url       = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/database-url-AbCdEf"
      better-auth-secret = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/better-auth-secret-AbCdEf"
      stripe             = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/stripe-AbCdEf"
      smtp               = "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/test/smtp-AbCdEf"
    }
  }

  assert {
    condition     = toset(keys(output.task_role_arns)) == toset(["execution", "web", "worker"])
    error_message = "デプロイが PassRole するのは、実行ロールと web・worker のタスクロール。"
  }

  assert {
    condition     = toset(keys(output.task_definition_family_arns)) == toset(["web", "worker", "migrate"])
    error_message = "デプロイはタスク定義の 3 つのファミリーを使う。"
  }
}

run "alarms_notify_by_severity" {
  command = apply

  module {
    source = "../../modules/monitoring"
  }

  variables {
    name                    = "flowdesk-test"
    region                  = "ap-northeast-1"
    critical_alarm_emails   = ["oncall@flowdesk.test"]
    warning_alarm_emails    = ["ops@flowdesk.test", "dev@flowdesk.test"]
    alb_arn_suffix          = "app/mock/0123456789abcdef"
    target_group_arn_suffix = "targetgroup/mock/0123456789abcdef"
    db_instance_identifier  = "flowdesk-test"
    cluster_name            = "flowdesk-test"
    queue_name              = "flowdesk-jobs"
    dlq_name                = "flowdesk-jobs-dlq"
    log_group_names         = { web = "/ecs/flowdesk-test/web", worker = "/ecs/flowdesk-test/worker", migrate = "/ecs/flowdesk-test/migrate" }
  }

  # トピックごとに ARN を変え、どのアラームがどちらに送るかを確かめる
  override_resource {
    target = aws_sns_topic.alarms["critical"]
    values = { arn = "arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-critical" }
  }
  override_resource {
    target = aws_sns_topic.alarms["warning"]
    values = { arn = "arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-warning" }
  }

  assert {
    condition = alltrue([
      for k, a in aws_cloudwatch_metric_alarm.this :
      a.alarm_actions == toset([aws_sns_topic.alarms[output.alarm_severities[k]].arn]) &&
      a.ok_actions == a.alarm_actions &&
      startswith(a.alarm_name, "flowdesk-test-${output.alarm_severities[k]}-")
    ])
    error_message = "アラームは決めた重要度のトピックだけに送り（鳴ったときと戻ったとき）、名前に重要度を入れる。"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.http_5xx_ratio.alarm_actions == toset(["arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-critical"]) &&
      aws_cloudwatch_metric_alarm.this["dlq-not-empty"].alarm_actions == toset(["arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-warning"])
    )
    error_message = "5xx の割合は critical、DLQ は warning に送る。"
  }

  assert {
    condition = (
      toset([for s in aws_sns_topic_subscription.email : "${s.topic_arn} ${s.endpoint}"]) == toset([
        "arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-critical oncall@flowdesk.test",
        "arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-warning ops@flowdesk.test",
        "arn:aws:sns:ap-northeast-1:111122223333:flowdesk-test-alarms-warning dev@flowdesk.test",
      ])
    )
    error_message = "critical は当番に、warning はチームに届く。"
  }

  # 第17章の不具合の修正：AWS 管理のキー（alias/aws/sns）では CloudWatch が発行できない
  assert {
    condition = alltrue([
      for t in aws_sns_topic.alarms : t.kms_master_key_id == aws_kms_key.alarms.arn
    ])
    error_message = "SNS はカスタマー管理のキーで暗号化する（alias/aws/sns では CloudWatch のアラームが届かない）。"
  }

  assert {
    condition = anytrue([
      for st in jsondecode(aws_kms_key.alarms.policy).Statement :
      st.Principal == { Service = "cloudwatch.amazonaws.com" } &&
      toset(st.Action) == toset(["kms:Decrypt", "kms:GenerateDataKey*"]) &&
      st.Condition.StringEquals["aws:SourceAccount"] == "111122223333"
    ]) && aws_kms_key.alarms.enable_key_rotation
    error_message = "キーのポリシーで、この アカウントの CloudWatch にだけ、暗号化に要る操作を許す。鍵はローテーションする。"
  }

  # ---- 閾値（docs/observability.md の 4、第15章の計測） ------------------------
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].extended_statistic == "p95" &&
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].statistic == null &&
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].namespace == "FlowDesk" &&
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].metric_name == "RequestDuration" &&
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].dimensions == tomap({ Service = "flowdesk-web" }) &&
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].threshold == 500 &&
      aws_cloudwatch_metric_alarm.this["app-p95-slo"].period * aws_cloudwatch_metric_alarm.this["app-p95-slo"].evaluation_periods == 900
    )
    error_message = "p95 は本文まで（EMF の RequestDuration）で、N-04 の 500ms を 15 分超えたら warning。ALB の TargetResponseTime（最初のバイトまで）は使わない。"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.this["app-p95-critical"].threshold == 2000 &&
      aws_cloudwatch_metric_alarm.this["app-p95-critical"].extended_statistic == "p95"
    )
    error_message = "p95 が 2 秒（N-04 の 4 倍）を 10 分超えたら critical。"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.http_5xx_ratio.threshold == 5 &&
      aws_cloudwatch_metric_alarm.http_5xx_ratio.evaluation_periods == 3 &&
      aws_cloudwatch_metric_alarm.http_5xx_ratio.datapoints_to_alarm == 2 &&
      one([for q in aws_cloudwatch_metric_alarm.http_5xx_ratio.metric_query : q.expression if q.return_data == true]) ==
      "IF(requests >= 20, 100 * (FILL(target5xx, 0) + FILL(elb5xx, 0)) / requests, 0)" &&
      toset([for q in aws_cloudwatch_metric_alarm.http_5xx_ratio.metric_query : one(q.metric).metric_name if length(q.metric) > 0]) ==
      toset(["RequestCount", "HTTPCode_Target_5XX_Count", "HTTPCode_ELB_5XX_Count"])
    )
    error_message = "5xx は件数ではなく割合（ALB とタスクの合計 ÷ リクエスト数）。5 分に 20 件未満は数えない。"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.this["jobs-queue-stalled"].metric_name == "ApproximateAgeOfOldestMessage" &&
      aws_cloudwatch_metric_alarm.this["jobs-queue-stalled"].dimensions == tomap({ QueueName = "flowdesk-jobs" }) &&
      aws_cloudwatch_metric_alarm.this["jobs-queue-stalled"].threshold == 600
    )
    error_message = "Worker が止まると DLQ には入らず本体のキューに溜まるので、最も古いメッセージの年齢（10 分）で見る。"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.this["dlq-not-empty"].dimensions == tomap({ QueueName = "flowdesk-jobs-dlq" }) &&
      aws_cloudwatch_metric_alarm.this["dlq-not-empty"].threshold == 0
    )
    error_message = "DLQ に 1 件でも入ったら知らせる。"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.this["rds-free-storage"].comparison_operator == "LessThanThreshold"
    error_message = "空き容量は下回ったら鳴らす。"
  }

  assert {
    condition = alltrue([
      for a in concat(values(aws_cloudwatch_metric_alarm.this), [aws_cloudwatch_metric_alarm.http_5xx_ratio]) :
      a.treat_missing_data == "notBreaching"
    ])
    error_message = "データがない（夜間にリクエストがない）ときは正常として扱う。"
  }

  # ---- ECS のタスクの異常停止 --------------------------------------------------
  assert {
    condition = (
      jsondecode(aws_cloudwatch_event_rule.task_stopped.event_pattern).detail.lastStatus == ["STOPPED"] &&
      jsondecode(aws_cloudwatch_event_rule.task_stopped.event_pattern).detail.group == ["service:web", "service:worker"] &&
      jsondecode(aws_cloudwatch_event_rule.task_stopped.event_pattern).detail["$or"][0].stopCode == ["EssentialContainerExited", "TaskFailedToStart"] &&
      jsondecode(aws_cloudwatch_event_rule.task_stopped.event_pattern).detail["$or"][1].stoppedReason == [{ prefix = "Task failed ELB health checks" }]
    )
    error_message = "数えるのは異常終了・起動の失敗・ヘルスチェックの失敗で止まったタスクだけ（デプロイでの入れ替えは数えない）。"
  }

  assert {
    condition = (
      aws_cloudwatch_event_target.task_stopped.arn == aws_cloudwatch_log_group.task_stops.arn &&
      aws_cloudwatch_log_metric_filter.task_stops.metric_transformation[0].dimensions == tomap({ Group = "$.detail.group" }) &&
      aws_cloudwatch_metric_alarm.this["ecs-web-task-stops"].dimensions == tomap({ Group = "service:web" }) &&
      aws_cloudwatch_metric_alarm.this["ecs-web-task-stops"].threshold == 2
    )
    error_message = "止まったタスクを CloudWatch Logs に置いてサービスごとに数え、15 分に 2 回で critical。"
  }

  assert {
    condition = (
      toset(keys(aws_cloudwatch_log_metric_filter.app_errors)) == toset(["web", "worker"]) &&
      alltrue([for f in aws_cloudwatch_log_metric_filter.app_errors : f.pattern == "{ $.level = \"error\" }"])
    )
    error_message = "アプリのエラーは JSON のログの level で数える（migrate は数えない）。"
  }

  # ---- ダッシュボードと Logs Insights -------------------------------------------
  assert {
    condition = (
      length(jsondecode(aws_cloudwatch_dashboard.this.dashboard_body).widgets) == 7 &&
      strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "RequestDuration") &&
      strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "ApproximateAgeOfOldestMessage") &&
      strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "flowdesk-jobs-dlq") &&
      strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "EcsTaskStops")
    )
    error_message = "ダッシュボードに、リクエスト・p95・ECS・異常停止・キュー・RDS・最近のエラーを並べる。"
  }

  assert {
    condition = (
      toset(keys(aws_cloudwatch_query_definition.this)) == toset(["by-trace-id", "errors-by-message", "slow-routes", "failed-jobs"]) &&
      strcontains(aws_cloudwatch_query_definition.this["by-trace-id"].query_string, "filter traceId =")
    )
    error_message = "障害対応で使うクエリ（トレース ID で引く・エラーの集計・遅いルート・失敗したジョブ）を保存する。"
  }
}

run "monitoring_rejects_inverted_p95_thresholds" {
  command = plan

  module {
    source = "../../modules/monitoring"
  }

  variables {
    name                    = "flowdesk-test"
    region                  = "ap-northeast-1"
    alb_arn_suffix          = "app/mock/0123456789abcdef"
    target_group_arn_suffix = "targetgroup/mock/0123456789abcdef"
    db_instance_identifier  = "flowdesk-test"
    cluster_name            = "flowdesk-test"
    queue_name              = "flowdesk-jobs"
    dlq_name                = "flowdesk-jobs-dlq"
    log_group_names         = { web = "/w", worker = "/k" }
    thresholds = {
      http_5xx_percent       = 5
      http_min_requests      = 20
      p95_warning_ms         = 3000
      p95_critical_ms        = 2000
      queue_oldest_age_s     = 600
      app_errors_per_5min    = 10
      task_stops_per_15min   = 2
      db_cpu_percent         = 80
      db_free_storage_bytes  = 2147483648
      db_connections         = 180
      db_freeable_memory_mib = 200
    }
  }

  expect_failures = [var.thresholds]
}

run "rds_rejects_backup_without_pitr" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name                      = "flowdesk-test"
    vpc_id                    = "vpc-0123456789abcdef0"
    subnet_ids                = ["subnet-db-a", "subnet-db-c"]
    client_security_group_ids = { web = "sg-web" }
    password_wo               = "test-only-password"
    password_wo_version       = 1
    backup_retention_days     = 0
  }

  expect_failures = [var.backup_retention_days]
}

run "waf_limits_webhook_body" {
  command = apply

  module {
    source = "../../modules/waf"
  }

  providers = {
    aws = aws.us_east_1
  }

  variables {
    name = "flowdesk-test"
  }

  assert {
    condition     = aws_wafv2_web_acl.this.scope == "CLOUDFRONT"
    error_message = "CloudFront 用（us-east-1）の Web ACL。"
  }

  assert {
    condition = (
      one([for r in aws_wafv2_web_acl.this.rule : r if r.name == "webhook-body-too-large"]).priority == 0 &&
      length(one([for r in aws_wafv2_web_acl.this.rule : r if r.name == "webhook-body-too-large"]).action[0].block) == 1
    )
    error_message = "Webhook の本文の上限のルールは最初に評価し、超えたら止める。"
  }

  assert {
    condition = (
      one(one(one(one([for r in aws_wafv2_web_acl.this.rule : r if r.name == "webhook-body-too-large"]).statement).and_statement).statement[0].byte_match_statement).search_string == "/api/webhooks/" &&
      one(one(one(one([for r in aws_wafv2_web_acl.this.rule : r if r.name == "webhook-body-too-large"]).statement).and_statement).statement[1].size_constraint_statement).size == 65536 &&
      one(one(one(one(one([for r in aws_wafv2_web_acl.this.rule : r if r.name == "webhook-body-too-large"]).statement).and_statement).statement[1].size_constraint_statement).field_to_match).body[0].oversize_handling == "MATCH"
    )
    error_message = "/api/webhooks/ の本文が 64KB を超えたら（WAF が見られる大きさを超えたものも）一致させる。"
  }

  assert {
    condition     = one(one(one(aws_wafv2_web_acl.this.association_config).request_body).cloudfront).default_size_inspection_limit == "KB_64"
    error_message = "本文を 64KB まで見る。"
  }

  assert {
    condition     = length(one([for r in aws_wafv2_web_acl.this.rule : r if r.name == "aws-common"]).override_action[0].count) == 1
    error_message = "共通のルールは、既定では数えるだけ（誤検知を確かめてから止める）。"
  }
}

run "waf_rejects_body_limit_beyond_inspection" {
  command = plan

  module {
    source = "../../modules/waf"
  }

  providers = {
    aws = aws.us_east_1
  }

  variables {
    name                   = "flowdesk-test"
    webhook_max_body_bytes = 100000
  }

  expect_failures = [var.webhook_max_body_bytes]
}
