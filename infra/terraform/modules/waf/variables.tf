variable "name" {
  type = string
}

variable "webhook_max_body_bytes" {
  description = "/api/webhooks/ の本文の上限（バイト）。WAF が見る大きさの上限（64KB）以下にする"
  type        = number
  default     = 65536

  validation {
    condition     = var.webhook_max_body_bytes > 0 && var.webhook_max_body_bytes <= 65536
    error_message = "webhook_max_body_bytes は 1〜65536（WAF が見る本文の上限 64KB）にする。"
  }
}

variable "common_rules_enforce" {
  description = "AWSManagedRulesCommonRuleSet で止める（false なら数えるだけ）"
  type        = bool
  default     = false
}

variable "rate_limit_per_5min" {
  description = "IP ごとの 5 分あたりのリクエストの上限"
  type        = number
  default     = 2000
}
