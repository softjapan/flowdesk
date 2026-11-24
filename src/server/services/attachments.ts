/**
 * 顧客の写真・添付ファイル（F-12）。ファイルの本体はアプリのサーバーを
 * 通さず、ブラウザが S3 に署名付き URL で直接 PUT する：
 *
 *   1. requestUpload：権限と顧客を確かめ、pending の行を作って PUT の URL を返す
 *      （/api/uploads/presign）
 *   2. ブラウザが S3 に PUT する（Content-Type・Content-Length は署名済み）
 *   3. completeUpload：S3 にあるオブジェクトの形式とサイズを確かめて uploaded にする
 *
 * 署名付き URL の有効期限は 5 分（docs/authz-matrix.md）。S3 の鍵は
 * サーバーが決め、利用者のファイル名は使わない（パスの書き換えを防ぐ）。
 */
import { randomUUID } from "node:crypto";
import { runInTransaction } from "@/server/db";
import {
  createAttachment,
  findPendingAttachment,
  listUploadedAttachments,
  markAttachmentUploaded,
} from "@/server/repositories/attachments";
import { createAuditLog } from "@/server/repositories/audit-logs";
import { findCustomer } from "@/server/repositories/customers";
import {
  canReadAttachment,
  canUploadAttachment,
} from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import { fail, ok, type Result } from "@/server/services/result";
import {
  headObject,
  presignGet,
  presignPut,
  readObjectPrefix,
  type ObjectHead,
} from "@/server/storage";
import {
  ALLOWED_UPLOAD_TYPES,
  isImageType,
  matchesMagicBytes,
  type UploadContentType,
  type PresignRequest,
} from "@/server/validation/upload";

/** テストで S3 を差し替えられるようにする */
export type StorageDeps = {
  presignPut: typeof presignPut;
  presignGet: typeof presignGet;
  headObject: (key: string) => Promise<ObjectHead | null>;
  readObjectPrefix: (key: string) => Promise<Uint8Array | null>;
};

const defaultStorage: StorageDeps = {
  presignPut,
  presignGet,
  headObject,
  readObjectPrefix: (key) => readObjectPrefix(key),
};

export type UploadTicket = {
  attachmentId: string;
  /** PUT 先の署名付き URL */
  uploadUrl: string;
  /** PUT に付けるヘッダー（署名に含めたもの） */
  headers: { "Content-Type": string };
};

function attachmentKey(
  organizationId: string,
  customerId: string,
): string {
  return `orgs/${organizationId}/customers/${customerId}/${randomUUID()}`;
}

export async function requestUpload(
  ctx: OrgContext,
  input: Omit<PresignRequest, "org">,
  storage: StorageDeps = defaultStorage,
): Promise<Result<UploadTicket>> {
  if (!canUploadAttachment(ctx.role)) return fail("forbidden");
  // 他の組織・論理削除済みの顧客は、存在しない顧客と同じく not_found
  const customer = await findCustomer(
    ctx.organizationId,
    input.customerId,
  );
  if (!customer) return fail("not_found");

  const s3Key = attachmentKey(ctx.organizationId, customer.id);
  const attachment = await createAttachment(ctx.organizationId, {
    customerId: customer.id,
    s3Key,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    uploadedByUserId: ctx.userId,
  });
  const uploadUrl = await storage.presignPut({
    key: s3Key,
    contentType: input.contentType,
    contentLength: input.sizeBytes,
  });
  return ok({
    attachmentId: attachment.id,
    uploadUrl,
    headers: { "Content-Type": input.contentType },
  });
}

/**
 * PUT が終わったことを確かめて uploaded にする。S3 にない、または
 * 申告と形式・サイズが違うものは upload_mismatch（pending のまま残る）
 */
export async function completeUpload(
  ctx: OrgContext,
  attachmentId: string,
  storage: StorageDeps = defaultStorage,
): Promise<Result<{ id: string }>> {
  if (!canUploadAttachment(ctx.role)) return fail("forbidden");
  const attachment = await findPendingAttachment(
    ctx.organizationId,
    attachmentId,
  );
  if (!attachment) return fail("not_found");
  // 顧客がその後に削除されていたら、添付も見つからないものとして扱う
  if (
    !(await findCustomer(ctx.organizationId, attachment.customerId))
  ) {
    return fail("not_found");
  }

  const head = await storage.headObject(attachment.s3Key);
  if (
    !head ||
    head.sizeBytes !== attachment.sizeBytes ||
    head.contentType !== attachment.contentType
  ) {
    return fail("upload_mismatch");
  }
  // 申告された形式と中身が一致するか（名前だけ .png の SVG などを拒否する）
  const prefix = await storage.readObjectPrefix(attachment.s3Key);
  if (
    !prefix ||
    !(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(
      attachment.contentType,
    ) ||
    !matchesMagicBytes(
      attachment.contentType as UploadContentType,
      prefix,
    )
  ) {
    return fail("upload_mismatch");
  }

  return runInTransaction(async (tx) => {
    const changed = await markAttachmentUploaded(
      ctx.organizationId,
      attachment.id,
      tx,
    );
    // 同時に 2 回完了を送られたときは、先の 1 回だけを記録する
    if (!changed) return ok({ id: attachment.id });
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "attachment.upload",
        targetType: "attachment",
        targetId: attachment.id,
        // ファイル名は個人情報を含みうるので残さない
        diff: {
          customerId: attachment.customerId,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
        },
      },
      tx,
    );
    return ok({ id: attachment.id });
  });
}

export type AttachmentView = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  createdAt: Date;
  /** 5 分間有効な署名付き URL（画像は表示、PDF は保存） */
  url: string;
};

/** 顧客のアップロード済みの添付ファイル。顧客が見つからなければ null */
export async function listAttachments(
  ctx: OrgContext,
  customerId: string,
  storage: StorageDeps = defaultStorage,
): Promise<AttachmentView[] | null> {
  if (!canReadAttachment(ctx.role)) return null;
  if (!(await findCustomer(ctx.organizationId, customerId))) {
    return null;
  }
  const rows = await listUploadedAttachments(
    ctx.organizationId,
    customerId,
  );
  return Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      isImage: isImageType(a.contentType),
      createdAt: a.createdAt,
      url: await storage.presignGet({
        key: a.s3Key,
        fileName: a.fileName,
        disposition: isImageType(a.contentType)
          ? "inline"
          : "attachment",
      }),
    })),
  );
}
