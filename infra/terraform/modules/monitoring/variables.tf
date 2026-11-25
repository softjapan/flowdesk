variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "critical_alarm_emails" {
  description = "critical（すぐに対応する。夜間・休日も）を受け取るアドレス。購読の確認が要る"
  type        = list(string)
  default     = []
}

variable "warning_alarm_emails" {
  description = "warning（次の営業日に対応する）を受け取るアドレス"
  type        = list(string)
  default     = []
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}

variable "db_instance_identifier" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "queue_name" {
  description = "ジョブのキュー（滞留を見る）"
  type        = string
}

variable "dlq_name" {
  type = string
}

variable "log_group_names" {
  description = "アプリのロググループ（web・worker）。エラーの数とダッシュボードに使う"
  type        = map(string)

  validation {
    condition     = alltrue([for k in ["web", "worker"] : contains(keys(var.log_group_names), k)])
    error_message = "web と worker のロググループを渡す。"
  }
}

variable "metrics_namespace" {
  description = "アプリが EMF で出すメトリクスの名前空間（modules/ecs と合わせる）"
  type        = string
  default     = "FlowDesk"
}

# 閾値。根拠は docs/observability.md の 4（第15章の計測）
variable "thresholds" {
  type = object({
    http_5xx_percent       = number
    http_min_requests      = number
    p95_warning_ms         = number
    p95_critical_ms        = number
    queue_oldest_age_s     = number
    app_errors_per_5min    = number
    task_stops_per_15min   = number
    db_cpu_percent         = number
    db_free_storage_bytes  = number
    db_connections         = number
    db_freeable_memory_mib = number
  })
  default = {
    http_5xx_percent       = 5
    http_min_requests      = 20
    p95_warning_ms         = 500
    p95_critical_ms        = 2000
    queue_oldest_age_s     = 600
    app_errors_per_5min    = 10
    task_stops_per_15min   = 2
    db_cpu_percent         = 80
    db_free_storage_bytes  = 2147483648
    db_connections         = 180
    db_freeable_memory_mib = 200
  }

  validation {
    condition     = var.thresholds.p95_warning_ms < var.thresholds.p95_critical_ms
    error_message = "p95 は warning の閾値を critical より小さくする。"
  }
}
