# AWS WAF（CloudFront 用。第17章、docs/architecture.md の 2）。
# CloudFront に付ける Web ACL は us-east-1 に作る（呼び出し側が
# providers = { aws = aws.us_east_1 } で渡す）。
#
# 1. Webhook の本文の大きさの上限（docs/security.md の 1 の 9）。ALB には
#    本文の大きさの設定がないので、/api/webhooks/ への本文が上限を超えたら止める。
#    WAF が見る本文の大きさの上限（既定 16KB）を 64KB に上げ、それを超える
#    本文は「超えた」として一致させる（oversize_handling = MATCH）
# 2. AWS のマネージドルール：IP の評判・既知の不正な入力は止める。
#    共通のルール（CommonRuleSet）は誤検知がありうるので、既定では数える
#    だけにし（count）、サンプルを見てから止める（common_rules_enforce）
# 3. IP ごとの回数の上限（5 分あたり）
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  visibility = {
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "FlowDesk CloudFront"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # 本文を 64KB まで見る（16KB を超える分は料金が加わる。docs/architecture.md の 7）
  association_config {
    request_body {
      cloudfront {
        default_size_inspection_limit = "KB_64"
      }
    }
  }

  rule {
    name     = "webhook-body-too-large"
    priority = 0

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          byte_match_statement {
            search_string         = "/api/webhooks/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
        statement {
          size_constraint_statement {
            comparison_operator = "GT"
            size                = var.webhook_max_body_bytes
            field_to_match {
              body {
                oversize_handling = "MATCH"
              }
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      metric_name                = "${var.name}-webhook-body-too-large"
      cloudwatch_metrics_enabled = local.visibility.cloudwatch_metrics_enabled
      sampled_requests_enabled   = local.visibility.sampled_requests_enabled
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      metric_name                = "${var.name}-aws-ip-reputation"
      cloudwatch_metrics_enabled = local.visibility.cloudwatch_metrics_enabled
      sampled_requests_enabled   = local.visibility.sampled_requests_enabled
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      metric_name                = "${var.name}-aws-known-bad-inputs"
      cloudwatch_metrics_enabled = local.visibility.cloudwatch_metrics_enabled
      sampled_requests_enabled   = local.visibility.sampled_requests_enabled
    }
  }

  rule {
    name     = "aws-common"
    priority = 3

    override_action {
      dynamic "none" {
        for_each = var.common_rules_enforce ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.common_rules_enforce ? [] : [1]
        content {}
      }
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # 本文 8KB 超を止めるルール。Server Actions・Webhook の正当な本文を
        # 止めうるので数えるだけにする（Webhook の上限は priority 0 のルール）
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      metric_name                = "${var.name}-aws-common"
      cloudwatch_metrics_enabled = local.visibility.cloudwatch_metrics_enabled
      sampled_requests_enabled   = local.visibility.sampled_requests_enabled
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 4

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      metric_name                = "${var.name}-rate-limit-per-ip"
      cloudwatch_metrics_enabled = local.visibility.cloudwatch_metrics_enabled
      sampled_requests_enabled   = local.visibility.sampled_requests_enabled
    }
  }

  visibility_config {
    metric_name                = var.name
    cloudwatch_metrics_enabled = local.visibility.cloudwatch_metrics_enabled
    sampled_requests_enabled   = local.visibility.sampled_requests_enabled
  }
}
