/**
 * 組織とメンバーの取得。組織そのものはスラッグで引く（URL の [org]）が、
 * それ以外はすべて organizationId を条件に含める。
 */
import { type Db, getPrisma } from "@/server/db";
import type { Role } from "@/server/domain";

const roles: readonly Role[] = ["owner", "admin", "staff"];

/**
 * Better Auth の member.role は文字列（既定値 "member"、複数ロールは
 * カンマ区切り）。FlowDesk のロール以外は null にし、権限を与えない。
 * staff ロールの定義は第10章で createAccessControl に移す。
 */
function toRole(value: string): Role | null {
  return (roles as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

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
 * ユーザーが所属する組織（ログイン後の行き先・第10章の組織の選択で使う）。
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
