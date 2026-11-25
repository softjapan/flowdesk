# 監視（第17章で作り、第18章で見直した。docs/observability.md の 4）。
#
# 誰に知らせるか：
#   critical … 利用者がいま困っている・放っておくと止まる。すぐに対応する（夜間も）
#   warning  … 遅い・失敗が溜まっている。次の営業日に原因を調べる
# 閾値の根拠（第15章の計測）は docs/observability.md の表。
#
# 第17章からの修正：SNS を AWS 管理のキー（alias/aws/sns）で暗号化していたが、
# このキーのポリシーは CloudWatch に使わせられないので、アラームの通知が届かない
# （AWS の re:Post の説明。本物の AWS では確かめていない）。
# カスタマー管理のキーにし、cloudwatch.amazonaws.com に使わせる。
#
# /api/health の外形監視（Route 53 のヘルスチェック・Synthetics）は引き続き
# 含めない（docs/architecture.md の 9）
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  severities = toset(["critical", "warning"])
  emails = {
    critical = var.critical_alarm_emails
    warning  = var.warning_alarm_emails
  }
  account_id = data.aws_caller_identity.current.account_id
}

# ---- 通知先 -----------------------------------------------------------------
resource "aws_kms_key" "alarms" {
  description         = "${var.name} alarm topics (SNS)"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        # アラームが暗号化されたトピックに発行できるように
        Sid       = "CloudWatchAlarms"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = ["kms:Decrypt", "kms:GenerateDataKey*"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
      },
    ]
  })
}

resource "aws_kms_alias" "alarms" {
  name          = "alias/${var.name}-alarms"
  target_key_id = aws_kms_key.alarms.key_id
}

resource "aws_sns_topic" "alarms" {
  for_each          = local.severities
  name              = "${var.name}-alarms-${each.key}"
  kms_master_key_id = aws_kms_key.alarms.arn
}

# メールの購読は、受け取る人が確認のリンクを押すまで有効にならない
resource "aws_sns_topic_subscription" "email" {
  for_each = merge([
    for sev in local.severities : {
      for e in local.emails[sev] : "${sev}:${e}" => { severity = sev, email = e }
    }
  ]...)
  topic_arn = aws_sns_topic.alarms[each.value.severity].arn
  protocol  = "email"
  endpoint  = each.value.email
}

# ---- ECS のタスクの停止（再起動）を数える ---------------------------------------
# ECS は止まったタスクを入れ替える（再起動）。アプリの異常終了・起動の失敗・
# ALB のヘルスチェックの失敗で止まったものだけを EventBridge で拾い、
# CloudWatch Logs に置いてメトリクスフィルターで数える。デプロイ・台数の変更
# （ServiceSchedulerInitiated で理由がヘルスチェック以外）は数えない
resource "aws_cloudwatch_log_group" "task_stops" {
  name              = "/aws/events/${var.name}/ecs-task-stopped"
  retention_in_days = 30
}

resource "aws_cloudwatch_event_rule" "task_stopped" {
  name        = "${var.name}-ecs-task-stopped"
  description = "web・worker のタスクが異常で止まった"
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [{ suffix = ":cluster/${var.cluster_name}" }]
      lastStatus = ["STOPPED"]
      group      = ["service:web", "service:worker"]
      "$or" = [
        { stopCode = ["EssentialContainerExited", "TaskFailedToStart"] },
        { stoppedReason = [{ prefix = "Task failed ELB health checks" }] },
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "task_stopped" {
  rule = aws_cloudwatch_event_rule.task_stopped.name
  arn  = aws_cloudwatch_log_group.task_stops.arn
}

# EventBridge がこのロググループに書けるように
resource "aws_cloudwatch_log_resource_policy" "events" {
  policy_name = "${var.name}-events-to-logs"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource  = "${aws_cloudwatch_log_group.task_stops.arn}:*"
    }]
  })
}

resource "aws_cloudwatch_log_metric_filter" "task_stops" {
  name           = "${var.name}-ecs-task-stops"
  log_group_name = aws_cloudwatch_log_group.task_stops.name
  pattern        = "{ $.detail.lastStatus = \"STOPPED\" }"
  metric_transformation {
    name       = "EcsTaskStops"
    namespace  = var.metrics_namespace
    value      = "1"
    unit       = "Count"
    dimensions = { Group = "$.detail.group" }
  }
}

