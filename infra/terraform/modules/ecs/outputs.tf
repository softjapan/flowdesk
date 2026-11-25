output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "security_group_ids" {
  value = { for k, sg in aws_security_group.this : k => sg.id }
}

output "migrate_task_definition_arn" {
  description = "デプロイのたびに run-task する（第17章）"
  value       = aws_ecs_task_definition.this["migrate"].arn
}

output "container_definitions" {
  description = "タスク定義のコンテナ定義（web・worker・migrate）。秘密は ARN だけで、値は含まない"
  value       = local.container_definitions
}

output "log_group_names" {
  value = { for k, g in aws_cloudwatch_log_group.this : k => g.name }
}

# ---- デプロイ（modules/deploy の IAM ロールと、GitHub Actions の変数）が使う ----
output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_arns" {
  value = { web = aws_ecs_service.web.id, worker = aws_ecs_service.worker.id }
}

output "task_definition_family_arns" {
  description = "リビジョンを除いたタスク定義の ARN（web・worker・migrate）"
  value       = { for k, td in aws_ecs_task_definition.this : k => td.arn_without_revision }
}

output "ecr_repository_arns" {
  value = { for k, r in aws_ecr_repository.this : k => r.arn }
}

output "task_role_arns" {
  description = "タスク定義が使うロール（デプロイが PassRole するもの）"
  value = merge(
    { execution = aws_iam_role.execution.arn },
    { for k, r in aws_iam_role.task : k => r.arn },
  )
}
