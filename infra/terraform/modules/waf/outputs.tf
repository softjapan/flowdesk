output "web_acl_arn" {
  description = "CloudFront の web_acl_id に渡す（WAF v2 は ARN）"
  value       = aws_wafv2_web_acl.this.arn
}