# ---- アプリのエラーのログを数える ---------------------------------------------
# 1 行の JSON のログ（src/server/logger.ts）の level で数える。次元を付けると
# default_value（0 を入れる）を使えないので、web・worker の合計の 1 つの
# メトリクスにする（どちらのエラーかは Logs Insights の errors-by-message で見る）
resource "aws_cloudwatch_log_metric_filter" "app_errors" {
  for_each       = { for k in ["web", "worker"] : k => var.log_group_names[k] }
  name           = "${var.name}-${each.key}-errors"
  log_group_name = each.value
  pattern        = "{ $.level = \"error\" }"
  metric_transformation {
    name          = "AppErrors"
    namespace     = var.metrics_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# ---- アラーム ---------------------------------------------------------------
locals {
  t   = var.thresholds
  alb = { LoadBalancer = var.alb_arn_suffix }
  db  = { DBInstanceIdentifier = var.db_instance_identifier }

  alarms = {
    # -- critical：利用者がいま困っている ------------------------------------
    alb-unhealthy-targets = {
      severity    = "critical"
      description = "ヘルスチェック（/login）に失敗している web のタスクがある（3 分続いた）"
      namespace   = "AWS/ApplicationELB"
      metric      = "UnHealthyHostCount"
      dimensions  = merge(local.alb, { TargetGroup = var.target_group_arn_suffix })
      statistic   = "Maximum"
      period      = 60
      periods     = 3
      datapoints  = 3
      threshold   = 0
      comparison  = "GreaterThanThreshold"
    }
    app-p95-critical = {
      severity    = "critical"
      description = "画面の p95 が ${local.t.p95_critical_ms}ms を超えた（10 分続いた）。N-04 の 4 倍"
      namespace   = var.metrics_namespace
      metric      = "RequestDuration"
      dimensions  = { Service = "flowdesk-web" }
      statistic   = "p95"
      period      = 300
      periods     = 2
      datapoints  = 2
      threshold   = local.t.p95_critical_ms
      comparison  = "GreaterThanThreshold"
    }
    jobs-queue-stalled = {
      severity    = "critical"
      description = "ジョブのキューの最も古いメッセージが ${local.t.queue_oldest_age_s} 秒を超えた。Worker が止まっている・追いついていない"
      namespace   = "AWS/SQS"
      metric      = "ApproximateAgeOfOldestMessage"
      dimensions  = { QueueName = var.queue_name }
      statistic   = "Maximum"
      period      = 300
      periods     = 2
      datapoints  = 2
      threshold   = local.t.queue_oldest_age_s
      comparison  = "GreaterThanThreshold"
    }
    ecs-web-task-stops = {
      severity    = "critical"
      description = "web のタスクが 15 分に ${local.t.task_stops_per_15min} 回以上、異常で止まった（入れ替えを繰り返している）"
      namespace   = var.metrics_namespace
      metric      = "EcsTaskStops"
      dimensions  = { Group = "service:web" }
      statistic   = "Sum"
      period      = 900
      periods     = 1
      datapoints  = 1
      threshold   = local.t.task_stops_per_15min
      comparison  = "GreaterThanOrEqualToThreshold"
    }
    ecs-worker-task-stops = {
      severity    = "critical"
      description = "worker のタスクが 15 分に ${local.t.task_stops_per_15min} 回以上、異常で止まった"
      namespace   = var.metrics_namespace
      metric      = "EcsTaskStops"
      dimensions  = { Group = "service:worker" }
      statistic   = "Sum"
      period      = 900
      periods     = 1
      datapoints  = 1
      threshold   = local.t.task_stops_per_15min
      comparison  = "GreaterThanOrEqualToThreshold"
    }
    rds-free-storage = {
      severity    = "critical"
      description = "RDS の空き容量が少ない（自動拡張の上限に近い。埋まると書き込めなくなる）"
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      dimensions  = local.db
      statistic   = "Minimum"
      period      = 300
      periods     = 1
      datapoints  = 1
      threshold   = local.t.db_free_storage_bytes
      comparison  = "LessThanThreshold"
    }

    # -- warning：次の営業日に調べる --------------------------------------------
    app-p95-slo = {
      severity    = "warning"
      description = "画面の p95 が ${local.t.p95_warning_ms}ms（N-04）を超えた（15 分続いた）"
      namespace   = var.metrics_namespace
      metric      = "RequestDuration"
      dimensions  = { Service = "flowdesk-web" }
      statistic   = "p95"
      period      = 300
      periods     = 3
      datapoints  = 3
      threshold   = local.t.p95_warning_ms
      comparison  = "GreaterThanThreshold"
    }
    dlq-not-empty = {
      severity    = "warning"
      description = "ジョブが 3 回失敗して DLQ に入った。原因を直してから再投入する（docs/runbooks/incident-ai.md）"
      namespace   = "AWS/SQS"
      metric      = "ApproximateNumberOfMessagesVisible"
      dimensions  = { QueueName = var.dlq_name }
      statistic   = "Maximum"
      period      = 300
      periods     = 1
      datapoints  = 1
      threshold   = 0
      comparison  = "GreaterThanThreshold"
    }
    app-errors = {
      severity    = "warning"
      description = "アプリ（web・worker）のエラーのログが 5 分に ${local.t.app_errors_per_5min} 件を超えた（2 回続いた）"
      namespace   = var.metrics_namespace
      metric      = "AppErrors"
      dimensions  = {}
      statistic   = "Sum"
      period      = 300
      periods     = 2
      datapoints  = 2
      threshold   = local.t.app_errors_per_5min
      comparison  = "GreaterThanThreshold"
    }
    rds-cpu = {
      severity    = "warning"
      description = "RDS の CPU が ${local.t.db_cpu_percent}% を超えている（15 分続いた）"
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      dimensions  = local.db
      statistic   = "Average"
      period      = 300
      periods     = 3
      datapoints  = 3
      threshold   = local.t.db_cpu_percent
      comparison  = "GreaterThanThreshold"
    }
    rds-connections = {
      severity    = "warning"
      description = "RDS の接続数が多い（タスクの数 × プールの大きさを見直す）"
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      dimensions  = local.db
      statistic   = "Maximum"
      period      = 300
      periods     = 2
      datapoints  = 2
      threshold   = local.t.db_connections
      comparison  = "GreaterThanThreshold"
    }
    rds-freeable-memory = {
      severity    = "warning"
      description = "RDS の空きメモリが ${local.t.db_freeable_memory_mib}MiB を下回った（15 分続いた）"
      namespace   = "AWS/RDS"
      metric      = "FreeableMemory"
      dimensions  = local.db
      statistic   = "Minimum"
      period      = 300
      periods     = 3
      datapoints  = 3
      threshold   = local.t.db_freeable_memory_mib * 1048576
      comparison  = "LessThanThreshold"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.value.severity}-${each.key}"
  alarm_description   = "[${each.value.severity}] ${each.value.description}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = length(each.value.dimensions) > 0 ? each.value.dimensions : null
  statistic           = startswith(each.value.statistic, "p") ? null : each.value.statistic
  extended_statistic  = startswith(each.value.statistic, "p") ? each.value.statistic : null
  period              = each.value.period
  evaluation_periods  = each.value.periods
  datapoints_to_alarm = each.value.datapoints
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  # データがない（リクエスト・ジョブがない）ときは正常として扱う
  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alarms[each.value.severity].arn]
  ok_actions         = [aws_sns_topic.alarms[each.value.severity].arn]
}

# 5xx の割合（ALB が返したものと、タスクが返したものの合計 ÷ リクエスト数）。
# リクエストが少ない時間帯（夜間）の 1〜2 件で鳴らないよう、5 分で
# http_min_requests 件に満たないときは 0 として扱う
resource "aws_cloudwatch_metric_alarm" "http_5xx_ratio" {
  alarm_name          = "${var.name}-critical-alb-5xx-ratio"
  alarm_description   = "[critical] 5xx の割合が ${local.t.http_5xx_percent}% を超えた（15 分のうち 10 分）"
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.t.http_5xx_percent
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms["critical"].arn]
  ok_actions          = [aws_sns_topic.alarms["critical"].arn]

  metric_query {
    id          = "ratio"
    label       = "5xx の割合（%）"
    expression  = "IF(requests >= ${local.t.http_min_requests}, 100 * (FILL(target5xx, 0) + FILL(elb5xx, 0)) / requests, 0)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = {
      requests  = "RequestCount"
      target5xx = "HTTPCode_Target_5XX_Count"
      elb5xx    = "HTTPCode_ELB_5XX_Count"
    }
    content {
      id = metric_query.key
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = metric_query.value
        dimensions  = local.alb
        stat        = "Sum"
        period      = 300
      }
    }
  }
}

