variable "name" {
  description = "キューの名前（DLQ は <name>-dlq）"
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "可視性タイムアウト。docker/elasticmq.conf の defaultVisibilityTimeout と合わせる"
  type        = number
  default     = 60
}

variable "max_receive_count" {
  description = "この回数だけ受信して消されなければ DLQ へ移す"
  type        = number
  default     = 3
}

variable "alarm_actions" {
  description = "アラームの通知先（SNS トピックの ARN）"
  type        = list(string)
  default     = []
}
