output "dns_name" {
  value = aws_lb.this.dns_name
}

output "arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.web.arn_suffix
}
