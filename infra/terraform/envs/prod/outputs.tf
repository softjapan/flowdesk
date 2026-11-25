output "app_url" {
  value = local.app_url
}

output "cloudfront_domain_name" {
  description = "domain_name の DNS をここに向ける（Route 53 は第17章）"
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
