# state 用のバケットの設定を、AWS に接続せずに確かめる（第17章）。
#   cd infra/terraform/bootstrap && terraform init && terraform test

mock_provider "aws" {
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::flowdesk-tfstate-111122223333" }
  }
}

variables {
  bucket_name                = "flowdesk-tfstate-111122223333"
  state_admin_principal_arns = ["arn:aws:iam::111122223333:role/flowdesk-terraform-admin"]
}

run "state_bucket_is_private_and_versioned" {
  command = apply

  assert {
    condition     = one(aws_s3_bucket_versioning.state.versioning_configuration).status == "Enabled"
    error_message = "state はバージョニングする（壊しても前の版に戻せる）。"
  }

  assert {
    condition = (
      one(one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    )
    error_message = "state を暗号化する。"
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.state.block_public_acls &&
      aws_s3_bucket_public_access_block.state.block_public_policy &&
      aws_s3_bucket_public_access_block.state.ignore_public_acls &&
      aws_s3_bucket_public_access_block.state.restrict_public_buckets
    )
    error_message = "パブリックアクセスのブロックを 4 つとも有効にする。"
  }

  assert {
    condition     = one(aws_s3_bucket_ownership_controls.state.rule).object_ownership == "BucketOwnerEnforced"
    error_message = "ACL を無効にする。"
  }

  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Effect == "Deny" &&
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "TLS 以外の接続を拒否する。"
  }

  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[1].Effect == "Deny" &&
      contains(jsondecode(aws_s3_bucket_policy.state.policy).Statement[1].Action, "s3:GetObject") &&
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[1].Condition.ArnNotLike["aws:PrincipalArn"] == ["arn:aws:iam::111122223333:role/flowdesk-terraform-admin"]
    )
    error_message = "管理者のロール以外は state を読めない（X-Origin-Verify の値が入る）。"
  }

  assert {
    condition     = !contains(jsondecode(aws_s3_bucket_policy.state.policy).Statement[1].Action, "s3:PutBucketPolicy")
    error_message = "バケットのポリシーの操作は止めない（一覧を間違えても直せる）。"
  }
}

run "rejects_wildcard_admin" {
  command = plan

  variables {
    state_admin_principal_arns = ["arn:aws:iam::111122223333:role/*"]
  }

  expect_failures = [var.state_admin_principal_arns]
}
