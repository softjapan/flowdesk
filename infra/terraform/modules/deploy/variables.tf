variable "name" {
  type = string
}

variable "github_repository" {
  description = "デプロイを許すリポジトリ（owner/repo）。ワイルドカードは使わない"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository は owner/repo の形にする（* などは使わない）。"
  }
}

variable "github_environment" {
  description = "デプロイのジョブの environment（GitHub で main だけがデプロイできるように設定する）"
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+$", var.github_environment))
    error_message = "github_environment に * などは使わない。"
  }
}

variable "oidc_provider_arn" {
  description = "GitHub の OIDC プロバイダーが既にあれば、その ARN（null なら作る）"
  type        = string
  default     = null
}

variable "ecr_repository_arns" {
  type = list(string)
}

variable "cluster_arn" {
  type = string
}

variable "service_arns" {
  type = list(string)
}

variable "migrate_task_definition_family_arn" {
  description = "migrate のタスク定義の ARN（リビジョンなし）"
  type        = string
}

variable "pass_role_arns" {
  description = "タスク定義が使うロール（実行ロールとタスクロール）"
  type        = list(string)

  validation {
    condition     = length(var.pass_role_arns) > 0 && !contains(var.pass_role_arns, "*")
    error_message = "PassRole はタスク定義のロールだけに許す。"
  }
}
