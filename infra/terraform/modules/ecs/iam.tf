# IAM。
# - 実行ロール（ECS エージェントが使う）：イメージの取得、ログの送信、
#   このアプリのシークレットの読み取りだけ
# - タスクロール（アプリが使う）：web・worker ごとに、使う S3 の操作と SQS の操作だけ。
#   アプリは AWS の鍵を環境変数で持たない（src/server/aws.ts が既定の探し方で
#   タスクロールを使う）
locals {
  ecs_tasks_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  objects_arn = "${var.s3_bucket_arn}/orgs/*"

  task_policies = {
    web = [
      # 署名付き URL（PUT・GET）は、署名したロールの権限で実行される
      { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject"], Resource = local.objects_arn },
      { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = var.queue_arn },
    ]
    worker = [
      { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject"], Resource = local.objects_arn },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = var.queue_arn
      },
    ]
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = local.ecs_tasks_assume_role
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = sort(values(var.secret_arns))
    }]
  })
}

resource "aws_iam_role" "task" {
  for_each           = local.task_policies
  name               = "${var.name}-${each.key}-task"
  assume_role_policy = local.ecs_tasks_assume_role
}

# トレースを X-Ray に送る（ADOT Collector がタスクロールで SigV4 の署名をする）。
# xray:PutTraceSegments はリソースを指定できない操作なので Resource = "*"
resource "aws_iam_role_policy" "task_xray" {
  for_each = var.tracing.enabled ? local.task_policies : {}
  name     = "xray"
  role     = aws_iam_role.task[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "XRay"
      Effect   = "Allow"
      Action   = ["xray:PutTraceSegments"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy" "task" {
  for_each = local.task_policies
  name     = "app"
  role     = aws_iam_role.task[each.key].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = each.value
  })
}
