variable "name" {
  description = "リソースの名前の接頭辞"
  type        = string
}

variable "region" {
  description = "リージョン（S3 のエンドポイントの名前に使う）"
  type        = string
}

variable "cidr_block" {
  description = "VPC の CIDR"
  type        = string
  default     = "10.20.0.0/16"
}

variable "azs" {
  description = "使う AZ。ALB と RDS の Multi-AZ のため 2 つ以上"
  type        = list(string)

  validation {
    condition     = length(var.azs) >= 2
    error_message = "AZ は 2 つ以上にする（ALB と RDS の Multi-AZ の要件）。"
  }
}

variable "public_subnet_cidrs" {
  type = list(string)
}

variable "app_subnet_cidrs" {
  type = list(string)
}

variable "db_subnet_cidrs" {
  type = list(string)
}

variable "single_nat_gateway" {
  description = "NAT Gateway を 1 つにする（false なら AZ ごと）"
  type        = bool
  default     = true
}
