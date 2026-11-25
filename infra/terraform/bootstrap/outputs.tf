output "state_bucket" {
  description = "envs/prod/backend.hcl の bucket に書く"
  value       = aws_s3_bucket.state.bucket
}
