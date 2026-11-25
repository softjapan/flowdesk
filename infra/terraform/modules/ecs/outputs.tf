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
