# ECS のサービス（web・worker）。migrate はサービスにせず、デプロイのたびに
# run-task する（第17章の CI/CD）。
#
# デプロイ（.github/workflows/deploy.yml → scripts/deploy/ecs-deploy.mts）は、
# Terraform が作ったタスク定義の最新の版をもとに、イメージのタグだけを
# 差し替えた版を登録し、サービスをそれに切り替える。Terraform がサービスを
# 自分の版（var.image_tag）に戻さないよう、task_definition の差分は見ない。
# Terraform で環境変数などを変えたときは、デプロイを実行して反映する
# （docs/ci-cd.md）
resource "aws_ecs_service" "web" {
  name                              = "web"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.this["web"].arn
  launch_type                       = "FARGATE"
  desired_count                     = var.web_min_count
  health_check_grace_period_seconds = 60
  enable_execute_command            = false
  propagate_tags                    = "SERVICE"

  # 新しいタスクが健康になってから古いタスクを止める。失敗したら前の版に戻す
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_subnet_ids
    security_groups  = [aws_security_group.this["web"].id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "web"
    container_port   = var.web_port
  }

  lifecycle {
    # 台数はオートスケーリングが、版はデプロイが決める
    ignore_changes = [desired_count, task_definition]
  }
}

resource "aws_appautoscaling_target" "web" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.web.name}"
  min_capacity       = var.web_min_count
  max_capacity       = var.web_max_count
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${var.name}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  resource_id        = aws_appautoscaling_target.web.resource_id

  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_ecs_service" "worker" {
  name                   = "worker"
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.this["worker"].arn
  launch_type            = "FARGATE"
  desired_count          = var.worker_count
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  # 入れ替えの間は 2 台が同時に受信してよい（ジョブは冪等、第11章）
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_subnet_ids
    security_groups  = [aws_security_group.this["worker"].id]
    assign_public_ip = false
  }

  lifecycle {
    # 版はデプロイが決める（上の web と同じ）
    ignore_changes = [task_definition]
  }
}
