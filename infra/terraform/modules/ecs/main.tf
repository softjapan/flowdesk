# ECS Fargate（docs/architecture.md の「アプリケーション」）。
# 1 つの Dockerfile から作る 3 つのイメージを、別々のタスク定義で動かす：
#   web     … Next.js。ALB の後ろで常駐（既定 2 タスク、CPU で 2〜4 に増減）
#   worker  … SQS を受けるジョブの処理。常駐（1 タスク）
#   migrate … prisma migrate deploy。デプロイのたびに 1 回だけ run-task する（第17章）
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  components = toset(["web", "worker", "migrate"])
}

resource "aws_ecr_repository" "this" {
  for_each             = local.components
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "直近 30 個のイメージだけを残す（ロールバック用）"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights
  }
}

resource "aws_cloudwatch_log_group" "this" {
  for_each          = local.components
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

# ---- セキュリティグループ ---------------------------------------------------
# 外向きは必要なポートだけ：443（AWS の API・ECR・Stripe）、5432（RDS、VPC の中）、
# 587（SES の SMTP、Worker だけ）
resource "aws_security_group" "this" {
  for_each    = local.components
  name        = "${var.name}-${each.key}"
  description = "ECS ${each.key} tasks"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.this["web"].id
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.web_port
  to_port                      = var.web_port
  description                  = "From ALB"
}

locals {
  egress_rules = merge(
    { for c in local.components : "${c}-https" => { component = c, cidr = "0.0.0.0/0", port = 443 } },
    { for c in local.components : "${c}-postgres" => { component = c, cidr = var.vpc_cidr_block, port = 5432 } },
    { "worker-smtp" = { component = "worker", cidr = "0.0.0.0/0", port = 587 } },
  )
}

resource "aws_vpc_security_group_egress_rule" "this" {
  for_each          = local.egress_rules
  security_group_id = aws_security_group.this[each.value.component].id
  cidr_ipv4         = each.value.cidr
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  description       = each.key
}