# ---- 障害対応で使う Logs Insights のクエリ（docs/runbooks/incident-ai.md） ---
resource "aws_cloudwatch_query_definition" "this" {
  for_each = {
    "by-trace-id" = {
      groups = values(var.log_group_names)
      query  = <<-EOT
        fields @timestamp, service, level, msg, jobId, route, status, durationMs, err.name, err.message
        | filter traceId = "REPLACE_WITH_TRACE_ID"
        | sort @timestamp asc
      EOT
    }
    "errors-by-message" = {
      groups = values(var.log_group_names)
      query  = <<-EOT
        filter level = "error"
        | stats count(*) as n, earliest(@timestamp) as first, latest(@timestamp) as last by service, msg, err.name, err.code
        | sort n desc
      EOT
    }
    "slow-routes" = {
      groups = [var.log_group_names["web"]]
      query  = <<-EOT
        filter msg = "request"
        | stats count(*) as n, pct(durationMs, 95) as p95, sum(status >= 500) as n5xx by route
        | sort p95 desc
      EOT
    }
    "failed-jobs" = {
      groups = [var.log_group_names["worker"]]
      query  = <<-EOT
        filter msg = "ジョブが失敗"
        | stats count(*) as n, max(attempts) as maxAttempts, latest(err.message) as lastError by jobType, err.code
        | sort n desc
      EOT
    }
  }
  name            = "${var.name}/${each.key}"
  log_group_names = each.value.groups
  query_string    = each.value.query
}

