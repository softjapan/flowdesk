terraform {
  # docs/tech-stack.md の版
  required_version = "~> 1.17.2"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.74.0"
    }
    # パスワード・秘密鍵を作る（ephemeral はプロバイダーの中で作るだけで、AWS には接続しない）
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
  }

  # state は S3 に置く（第17章で state 用のバケットを作ってから設定する）。
  # 値は backend.hcl に書き、terraform init -backend-config=backend.hcl で渡す。
  # 手元の確認は terraform init -backend=false（state を使わない）
  backend "s3" {}
}
