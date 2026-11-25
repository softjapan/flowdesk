# state 用の S3 バケット（第17章、docs/ci-cd.md の「初回の手順」）。
# envs/prod の state（backend "s3"）を置く。このバケット自身の state は
# 手元（terraform.tfstate、.gitignore 済み）に置く。中身はバケットの設定だけで
# 秘密を含まず、失っても terraform import で戻せる。
#
#   cd infra/terraform/bootstrap
#   terraform init && terraform apply -var-file=bootstrap.tfvars   # 管理者の端末から 1 回だけ
#
# - バージョニング（state を壊しても前の版に戻せる。前の版は 90 日で消す）
# - SSE-S3 の暗号化、TLS 以外の拒否、パブリックアクセスのブロック 4 つ、ACL 無効
# - state を読み書きできるのは state_admin_principal_arns だけ（state には
#   X-Origin-Verify の値が入る）。ロックのファイル（.tflock）も同じ
# - 消せないようにする（prevent_destroy）
terraform {
  required_version = "~> 1.17.2"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.74.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "flowdesk"
      ManagedBy = "terraform"
      Purpose   = "terraform-state"
    }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = var.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        # 管理者のロール以外は、同じアカウントの IAM の権限があっても state を
        # 読み書きできない。バケットの設定（ポリシー）の操作は止めないので、
        # 一覧を間違えても管理者（root を含む）が直せる
        Sid       = "DenyStateAccessExceptAdmins"
        Effect    = "Deny"
        Principal = "*"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:ListBucket",
          "s3:ListBucketVersions",
        ]
        Resource = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = {
          ArnNotLike = { "aws:PrincipalArn" = sort(var.state_admin_principal_arns) }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.state]
}
