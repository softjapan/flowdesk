/**
 * 監査ログの閲覧（S-15、F-16）。Owner・Admin のみ。
 * 期間は店舗のタイムゾーンでの日付で受け取り、UTC に直して絞り込む。
 */
import {
  addDays,
  formatTime,
  toZonedYmd,
  zonedToUtc,
} from "@/lib/datetime";
import { ROLE_LABELS } from "@/server/domain";
import { PLANS } from "@/server/plans";
import { toRole } from "@/server/access-control";
import {
  STRIPE_ACTOR_ID,
  listAuditActorIds,
  listAuditLogs as listAuditLogRows,
} from "@/server/repositories/audit-logs";
import { listUserNames } from "@/server/repositories/users";
import { canViewAuditLogs } from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import { fail, ok, type Result } from "@/server/services/result";
import {
  auditLogQuerySchema,
  type SearchParams,
} from "@/server/validation/search-params";

export const AUDIT_LOG_PAGE_SIZE = 50;

export const AUDIT_TARGET_LABELS: Record<string, string> = {
  organization: "組織",
  member: "メンバー",
  invitation: "招待",
  customer: "顧客",
  reservation: "予約",
  attachment: "添付ファイル",
  customerExport: "CSV エクスポート",
  location: "店舗",
  subscription: "料金プラン",
};

const actionLabels: Record<string, string> = {
  "organization.create": "組織の作成",
  "member.add": "メンバーの追加（招待の受諾）",
  "member.update_role": "ロールの変更",
  "member.remove": "メンバーの削除",
  "invitation.create": "招待",
  "invitation.cancel": "招待の取り消し",
  "customer.create": "顧客の登録",
  "customer.update": "顧客の編集",
  "customer.delete": "顧客の削除",
  "customer.export": "顧客一覧の CSV エクスポート",
  "attachment.upload": "添付ファイルのアップロード",
  "reservation.create": "予約の作成",
  "reservation.update": "予約の変更",
  "reservation.cancel": "予約のキャンセル",
  "location.create": "店舗の作成",
  "subscription.update": "料金プランの変更（Stripe）",
};

/** ユーザーではない操作者（Webhook など） */
const systemActorNames: Record<string, string> = {
  [STRIPE_ACTOR_ID]: "Stripe（Webhook）",
};

export type AuditLogQuery = {
  from: string | null;
  to: string | null;
  actorUserId: string | null;
  targetType: string | null;
  page: number;
};

export type AuditLogListItem = {
  id: string;
  /** 店舗のタイムゾーンでの日時（例："2026-11-24 09:30"） */
  at: string;
  actorName: string;
  action: string;
  actionLabel: string;
  targetLabel: string;
  targetId: string;
  summary: string;
};

export type AuditLogList = {
  query: AuditLogQuery;
  items: AuditLogListItem[];
  total: number;
  pageCount: number;
  actors: { id: string; name: string }[];
};

function roleLabel(value: unknown): string {
  const role = typeof value === "string" ? toRole(value) : null;
  return role ? ROLE_LABELS[role] : String(value);
}

function planLabel(value: unknown): string {
  return value === "pro" || value === "free"
    ? PLANS[value].label
    : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/** 変更の要約。権限の変更は「誰の・何から何へ」が分かるようにする */
export function describeAuditDiff(
  action: string,
  diff: unknown,
  userNames: ReadonlyMap<string, string>,
): string {
  if (!isRecord(diff)) return "";
  const who =
    typeof diff.userId === "string"
      ? (userNames.get(diff.userId) ?? diff.userId)
      : "";
  switch (action) {
    case "member.update_role":
      return `${who}：${roleLabel(diff.from)} → ${roleLabel(diff.to)}`;
    case "member.add":
    case "member.remove":
      return `${who}（${roleLabel(diff.role)}）`;
    case "invitation.create":
    case "invitation.cancel":
      return `${String(diff.email)}（${roleLabel(diff.role)}）`;
    case "organization.create":
      return `${String(diff.name)}（/${String(diff.slug)}）`;
    case "location.create":
      return String(diff.name);
    case "subscription.update":
      if (isRecord(diff.from) && isRecord(diff.to)) {
        return `${planLabel(diff.from.plan)} → ${planLabel(diff.to.plan)}（${String(diff.to.status)}）`;
      }
      break;
  }
  if (Array.isArray(diff.fields)) {
    return `項目：${diff.fields.join(", ")}`;
  }
  return Object.keys(diff).join(", ");
}

/** diff に現れるユーザー（ロール変更の相手など）の ID */
function userIdsInDiff(diff: unknown): string[] {
  return isRecord(diff) && typeof diff.userId === "string"
    ? [diff.userId]
    : [];
}

export async function listAuditLogs(
  ctx: OrgContext,
  params: SearchParams,
): Promise<Result<AuditLogList>> {
  if (!canViewAuditLogs(ctx.role)) return fail("forbidden");
  const parsed = auditLogQuerySchema.parse(params);
  const targetType =
    parsed.target && parsed.target in AUDIT_TARGET_LABELS
      ? parsed.target
      : null;
  const filter = {
    from: parsed.from ? zonedToUtc(parsed.from, ctx.timezone) : null,
    // 終了日はその日の終わりまで含める
    to: parsed.to
      ? zonedToUtc(addDays(parsed.to, 1), ctx.timezone)
      : null,
    actorUserId: parsed.actor,
    targetType,
  };

  const [actorIds, first] = await Promise.all([
    listAuditActorIds(ctx.organizationId),
    listAuditLogRows(ctx.organizationId, filter, {
      skip: (parsed.page - 1) * AUDIT_LOG_PAGE_SIZE,
      take: AUDIT_LOG_PAGE_SIZE,
    }),
  ]);
  const pageCount = Math.max(
    1,
    Math.ceil(first.total / AUDIT_LOG_PAGE_SIZE),
  );
  const page = Math.min(parsed.page, pageCount);
  // ページ番号が大きすぎたときは最後のページを読み直す
  const { rows, total } =
    page === parsed.page
      ? first
      : await listAuditLogRows(ctx.organizationId, filter, {
          skip: (page - 1) * AUDIT_LOG_PAGE_SIZE,
          take: AUDIT_LOG_PAGE_SIZE,
        });

  // 操作者と diff に現れるユーザーは、この組織の監査ログに現れた ID だけ
  const names = await listUserNames([
    ...new Set([
      ...actorIds,
      ...rows.flatMap((r) => userIdsInDiff(r.diff)),
    ]),
  ]);
  const nameOf = (id: string) =>
    systemActorNames[id] ?? names.get(id) ?? "（削除されたユーザー）";

  return ok({
    query: {
      from: parsed.from,
      to: parsed.to,
      actorUserId: parsed.actor,
      targetType,
      page,
    },
    items: rows.map((r) => ({
      id: r.id,
      at: `${toZonedYmd(r.createdAt, ctx.timezone)} ${formatTime(r.createdAt, ctx.timezone)}`,
      actorName: nameOf(r.actorUserId),
      action: r.action,
      actionLabel: actionLabels[r.action] ?? r.action,
      targetLabel: AUDIT_TARGET_LABELS[r.targetType] ?? r.targetType,
      targetId: r.targetId,
      summary: describeAuditDiff(r.action, r.diff, names),
    })),
    total,
    pageCount,
    actors: actorIds
      .map((id) => ({ id, name: nameOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja")),
  });
}
