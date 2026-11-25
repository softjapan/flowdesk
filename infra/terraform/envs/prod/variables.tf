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

variable "db_ca_cert_identifier" {
  description = "RDS のサーバー証明書の CA。docker/rds-ca/<これ>.crt がイメージに入っている必要がある"
  type        = string
  default     = "rds-ca-rsa2048-g1"

  validation {
    condition     = fileexists("${path.root}/../../../../docker/rds-ca/${var.db_ca_cert_identifier}.crt")
    error_message = "docker/rds-ca/<db_ca_cert_identifier>.crt がない。イメージに入れていない CA では接続できない（docker/rds-ca/README.md）。"
  }
}

variable "enable_waf" {
  description = "CloudFront に AWS WAF を付ける（月 10.60 USD ほど。docs/architecture.md の 7）"
  type        = bool
  default     = true
}

variable "waf_common_rules_enforce" {
  description = "AWSManagedRulesCommonRuleSet で止める（既定は数えるだけ。サンプルを見てから true にする）"
  type        = bool
  default     = false
}

variable "critical_alarm_emails" {
  description = "critical のアラーム（すぐに対応する）を受け取るアドレス（当番の携帯に転送するもの）"
  type        = list(string)
  default     = []
}

variable "warning_alarm_emails" {
  description = "warning のアラーム（次の営業日に対応する）を受け取るアドレス"
  type        = list(string)
  default     = []
}

variable "tracing_enabled" {
  description = "web・worker のトレースを X-Ray に送る（ADOT Collector のサイドカー。docs/observability.md の 3）"
  type        = bool
  default     = true
}

variable "trace_sampling_ratio" {
  description = "トレースを送る割合（0〜1）。ログと EMF のメトリクスはすべてのリクエストで出る"
  type        = number
  default     = 0.1
}

variable "github_repository" {
  description = "デプロイを許す GitHub のリポジトリ（owner/repo）"
  type        = string
}

variable "github_environment" {
  description = "デプロイのジョブの environment（.github/workflows/deploy.yml）"
  type        = string
  default     = "production"
}

variable "github_oidc_provider_arn" {
  description = "GitHub の OIDC プロバイダーがアカウントに既にあれば、その ARN（null なら作る）"
  type        = string
  default     = null
}
