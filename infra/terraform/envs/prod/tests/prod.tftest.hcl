# 本番の設定の主要な値を、AWS に接続せずに確かめる（第16章）。
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
}

variables {
  domain_name                = "app.flowdesk.test"
  alb_certificate_arn        = "arn:aws:acm:ap-northeast-1:111122223333:certificate/alb"
  cloudfront_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/cloudfront"
  bucket_suffix              = "111122223333"
  image_tag                  = "git-abc1234"
  mail_from                  = "FlowDesk <no-reply@flowdesk.test>"
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
      for name, defs in module.ecs.container_definitions : [for c in defs : c.user == "1000:1000"]
    ]))
    error_message = "どのコンテナも非 root（UID 1000、Dockerfile の node ユーザー）で動かす。"
  }

  assert {
    condition     = module.network.nat_gateway_count == 1
    error_message = "既定では NAT Gateway は 1 つ（費用を抑える）。"
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
    condition     = aws_cloudwatch_metric_alarm.dlq_not_empty.dimensions["QueueName"] == "flowdesk-jobs-dlq"
    error_message = "DLQ にメッセージが入ったらアラームを鳴らす。"
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
      for td in aws_ecs_task_definition.this : [for c in jsondecode(td.container_definitions) : c.user == "1000:1000"]
    ]))
    error_message = "タスク定義のどのコンテナも非 root（UID 1000）で動かす。"
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
      one(aws_cloudfront_distribution.this.default_cache_behavior).cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" &&
      one(aws_cloudfront_distribution.this.default_cache_behavior).origin_request_policy_id == "216adef6-5c7f-47e4-b989-5492eafa07d3"
    )
    error_message = "画面と API はキャッシュせず（CachingDisabled）、Host・Cookie・RSC のヘッダーを渡す（AllViewer）。"
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
