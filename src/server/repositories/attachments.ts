/** 顧客の写真・添付ファイル（F-12）。すべて organizationId で絞り込む */
import { type Db, getPrisma } from "@/server/db";

export type NewAttachment = {
  customerId: string;
  s3Key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
};

export async function createAttachment(
  organizationId: string,
  data: NewAttachment,
  db: Db = getPrisma(),
) {
  return db.attachment.create({ data: { ...data, organizationId } });
}

/** アップロードが終わっていない（pending の）添付ファイル */
export async function findPendingAttachment(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.attachment.findFirst({
    where: { id, organizationId, status: "pending" },
  });
}

/** pending から uploaded にする。先に別のリクエストが変えていたら false */
export async function markAttachmentUploaded(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.attachment.updateMany({
    where: { id, organizationId, status: "pending" },
    data: { status: "uploaded" },
  });
  return count === 1;
}

/** 顧客のアップロード済みの添付ファイル（新しい順） */
export async function listUploadedAttachments(
  organizationId: string,
  customerId: string,
  db: Db = getPrisma(),
) {
  return db.attachment.findMany({
    where: { organizationId, customerId, status: "uploaded" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}
