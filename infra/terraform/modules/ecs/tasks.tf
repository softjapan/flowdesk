# タスク定義。
# - 環境変数（environment）には秘密でない値だけを入れる。秘密は secrets で
#   Secrets Manager の ARN を指定し、ECS が起動時に読んで渡す
# - コンテナは非 root（UID 1000、Dockerfile の node ユーザー）。ルートは
#   読み取り専用にし、書き込む場所（/tmp、Next.js のキャッシュ）だけボリュームにする
# - Graviton（ARM64）。イメージは linux/arm64 でビルドする
# - 第18章：ログは 1 行の JSON（src/server/logger.ts）。awslogs は non-blocking
#   にし、CloudWatch Logs が遅れてもアプリを止めない（バッファーがあふれた分は
#   捨てる）。トレースは web・worker のタスクの中の ADOT Collector（サイドカー）に
#   OTLP で送り、Collector が X-Ray の OTLP エンドポイントへ SigV4 で送る
locals {
  # web・worker の共通の追加の環境変数（第18章）
  telemetry_env = merge(
    {
      APP_VERSION            = var.image_tag
      DEPLOYMENT_ENVIRONMENT = var.deployment_environment
      LOG_FORMAT             = "json"
    },
    var.tracing.enabled ? {
      OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
      OTEL_TRACES_SAMPLER_ARG     = tostring(var.tracing.sampling_ratio)
    } : {},
  )

  # ADOT Collector の設定（AOT_CONFIG_CONTENT で YAML を渡す）。
  # 受けるのはタスクの中（127.0.0.1）だけ。X-Ray の OTLP エンドポイントは
  # Transaction Search を有効にしてから使う（docs/observability.md の 3。本物の AWS では未確認）
  collector_config = yamlencode({
    extensions = {
      sigv4auth = { region = var.region, service = "xray" }
    }
    receivers = {
      otlp = { protocols = { http = { endpoint = "127.0.0.1:4318" } } }
    }
    processors = {
      batch = { timeout = "5s" }
      # 2 GB のタスクでも Collector が使いすぎない上限
      memory_limiter = { check_interval = "1s", limit_mib = 100 }
    }
    exporters = {
      otlphttp = {
        traces_endpoint = "https://xray.${var.region}.amazonaws.com/v1/traces"
        auth            = { authenticator = "sigv4auth" }
      }
    }
    service = {
      extensions = ["sigv4auth"]
      pipelines = {
        traces = {
          receivers  = ["otlp"]
          processors = ["memory_limiter", "batch"]
          exporters  = ["otlphttp"]
        }
      }
    }
  })

  collector_container = {
    name      = "otel-collector"
    image     = var.tracing.collector_image
    essential = false
    user      = "10001:10001"

    readonlyRootFilesystem = true
    privileged             = false
    linuxParameters        = { capabilities = { drop = ["ALL"] } }
    environment            = [{ name = "AOT_CONFIG_CONTENT", value = local.collector_config }]
    secrets                = []
    mountPoints            = []
    memoryReservation      = 64
  }

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
      environment = merge(var.environment, local.telemetry_env, {
        HOSTNAME          = "0.0.0.0"
        PORT              = tostring(var.web_port)
        OTEL_SERVICE_NAME = "flowdesk-web"
        # アクセスログの行を EMF にし、RequestDuration・Request5xx のメトリクスにする
        LOG_EMF_NAMESPACE = var.metrics_namespace
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
      cpu    = var.worker_cpu
      memory = var.worker_memory
      environment = merge(var.environment, local.telemetry_env, {
        OTEL_SERVICE_NAME = "flowdesk-worker"
      })
      secrets = ["DATABASE_URL", "SMTP_USER", "SMTP_PASSWORD"]
      volumes = { tmp = "/tmp" }
      port    = null
      # SIGTERM の後、処理中のメッセージを終えるまで待つ（Fargate の上限は 120 秒）
      stop_timeout = 120
      health_check = null
    }
    migrate = {
      cpu          = 256
      memory       = 512
      environment  = { NODE_ENV = "production", APP_VERSION = var.image_tag }
      secrets      = ["DATABASE_URL"]
      volumes      = { tmp = "/tmp", npm-home = "/home/node" }
      port         = null
      stop_timeout = 30
      health_check = null
    }
  }

  # トレースを送るタスク（migrate は短命なので送らない）
  traced_tasks = var.tracing.enabled ? toset(["web", "worker"]) : toset([])

  container_definitions = {
    for name, t in local.tasks : name => concat([merge(
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
            # CloudWatch Logs が遅れても stdout の書き込みで止まらない（第18章）
            mode            = "non-blocking"
            max-buffer-size = "25m"
          }
        }
      },
      t.port == null ? {} : {
        portMappings = [{ containerPort = t.port, protocol = "tcp" }]
      },
      t.health_check == null ? {} : {
        healthCheck = t.health_check
      },
      ), ], contains(local.traced_tasks, name) ? [merge(local.collector_container, {
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.this[name].name
            awslogs-region        = var.region
            awslogs-stream-prefix = "${name}-otel"
            mode                  = "non-blocking"
            max-buffer-size       = "4m"
          }
        }
    })] : [])
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