# ---- ダッシュボード -----------------------------------------------------------
locals {
  widgets = [
    {
      title   = "リクエスト数と 5xx（ALB、5 分）"
      metrics = [for m in ["RequestCount", "HTTPCode_Target_5XX_Count", "HTTPCode_ELB_5XX_Count"] : ["AWS/ApplicationELB", m, "LoadBalancer", var.alb_arn_suffix, { stat = "Sum" }]]
    },
    {
      title = "画面の時間（本文まで、EMF）と ALB の TTFB"
      metrics = [
        [var.metrics_namespace, "RequestDuration", "Service", "flowdesk-web", { stat = "p95", label = "p95（本文まで）" }],
        [var.metrics_namespace, "RequestDuration", "Service", "flowdesk-web", { stat = "p50", label = "p50（本文まで）" }],
        ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p95", label = "ALB p95（最初のバイトまで、秒）", yAxis = "right" }],
      ]
      annotations = { horizontal = [{ label = "N-04", value = local.t.p95_warning_ms }] }
    },
    {
      title = "ECS の CPU・メモリ（%）"
      metrics = flatten([for svc in ["web", "worker"] : [
        ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", svc, { stat = "Average" }],
        ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", svc, { stat = "Average" }],
      ]])
    },
    {
      title = "タスクの異常停止とアプリのエラー"
      metrics = [
        [var.metrics_namespace, "EcsTaskStops", "Group", "service:web", { stat = "Sum" }],
        [var.metrics_namespace, "EcsTaskStops", "Group", "service:worker", { stat = "Sum" }],
        [var.metrics_namespace, "AppErrors", { stat = "Sum" }],
      ]
    },
    {
      title = "ジョブのキュー"
      metrics = [
        ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name, { stat = "Maximum" }],
        ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.queue_name, { stat = "Maximum", yAxis = "right" }],
        ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_name, { stat = "Maximum", label = "DLQ" }],
      ]
    },
    {
      title = "RDS"
      metrics = [
        ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifier, { stat = "Average" }],
        ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.db_instance_identifier, { stat = "Maximum", yAxis = "right" }],
      ]
    },
  ]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = jsonencode({
    widgets = concat(
      [for i, w in local.widgets : {
        type   = "metric"
        x      = (i % 2) * 12
        y      = floor(i / 2) * 6
        width  = 12
        height = 6
        properties = merge({
          title   = w.title
          region  = var.region
          view    = "timeSeries"
          period  = 300
          metrics = w.metrics
        }, try({ annotations = w.annotations }, {}))
      }],
      [{
        type   = "log"
        x      = 0
        y      = ceil(length(local.widgets) / 2) * 6
        width  = 24
        height = 6
        properties = {
          title  = "最近のエラー（web・worker）"
          region = var.region
          view   = "table"
          query  = "SOURCE '${var.log_group_names["web"]}' | SOURCE '${var.log_group_names["worker"]}' | fields @timestamp, service, msg, err.name, err.message, traceId, jobId | filter level = \"error\" | sort @timestamp desc | limit 50"
        }
      }],
    )
  })
}
