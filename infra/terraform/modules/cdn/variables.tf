variable "name" {
  type = string
}

variable "domain_name" {
  description = "アプリのドメイン（例：app.flowdesk.example）"
  type        = string
}

variable "certificate_arn" {
  description = "CloudFront の証明書（ACM、us-east-1 で発行したもの）"
  type        = string

  validation {
    condition     = startswith(var.certificate_arn, "arn:aws:acm:us-east-1:")
    error_message = "CloudFront の証明書は us-east-1 の ACM で発行する。"
  }
}

variable "alb_dns_name" {
  type = string
}

variable "origin_verify_header_name" {
  type    = string
  default = "X-Origin-Verify"
}

variable "origin_verify_header_value" {
  type      = string
  sensitive = true
}

variable "price_class" {
  description = "PriceClass_200 は日本を含み、南米・オーストラリアなどを除く"
  type        = string
  default     = "PriceClass_200"
}

variable "web_acl_id" {
  description = "AWS WAF の Web ACL（第17章。null なら付けない）"
  type        = string
  default     = null
}
