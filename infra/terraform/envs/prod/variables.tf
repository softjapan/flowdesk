variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "azs" {
  type    = list(string)
  default = ["ap-northeast-1a", "ap-northeast-1c"]
}

variable "domain_name" {
  description = "アプリのドメイン（スキームなし。例：app.flowdesk.example）。BETTER_AUTH_URL は https://<これ>"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.domain_name))
    error_message = "domain_name はスキーム・パス・ポートを付けないホスト名にする（例：app.flowdesk.example）。"
  }
}

variable "alb_certificate_arn" {
  description = "ALB の証明書（ACM、ap-northeast-1）。domain_name を含むもの"
  type        = string

  validation {
    condition     = startswith(var.alb_certificate_arn, "arn:aws:acm:ap-northeast-1:")
    error_message = "ALB の証明書は ap-northeast-1 の ACM で発行する。"
  }
}

variable "cloudfront_certificate_arn" {
  description = "CloudFront の証明書（ACM、us-east-1）。domain_name を含むもの"
  type        = string

  validation {
    condition     = startswith(var.cloudfront_certificate_arn, "arn:aws:acm:us-east-1:")
    error_message = "CloudFront の証明書は us-east-1 の ACM で発行する。"
  }
}

variable "bucket_suffix" {
  description = "S3 のバケット名を世界で一意にする接尾辞（AWS のアカウント ID など）"
  type        = string
}

variable "image_tag" {
  description = "デプロイするイメージのタグ（web・worker・migrate で共通）"
  type        = string
}

variable "mail_from" {
  description = "送信元（SES で検証したドメインのアドレス）"
  type        = string
}

variable "single_nat_gateway" {
  type    = bool
  default = true
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_password_version" {
  description = "DB のパスワードを変えるときに 1 つ上げる（RDS と DATABASE_URL を同時に書き換える）"
  type        = number
  default     = 1
}

variable "better_auth_secret_version" {
  description = "BETTER_AUTH_SECRET を変えるときに 1 つ上げる"
  type        = number
  default     = 1
}

variable "alarm_topic_arns" {
  description = "アラームの通知先（SNS。第17章で作る）"
  type        = list(string)
  default     = []
}
