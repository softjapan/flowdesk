# RDS for PostgreSQL（docs/architecture.md の「データベース」）。
# - db サブネット（外への経路なし）に置き、公開しない
# - 接続を受けるのは client_security_group_ids（ECS のタスク）からの 5432 だけ
# - パスワードは書き込み専用の属性（password_wo）で渡し、state に残さない
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "this" {
  name        = "${var.name}-db"
  description = "RDS for PostgreSQL: 5432 from ECS tasks only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "clients" {
  for_each                     = var.client_security_group_ids
  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from ${each.key}"
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg${var.engine_major_version}"
  family = "postgres${var.engine_major_version}"

  # TLS 以外の接続を拒否する
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # 遅いクエリ（500ms 以上、N-04 の基準）を CloudWatch Logs に出す
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_major_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name             = var.db_name
  username            = var.username
  password_wo         = var.password_wo
  password_wo_version = var.password_wo_version

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  backup_retention_period   = var.backup_retention_days
  backup_window             = "18:00-18:30" # JST 03:00-03:30
  maintenance_window        = "sun:19:00-sun:19:30"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = false
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}
