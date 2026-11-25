# GitHub Actions からのデプロイ（第17章、docs/ci-cd.md）。
# - 長期のアクセスキーを作らない。GitHub の OIDC のトークンで IAM ロールを
#   引き受ける（AssumeRoleWithWebIdentity。1 時間で切れる一時的な認証情報）
# - 信頼ポリシーは、このリポジトリの、この environment のジョブだけに絞る。
#   environment の「デプロイできるブランチ」を main だけにするのは GitHub の
#   設定（docs/ci-cd.md の手順）。sub は完全一致（StringEquals）で、* を使わない
# - 権限はデプロイの手順（scripts/deploy/ecs-deploy.mts）が使うものだけ
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  oidc_host = "token.actions.githubusercontent.com"
  # environment を指定したジョブのトークンの sub は
  # repo:<owner>/<repo>:environment:<environment> になる（ブランチは入らない）
  subject = "repo:${var.github_repository}:environment:${var.github_environment}"

  oidc_provider_arn = var.oidc_provider_arn != null ? var.oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn

  # DescribeTasks の対象：arn:aws:ecs:<region>:<account>:task/<cluster>/*
  task_arn_pattern = "${replace(var.cluster_arn, ":cluster/", ":task/")}/*"
}

# アカウントに 1 つだけ作れる。別の用途で作ってあれば oidc_provider_arn で渡す
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.oidc_provider_arn == null ? 1 : 0
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-github-deploy"
  description          = "GitHub Actions (${local.subject}) deploys ECS"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_host}:aud" = "sts.amazonaws.com"
          "${local.oidc_host}:sub" = local.subject
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ECR へのログイン。この操作はリソースを指定できない
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Resource = sort(var.ecr_repository_arns)
      },
      {
        # タスク定義の読み取りと登録。この 2 つの操作はリソースを指定できない。
        # 登録した版を動かすには下の RunTask・UpdateService と PassRole が要る
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
        Resource = "*"
      },
      {
        Sid      = "RunMigrate"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "${var.migrate_task_definition_family_arn}:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = var.cluster_arn }
        }
      },
      {
        Sid      = "WatchMigrate"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks"]
        Resource = local.task_arn_pattern
      },
      {
        Sid      = "UpdateServices"
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:UpdateService"]
        Resource = sort(var.service_arns)
      },
      {
        # タスク定義に書いたロールを ECS に渡す（ECS のタスクにだけ）
        Sid      = "PassTaskRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = sort(var.pass_role_arns)
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}
