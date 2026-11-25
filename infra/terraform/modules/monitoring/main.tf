# 監視（第17章、docs/architecture.md の 2）。アラームの通知先（SNS）と、
# ALB・RDS のアラーム。DLQ のアラーム（modules/queue）もこの通知先に送る。
# /api/health の外形監視（Route 53 のヘルスチェック・Synthetics）は費用と
# 方式が未定のため含めない（docs/architecture.md の 9）
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_sns_topic" "alarms" {
  name              = "${var.name}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

# メールの購読は、受け取る人が確認のリンクを押すまで有効にならない
resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alarm_emails)
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  actions = [aws_sns_topic.alarms.arn]

  alarms = {
    alb-target-5xx = {
      description = "web が 5xx を返している（5 分で ${var.http_5xx_threshold} 回を超えた）"
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
      statistic   = "Sum"
      period      = 300
      periods     = 1
      threshold   = var.http_5xx_threshold
      comparison  = "GreaterThanThreshold"
    }
    alb-elb-5xx = {
      description = "ALB が 5xx を返している（タスクに届いていない。502・503・504）"
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_ELB_5XX_Count"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
      statistic   = "Sum"
      period      = 300
      periods     = 1
      threshold   = var.http_5xx_threshold
      comparison  = "GreaterThanThreshold"
    }
    alb-unhealthy-targets = {
      description = "ヘルスチェック（/login）に失敗している web のタスクがある（3 分続いた）"
      namespace   = "AWS/ApplicationELB"
      metric      = "UnHealthyHostCount"
      dimensions  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffix }
      statistic   = "Maximum"
      period      = 60
      periods     = 3
      threshold   = 0
      comparison  = "GreaterThanThreshold"
    }
    rds-cpu = {
      description = "RDS の CPU が 80% を超えている（15 分続いた）"
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      dimensions  = { DBInstanceIdentifier = var.db_instance_identifier }
      statistic   = "Average"
      period      = 300
      periods     = 3
      threshold   = 80
      comparison  = "GreaterThanThreshold"
    }
    rds-free-storage = {
      description = "RDS の空き容量が少ない（自動拡張の上限に近づいていないか確かめる）"
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      dimensions  = { DBInstanceIdentifier = var.db_instance_identifier }
      statistic   = "Minimum"
      period      = 300
      periods     = 1
      threshold   = var.db_free_storage_bytes
      comparison  = "LessThanThreshold"
    }
    rds-connections = {
      description = "RDS の接続数が多い（タスクの数 × プールの大きさを見直す）"
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      dimensions  = { DBInstanceIdentifier = var.db_instance_identifier }
      statistic   = "Maximum"
      period      = 300
      periods     = 2
      threshold   = var.db_connections_threshold
      comparison  = "GreaterThanThreshold"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  period              = each.value.period
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  # データがない（リクエストがない）ときは正常として扱う
  treat_missing_data = "notBreaching"
  alarm_actions      = local.actions
  ok_actions         = local.actions
}
