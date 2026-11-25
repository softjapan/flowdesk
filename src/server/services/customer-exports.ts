/**
 * 顧客一覧の CSV エクスポート（F-11）。Owner・Admin のみ
 * （docs/authz-matrix.md：個人情報の一括持ち出しになるため）。
 *
 * 画面は依頼を受け付けるだけで、CSV は Worker が作って S3 に置き、
 * 完了を依頼した人にメールで知らせる（src/server/services/job-handlers.ts）。
 * ダウンロードは /api/exports/[id] で権限を確かめ直してから、
 * 5 分間有効な署名付き URL へ送る。
 */
import { toZonedYmd } from "@/lib/datetime";
import { runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  createCustomerExport,
  findCustomerExport,
  listRecentCustomerExports,
} from "@/server/repositories/customer-exports";
import { canExportCustomers } from "@/server/services/authz";
import {
  createJob,
  dispatchJobs,
  JOB_TYPES,
  type Dispatch,
} from "@/server/services/jobs";
import type { OrgContext } from "@/server/services/org-context";
import { fail, ok, type Result } from "@/server/services/result";
import { presignGet } from "@/server/storage";
import { traceService } from "./traced";

export type CustomerExportJobPayload = {
  organizationId: string;
  exportId: string;
};

async function requestCustomerExportImpl(
  ctx: OrgContext,
  dispatch: Dispatch = dispatchJobs,
): Promise<Result<{ id: string }>> {
  if (!canExportCustomers(ctx.role)) return fail("forbidden");
  const { exportId, jobId } = await runInTransaction(async (tx) => {
    const row = await createCustomerExport(
      ctx.organizationId,
      ctx.userId,
      tx,
    );
    const payload: CustomerExportJobPayload = {
      organizationId: ctx.organizationId,
      exportId: row.id,
    };
    const jobId = await createJob(
      {
        organizationId: ctx.organizationId,
        type: JOB_TYPES.customerExport,
        payload,
        idempotencyKey: `${JOB_TYPES.customerExport}:${row.id}`,
      },
      tx,
    );
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "customer.export",
        targetType: "customerExport",
        targetId: row.id,
        diff: { status: "requested" },
      },
      tx,
    );
    return { exportId: row.id, jobId };
  });
  await dispatch([jobId]);
  return ok({ id: exportId });
}

export type CustomerExportView = {
  id: string;
  status: "pending" | "done" | "failed";
  rowCount: number | null;
  createdAt: Date;
  /** ダウンロードの入口（完了したものだけ） */
  downloadPath: string | null;
};

export const RECENT_EXPORTS_LIMIT = 5;

/** 最近のエクスポート。権限がなければ null（画面に出さない） */
export async function listCustomerExports(
  ctx: OrgContext,
): Promise<CustomerExportView[] | null> {
  if (!canExportCustomers(ctx.role)) return null;
  const rows = await listRecentCustomerExports(
    ctx.organizationId,
    RECENT_EXPORTS_LIMIT,
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    rowCount: r.rowCount,
    createdAt: r.createdAt,
    downloadPath:
      r.status === "done" ? customerExportPath(ctx.slug, r.id) : null,
  }));
}

export function customerExportPath(slug: string, id: string): string {
  return `/api/exports/${encodeURIComponent(id)}?${new URLSearchParams({ org: slug })}`;
}

export function customerExportKey(
  organizationId: string,
  id: string,
): string {
  return `orgs/${organizationId}/exports/${id}.csv`;
}

/**
 * ダウンロード用の署名付き URL。他の組織・未完了のものは not_found。
 * 依頼した人に限らず、今エクスポートの権限を持つ人ならダウンロードできる
 */
export async function getCustomerExportUrl(
  ctx: OrgContext,
  id: string,
  sign: typeof presignGet = presignGet,
): Promise<Result<{ url: string }>> {
  if (!canExportCustomers(ctx.role)) return fail("forbidden");
  const row = await findCustomerExport(ctx.organizationId, id);
  if (!row || row.status !== "done" || !row.s3Key) {
    return fail("not_found");
  }
  const ymd = toZonedYmd(row.createdAt, ctx.timezone).replaceAll(
    "-",
    "",
  );
  const url = await sign({
    key: row.s3Key,
    fileName: `customers-${ctx.slug}-${ymd}.csv`,
    disposition: "attachment",
  });
  return ok({ url });
}

export const requestCustomerExport = traceService(
  "customerExports.request",
  requestCustomerExportImpl,
);
