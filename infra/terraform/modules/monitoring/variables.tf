variable "name" {
  type = string
}

variable "alarm_emails" {
  description = "アラームを受け取るメールアドレス（購読の確認が要る）"
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

variable "http_5xx_threshold" {
  description = "5 分あたりの 5xx の回数の上限"
  type        = number
  default     = 10
}

variable "db_free_storage_bytes" {
  description = "RDS の空き容量の下限（既定 2GiB）"
  type        = number
  default     = 2147483648
}

variable "db_connections_threshold" {
  description = "RDS の接続数の上限の目安（db.t4g.small の max_connections は約 225）"
  type        = number
  default     = 180
}
