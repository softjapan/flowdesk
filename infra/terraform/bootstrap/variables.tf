variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "bucket_name" {
  description = "state 用のバケット（世界で一意。例：flowdesk-tfstate-<アカウント ID>）"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "バケット名は小文字・数字・ハイフンで 3〜63 文字。"
  }
}

variable "state_admin_principal_arns" {
  description = "state を読み書きできる IAM のロール・ユーザー（terraform を実行する管理者）"
  type        = list(string)

  validation {
    condition = length(var.state_admin_principal_arns) > 0 && alltrue([
      for a in var.state_admin_principal_arns : startswith(a, "arn:aws:iam::") && !strcontains(a, "*")
    ])
    error_message = "IAM の ARN を 1 つ以上、* を使わずに渡す。"
  }
}
