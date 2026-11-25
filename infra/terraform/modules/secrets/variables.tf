variable "name_prefix" {
  description = "シークレットの名前の接頭辞（例：flowdesk/prod）"
  type        = string
}

variable "recovery_window_in_days" {
  description = "削除してから完全に消えるまでの日数（誤って消したときに戻せる）"
  type        = number
  default     = 7
}

variable "database_url_wo" {
  description = "DATABASE_URL（書き込み専用。state に残らない）"
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "database_url_wo_version" {
  description = "DATABASE_URL を書き直すときに 1 つ上げる（DB のパスワードの変更と同時に）"
  type        = number
}

variable "better_auth_secret_wo" {
  description = "BETTER_AUTH_SECRET（書き込み専用。state に残らない）"
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "better_auth_secret_wo_version" {
  description = "BETTER_AUTH_SECRET を変えるときに 1 つ上げる（全員のセッションが切れる）"
  type        = number
}
