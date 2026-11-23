import { cache } from "react";
import type { Role } from "@/server/domain";
import { listLocations } from "@/server/repositories/catalog";
import {
  findMember,
  findOrganizationBySlug,
  listOrganizationsForUser,
} from "@/server/repositories/organizations";

/** 組織の画面で、Service に渡す「誰が・どの組織で」の情報 */
export type OrgContext = {
  organizationId: string;
  organizationName: string;
  slug: string;
  userId: string;
  memberId: string;
  role: Role;
  /** 日付の境界と表示に使うタイムゾーン（組織の最初の店舗） */
  timezone: string;
};

/**
 * スラッグから組織を引き、ユーザーがそのメンバーであることを確かめる。
 * 組織が存在しない場合とメンバーでない場合は、どちらも null を返す
 * （呼び出し側で 404 にし、組織の存在を漏らさない）。
 *
 * レイアウトと各ページから呼ばれるので、React の cache で包み、
 * 同じリクエストの中では一度だけ実行する。
 */
export const getOrgContext = cache(async function getOrgContext(
  slug: string,
  userId: string,
): Promise<OrgContext | null> {
  const organization = await findOrganizationBySlug(slug);
  if (!organization) return null;
  const member = await findMember(organization.id, userId);
  if (!member) return null;
  const [location] = await listLocations(organization.id);
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    slug: organization.slug,
    userId,
    memberId: member.id,
    role: member.role,
    timezone: location?.timezone ?? "Asia/Tokyo",
  };
});

/**
 * ログイン後の行き先にする組織のスラッグ（最初に所属した組織）。
 * どの組織にも所属していなければ null（組織の作成は第10章の /orgs）。
 */
export async function findHomeOrgSlug(
  userId: string,
): Promise<string | null> {
  const [first] = await listOrganizationsForUser(userId);
  return first?.slug ?? null;
}
