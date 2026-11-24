/**
 * 組織とメンバーの取得。組織そのものはスラッグで引く（URL の [org]）が、
 * それ以外はすべて organizationId を条件に含める。
 */
import { randomUUID } from "node:crypto";
import { toRole } from "@/server/access-control";
import { type Db, getPrisma } from "@/server/db";
import type { Role } from "@/server/domain";

export async function findOrganizationBySlug(
  slug: string,
  db: Db = getPrisma(),
) {
  return db.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
}

/** ロールが FlowDesk のものでないメンバーは、メンバーでないものとして扱う */
export async function findMember(
  organizationId: string,
  userId: string,
  db: Db = getPrisma(),
) {
  const member = await db.member.findFirst({
    where: { organizationId, userId },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      role: true,
    },
  });
  if (!member) return null;
  const role = toRole(member.role);
  return role ? { ...member, role } : null;
}

/**
 * ユーザーが所属する組織（ログイン後の行き先・組織の選択で使う）。
 * 「自分の所属」を引くので organizationId ではなく userId で絞り込む。
 * ロールが FlowDesk のものでない所属は含めない。
 */
export async function listOrganizationsForUser(
  userId: string,
  db: Db = getPrisma(),
) {
  const members = await db.member.findMany({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return members.flatMap((m) => {
    const role = toRole(m.role);
    return role ? [{ ...m.organization, role }] : [];
  });
}

/**
 * 組織の行をトランザクションの終わりまでロックする。メンバーの
 * ロール変更・削除・追加をこの組織の中で 1 つずつ実行し、
 * 「最後の Owner」の確認と更新の間に他の変更が割り込まないようにする
 * （2 人の Owner が同時にお互いを降格して Owner がいなくなる、など）。
 * 組織がなければ false
 */
export async function lockOrganization(
  organizationId: string,
  db: Db,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "organization" WHERE id = ${organizationId} FOR UPDATE`;
  return rows.length > 0;
}

export async function isSlugTaken(
  slug: string,
  db: Db = getPrisma(),
): Promise<boolean> {
  return (await db.organization.count({ where: { slug } })) > 0;
}

/** 組織と、作った人を Owner とするメンバーを作る */
export async function createOrganizationWithOwner(
  input: { name: string; slug: string; ownerUserId: string },
  now: Date,
  db: Db = getPrisma(),
) {
  const organization = await db.organization.create({
    data: {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      createdAt: now,
    },
    select: { id: true, name: true, slug: true },
  });
  const member = await createMember(
    {
      organizationId: organization.id,
      userId: input.ownerUserId,
      role: "owner",
    },
    now,
    db,
  );
  return { organization, member };
}

export async function createMember(
  input: { organizationId: string; userId: string; role: Role },
  now: Date,
  db: Db = getPrisma(),
) {
  return db.member.create({
    data: { id: randomUUID(), createdAt: now, ...input },
    select: { id: true, organizationId: true, userId: true },
  });
}
