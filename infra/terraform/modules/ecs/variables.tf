variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "app_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "image_tag" {
  description = "ECR のイメージのタグ（Git のコミットなど。上書きできないタグにする）"
  type        = string

  validation {
    condition     = var.image_tag != "latest" && length(var.image_tag) > 0
    error_message = "latest は使わない（ECR は IMMUTABLE。どの版が動いているかを追えるタグにする）。"
  }
}

variable "environment" {
  description = "秘密でない環境変数（web・worker で共通）"
  type        = map(string)

  validation {
    condition = length(setintersection(keys(var.environment), [
      "DATABASE_URL", "BETTER_AUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
      "SMTP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    ])) == 0
    error_message = "秘密は environment に入れず、Secrets Manager（secret_arns）から渡す。"
  }
}

variable "secret_arns" {
  description = "Secrets Manager の ARN（database-url・better-auth-secret・stripe・smtp）"
  type        = map(string)

  validation {
    condition     = alltrue([for k in ["database-url", "better-auth-secret", "stripe", "smtp"] : contains(keys(var.secret_arns), k)])
    error_message = "database-url・better-auth-secret・stripe・smtp の 4 つを渡す。"
  }
}

variable "s3_bucket_arn" {
  type = string
}

variable "queue_arn" {
  type = string
}

variable "web_port" {
  type    = number
  default = 3000
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "web_min_count" {
  type    = number
  default = 2
}

variable "web_max_count" {
  type    = number
  default = 4
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "worker_count" {
  type    = number
  default = 1
}

variable "deployment_environment" {
  description = "ログ・トレースに付ける環境の名前（prod など）"
  type        = string
  default     = "prod"
}

variable "metrics_namespace" {
  description = "アプリが EMF で出すメトリクスの名前空間（modules/monitoring と合わせる）"
  type        = string
  default     = "FlowDesk"
}

variable "tracing" {
  description = <<-EOT
    トレース（第18章、docs/observability.md）。enabled なら web・worker のタスクに
    ADOT Collector を足し、X-Ray の OTLP エンドポイントへ送る。
    sampling_ratio は送る割合（ログ・EMF はすべてのリクエストで出る）
  EOT
  type = object({
    enabled         = bool
    sampling_ratio  = number
    collector_image = string
  })
  default = {
    enabled         = true
    sampling_ratio  = 0.1
    collector_image = "public.ecr.aws/aws-observability/aws-otel-collector:v0.51.0"
  }

  validation {
    condition     = var.tracing.sampling_ratio >= 0 && var.tracing.sampling_ratio <= 1
    error_message = "sampling_ratio は 0〜1。"
  }

  validation {
    condition     = !endswith(var.tracing.collector_image, ":latest") && strcontains(var.tracing.collector_image, ":")
    error_message = "Collector のイメージは版を固定する（latest を使わない）。"
  }
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "container_insights" {
  description = "Container Insights（enabled・enhanced・disabled）。料金は docs/architecture.md の要確認"
  type        = string
  default     = "disabled"
}
