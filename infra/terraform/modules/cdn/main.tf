# CloudFront（docs/architecture.md の「入口」）。
#
# - 画面と API（既定の振る舞い）はキャッシュしない。Cookie・クエリ・ヘッダーを
#   すべて ALB に渡す。Next.js の RSC のリクエストは rsc などのヘッダーと
#   _rsc のクエリで応答が変わるので、落とすと画面遷移が壊れる
#   （node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md）
# - Host ヘッダーも渡す。Server Actions は Origin とホスト（x-forwarded-host か
#   host）を比べ、違えば実行しない（docs/tech-stack.md の 36）。CloudFront は
#   x-forwarded-host を付けないので、Host を ALB の名前に書き換えると、
#   すべての Server Action が「Invalid Server Actions request」になる。
#   そのため ALB の証明書はアプリのドメインを含める
# - /_next/static/* は内容のハッシュを名前に持つので、エッジでキャッシュする
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  origin_id = "alb"
  # AWS のマネージドポリシー（ID は AWS 全体で共通）
  # （docs/architecture.md の「要確認」に挙げた。適用前に名前と ID を照合する）
  cache_policy_caching_disabled    = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cache_policy_caching_optimized   = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  origin_request_policy_all_viewer = "216adef6-5c7f-47e4-b989-5492eafa07d3"
}

# 静的ファイル用：Host だけを渡す（Cookie・クエリは渡さない）
resource "aws_cloudfront_origin_request_policy" "host_only" {
  name    = "${var.name}-host-only"
  comment = "Forward only Host (ALB certificate matches the app domain)"

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["host"]
    }
  }
  cookies_config {
    cookie_behavior = "none"
  }
  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  comment         = var.name
  aliases         = [var.domain_name]
  price_class     = var.price_class
  http_version    = "http2and3"
  is_ipv6_enabled = true
  web_acl_id      = var.web_acl_id

  origin {
    origin_id   = local.origin_id
    domain_name = var.alb_dns_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = var.origin_verify_header_name
      value = var.origin_verify_header_value
    }
  }

  default_cache_behavior {
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_policy_caching_disabled
    origin_request_policy_id = local.origin_request_policy_all_viewer
  }

  ordered_cache_behavior {
    path_pattern             = "/_next/static/*"
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_policy_caching_optimized
    origin_request_policy_id = aws_cloudfront_origin_request_policy.host_only.id
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
