# SQS（ジョブのキュー、第11章）。docker/elasticmq.conf と同じ名前・設定にする。
# - 3 回受信して消されなかったメッセージは DLQ へ移る（maxReceiveCount = 3。
#   Worker は 3 回目の失敗でメッセージを消さずに置く、docs/tech-stack.md の 26）
# - DLQ にメッセージが入ったらアラームを鳴らす
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-dlq"
  message_retention_seconds = 1209600 # 14 日（上限）。調べてから再投入する
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "this" {
  name                       = var.name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600 # 4 日
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# DLQ に送れるのはこのキューだけ
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this.arn]
  })
}

resource "aws_sqs_queue_policy" "this" {
  for_each  = { jobs = aws_sqs_queue.this, dlq = aws_sqs_queue.dlq }
  queue_url = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "sqs:*"
      Resource  = each.value.arn
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.name}-dlq-not-empty"
  alarm_description   = "ジョブが 3 回失敗して DLQ に入った。原因を直してから再投入する"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
}
