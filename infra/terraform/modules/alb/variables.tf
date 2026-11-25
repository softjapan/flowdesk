variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "certificate_arn" {
  description = "ALB の証明書（ACM、ap-northeast-1）。アプリのドメインを含むもの（CloudFront が Host を転送するため）"
  type        = string
}

variable "target_port" {
  type    = number
  default = 3000
}

variable "health_check_path" {
  type    = string
  default = "/login"
}

variable "origin_verify_header_name" {
  type    = string
  default = "X-Origin-Verify"
}

variable "origin_verify_header_value" {
  description = "CloudFront だけが知る値"
  type        = string
  sensitive   = true
}

variable "deletion_protection" {
  type    = bool
  default = true
}
