# タスク定義。
# - 環境変数（environment）には秘密でない値だけを入れる。秘密は secrets で
#   Secrets Manager の ARN を指定し、ECS が起動時に読んで渡す
# - コンテナは非 root（UID 1000、Dockerfile の node ユーザー）。ルートは
#   読み取り専用にし、書き込む場所（/tmp、Next.js のキャッシュ）だけボリュームにする
# - Graviton（ARM64）。イメージは linux/arm64 でビルドする
locals {
  # JSON のシークレットは <ARN>:<キー>:: で 1 つの値を取り出す
  secret_refs = {
    DATABASE_URL          = var.secret_arns["database-url"]
    BETTER_AUTH_SECRET    = var.secret_arns["better-auth-secret"]
    STRIPE_SECRET_KEY     = "${var.secret_arns["stripe"]}:STRIPE_SECRET_KEY::"
    STRIPE_WEBHOOK_SECRET = "${var.secret_arns["stripe"]}:STRIPE_WEBHOOK_SECRET::"
    STRIPE_PRICE_PRO      = "${var.secret_arns["stripe"]}:STRIPE_PRICE_PRO::"
    SMTP_USER             = "${var.secret_arns["smtp"]}:SMTP_USER::"
    SMTP_PASSWORD         = "${var.secret_arns["smtp"]}:SMTP_PASSWORD::"
  }

  tasks = {
    web = {
      cpu    = var.web_cpu
      memory = var.web_memory
      environment = merge(var.environment, {
        HOSTNAME = "0.0.0.0"
        PORT     = tostring(var.web_port)
      })
      secrets      = ["DATABASE_URL", "BETTER_AUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO"]
      volumes      = { tmp = "/tmp", next-cache = "/app/.next/cache" }
      port         = var.web_port
      stop_timeout = 30
      health_check = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:${var.web_port}/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
    worker = {
      cpu         = var.worker_cpu
      memory      = var.worker_memory
      environment = var.environment
      secrets     = ["DATABASE_URL", "SMTP_USER", "SMTP_PASSWORD"]
      volumes     = { tmp = "/tmp" }
      port        = null
      # SIGTERM の後、処理中のメッセージを終えるまで待つ（Fargate の上限は 120 秒）
      stop_timeout = 120
      health_check = null
    }
    migrate = {
      cpu          = 256
      memory       = 512
      environment  = { NODE_ENV = "production" }
      secrets      = ["DATABASE_URL"]
      volumes      = { tmp = "/tmp", npm-home = "/home/node" }
      port         = null
      stop_timeout = 30
      health_check = null
    }
  }

  container_definitions = {
    for name, t in local.tasks : name => [merge(
      {
        name      = name
        image     = "${aws_ecr_repository.this[name].repository_url}:${var.image_tag}"
        essential = true
        user      = "1000:1000"

        readonlyRootFilesystem = true
        privileged             = false
        linuxParameters = {
          initProcessEnabled = true
          capabilities       = { drop = ["ALL"] }
        }

        environment = [for k in sort(keys(t.environment)) : { name = k, value = t.environment[k] }]
        secrets     = [for k in sort(t.secrets) : { name = k, valueFrom = local.secret_refs[k] }]

        mountPoints = [for v, path in t.volumes : { sourceVolume = v, containerPath = path, readOnly = false }]
        stopTimeout = t.stop_timeout

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.this[name].name
            awslogs-region        = var.region
            awslogs-stream-prefix = name
          }
        }
      },
      t.port == null ? {} : {
        portMappings = [{ containerPort = t.port, protocol = "tcp" }]
      },
      t.health_check == null ? {} : {
        healthCheck = t.health_check
      },
    )]
  }
}

resource "aws_ecs_task_definition" "this" {
  for_each                 = local.tasks
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = contains(keys(aws_iam_role.task), each.key) ? aws_iam_role.task[each.key].arn : null

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  dynamic "volume" {
    for_each = each.value.volumes
    content {
      name = volume.key
    }
  }

  container_definitions = jsonencode(local.container_definitions[each.key])
}
