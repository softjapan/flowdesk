output "arns" {
  description = "シークレットの ARN（database-url・better-auth-secret・stripe・smtp）"
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
