output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "username" {
  value = aws_db_instance.this.username
}

output "identifier" {
  value = aws_db_instance.this.identifier
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "ca_cert_identifier" {
  value = var.ca_cert_identifier
}

output "backup" {
  description = "バックアップの設定（docs/runbooks/restore.md で使う）"
  value = {
    retention_days     = aws_db_instance.this.backup_retention_period
    window             = aws_db_instance.this.backup_window
    maintenance_window = aws_db_instance.this.maintenance_window
    final_snapshot     = aws_db_instance.this.final_snapshot_identifier
  }
}
