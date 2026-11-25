# ALB（docs/architecture.md の「入口」）。CloudFront からだけ受ける。
# - セキュリティグループ：CloudFront のオリジン向けのマネージドプレフィックス
#   リストからの 443 だけ
# - リスナー：CloudFront が付けるヘッダー（origin_verify）が一致したときだけ
#   Web に転送し、それ以外は 403（他の CloudFront のディストリビューションも
#   同じプレフィックスリストから来るため）
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "this" {
  name        = "${var.name}-alb"
  description = "ALB: HTTPS from CloudFront only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "cloudfront" {
  security_group_id = aws_security_group.this.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS from CloudFront origin-facing"
}

resource "aws_vpc_security_group_egress_rule" "targets" {
  security_group_id = aws_security_group.this.id
  cidr_ipv4         = var.vpc_cidr_block
  ip_protocol       = "tcp"
  from_port         = var.target_port
  to_port           = var.target_port
  description       = "To ECS web tasks"
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.this.id]
  idle_timeout               = 60
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
}

resource "aws_lb_target_group" "web" {
  name                 = "${var.name}-web"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  protocol             = "HTTP"
  port                 = var.target_port
  deregistration_delay = 30

  # DB を使わない画面で確かめる（DB の障害で全タスクを外さない。
  # DB の状態は /api/health をアラームで見る）
  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      status_code  = "403"
      message_body = "Forbidden"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    http_header {
      http_header_name = var.origin_verify_header_name
      values           = [var.origin_verify_header_value]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}
