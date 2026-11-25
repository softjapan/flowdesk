variable "bucket_name" {
  type = string
}

variable "cors_allowed_origins" {
  description = "署名付き URL で PUT・GET するブラウザのオリジン（アプリの公開 URL）"
  type        = list(string)

  validation {
    condition     = alltrue([for o in var.cors_allowed_origins : startswith(o, "https://")])
    error_message = "CORS のオリジンは https:// にする。"
  }
}

variable "noncurrent_version_expiration_days" {
  description = "上書き・削除された前の版を残す日数"
  type        = number
  default     = 30
}
