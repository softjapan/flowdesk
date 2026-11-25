output "role_arn" {
  description = "GitHub の environment の変数 AWS_DEPLOY_ROLE_ARN に入れる（秘密ではない）"
  value       = aws_iam_role.deploy.arn
}

output "subject" {
  description = "信頼ポリシーが許す OIDC のトークンの sub"
  value       = local.subject
}
