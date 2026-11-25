# VPC（docs/architecture.md の「ネットワーク」）。
# - public：ALB と NAT Gateway。インターネットゲートウェイへの経路を持つ
# - app：ECS のタスク。外向き（Stripe・SES・AWS の API）は NAT Gateway 経由
# - db：RDS。インターネットへの経路を持たない（NAT にも出ない）
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

# 既定のセキュリティグループは何も通さない（使い忘れの穴にしない）
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-default-deny" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.azs[count.index]
  cidr_block              = var.public_subnet_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-public-${var.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "app" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = var.app_subnet_cidrs[count.index]
  tags              = { Name = "${var.name}-app-${var.azs[count.index]}", Tier = "app" }
}

resource "aws_subnet" "db" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = var.db_subnet_cidrs[count.index]
  tags              = { Name = "${var.name}-db-${var.azs[count.index]}", Tier = "db" }
}

# ---- public ----------------------------------------------------------------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---- app（NAT 経由で外へ） -------------------------------------------------
# 既定は 1 つ（費用を抑える。その AZ が落ちると外向きの通信が止まる）。
# single_nat_gateway = false で AZ ごとに置く
locals {
  nat_count = var.single_nat_gateway ? 1 : length(var.azs)
}

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"
  tags   = { Name = "${var.name}-nat-${count.index}" }
}

resource "aws_nat_gateway" "this" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${var.name}-${var.azs[count.index]}" }
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "app" {
  count  = length(var.azs)
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-app-${var.azs[count.index]}" }
}

resource "aws_route" "app_nat" {
  count                  = length(var.azs)
  route_table_id         = aws_route_table.app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[var.single_nat_gateway ? 0 : count.index].id
}

resource "aws_route_table_association" "app" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app[count.index].id
}

# ---- db（外への経路なし） --------------------------------------------------
resource "aws_route_table" "db" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-db" }
}

resource "aws_route_table_association" "db" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.db[count.index].id
  route_table_id = aws_route_table.db.id
}

# S3 はゲートウェイ型のエンドポイント（無料）で NAT を通さない
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.app[*].id
  tags              = { Name = "${var.name}-s3" }
}
