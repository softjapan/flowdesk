output "topic_arns" {
  description = "critical・warning の SNS トピック"
  value       = { for k, t in aws_sns_topic.alarms : k => t.arn }
}

output "alarm_names" {
  value = merge(
    { for k, a in aws_cloudwatch_metric_alarm.this : k => a.alarm_name },
    { alb-5xx-ratio = aws_cloudwatch_metric_alarm.http_5xx_ratio.alarm_name },
  )
}

output "alarm_severities" {
  description = "アラームごとの通知先（docs/observability.md の表と合わせる）"
  value = merge(
    { for k, a in local.alarms : k => a.severity },
    { alb-5xx-ratio = "critical" },
  )
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.this.dashboard_name
}
