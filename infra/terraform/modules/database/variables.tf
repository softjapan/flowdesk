variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "db サブネット（インターネットへの経路を持たないもの）"
  type        = list(string)
}

variable "client_security_group_ids" {
  description = "5432 への接続を許すセキュリティグループ（名前 → ID）"
  type        = map(string)
}

variable "engine_major_version" {
  description = "PostgreSQL のメジャーバージョン。マイナーは RDS の既定（docs/architecture.md の要確認）"
  type        = string
  default     = "18"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "max_allocated_storage" {
  description = "ストレージの自動拡張の上限（GB）"
  type        = number
  default     = 100
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  description = "自動バックアップの保持日数（PITR で戻せる期間）。RDS の上限は 35"
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "バックアップは 7〜35 日保持する（0 にすると PITR ができない）。"
  }
}

variable "backup_window" {
  description = "自動バックアップの時間帯（UTC）。既定は JST 03:00-03:30"
  type        = string
  default     = "18:00-18:30"
}

variable "maintenance_window" {
  description = "メンテナンスの時間帯（UTC）。バックアップの時間帯と重ねない"
  type        = string
  default     = "sun:19:00-sun:19:30"
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "db_name" {
  type    = string
  default = "flowdesk"
}

variable "username" {
  type    = string
  default = "flowdesk"
}

variable "password_wo" {
  description = "マスターユーザーのパスワード（書き込み専用。state に残らない）"
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "password_wo_version" {
  description = "パスワードを変えるときに 1 つ上げる"
  type        = number
}

variable "ca_cert_identifier" {
  description = "RDS のサーバー証明書の CA。イメージに同じ CA（docker/rds-ca/<これ>.crt）を入れ、DATABASE_URL の verify-full で検証する"
  type        = string
  default     = "rds-ca-rsa2048-g1"
}
