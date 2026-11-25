output "app_url" {
  value = local.app_url
}

output "cloudfront_domain_name" {
  description = "domain_name の DNS をここに向ける（CNAME・エイリアス。docs/ci-cd.md の手順）"
  value       = module.cdn.domain_name
}

output "alb_dns_name" {
  value = module.alb.dns_name
}

output "ecr_repository_urls" {
  value = module.ecs.ecr_repository_urls
}

output "migrate_task_definition_arn" {
  value = module.ecs.migrate_task_definition_arn
}

output "secrets_to_fill" {
  description = "初回のデプロイの前に、人が値を入れるシークレット（docs/architecture.md の手順）"
  value = {
    stripe = module.secrets.arns["stripe"]
    smtp   = module.secrets.arns["smtp"]
  }
}

output "queue_url" {
  value = module.queue.queue_url
}

output "dlq_url" {
  value = module.queue.dlq_url
}

output "db_address" {
  value = module.database.address
}

output "database_tls_query" {
  description = "DATABASE_URL の TLS の指定（値はシークレットにだけ入る。これは秘密ではない部分）"
  value       = local.database_tls_query
}

output "alarm_topic_arns" {
  description = "critical・warning の SNS トピック（チャットなどの通知先を足すときに購読する）"
  value       = module.monitoring.topic_arns
}

output "dashboard_name" {
  value = module.monitoring.dashboard_name
}

output "web_acl_arn" {
  value = var.enable_waf ? module.waf[0].web_acl_arn : null
}

# GitHub の environment（production）の変数に入れる値（秘密ではない）。
# .github/workflows/deploy.yml が vars.* で読む（docs/ci-cd.md）
output "github_deploy_variables" {
  value = {
    AWS_REGION              = var.region
    AWS_DEPLOY_ROLE_ARN     = module.deploy.role_arn
    ECS_CLUSTER             = module.ecs.cluster_name
    NAME_PREFIX             = local.name
    ECR_REPOSITORY_PREFIX   = local.name
    MIGRATE_SUBNETS         = join(",", module.network.app_subnet_ids)
    MIGRATE_SECURITY_GROUPS = module.ecs.security_group_ids["migrate"]
  }
}

output "github_deploy_subject" {
  description = "デプロイのロールを引き受けられる OIDC のトークンの sub"
  value       = module.deploy.subject
}
