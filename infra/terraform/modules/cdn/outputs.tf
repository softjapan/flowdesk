output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "domain_name" {
  description = "DNS でアプリのドメインを向ける先（CNAME・エイリアス）"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "hosted_zone_id" {
  value = aws_cloudfront_distribution.this.hosted_zone_id
}
