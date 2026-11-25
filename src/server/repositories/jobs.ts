/**
 * 非同期ジョブ（job テーブル）。Worker はすべての組織のジョブを処理するので、
 * ここだけは id（と idempotencyKey）で引く。組織のデータを読むときは、
 * ジョブの payload にある organizationId で必ず絞り込む。
 */
import type { Prisma } from "@/generated/prisma/client";
import { type Db, getPrisma } from "@/server/db";

export type NewJob = {
  organizationId: string | null;
  type: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey: string;
};

/**
 * ジョブを作る。同じ idempotencyKey のジョブがあれば作らずにその id を返す
 * （同じ依頼を 2 回積んでも 1 件にまとまる）
 */
export async function insertJob(
  job: NewJob,
  db: Db = getPrisma(),
): Promise<string> {
  await db.job.createMany({ data: [job], skipDuplicates: true });
  const row = await db.job.findUniqueOrThrow({
    where: { idempotencyKey: job.idempotencyKey },
    select: { id: true },
  });
  return row.id;
}

/**
 * まとめて作る（第15章）。insertJob を件数分呼ぶと 1 件 2 クエリになり、
 * 前日リマインドで予約の数だけクエリが増えていた（N+1）。返す id は jobs と
 * 同じ順。既にあるジョブ（同じ idempotencyKey）は作らずにその id を返す
 */
export async function insertJobs(
  jobs: NewJob[],
  db: Db = getPrisma(),
): Promise<string[]> {
  if (jobs.length === 0) return [];
  await db.job.createMany({ data: jobs, skipDuplicates: true });
  const rows = await db.job.findMany({
    where: {
      idempotencyKey: { in: jobs.map((j) => j.idempotencyKey) },
    },
    select: { id: true, idempotencyKey: true },
  });
  const idByKey = new Map(rows.map((r) => [r.idempotencyKey, r.id]));
  return jobs.map((j) => {
    const id = idByKey.get(j.idempotencyKey);
    if (!id)
      throw new Error(`ジョブが見つからない：${j.idempotencyKey}`);
    return id;
  });
}

export async function findJob(id: string, db: Db = getPrisma()) {
  return db.job.findUnique({ where: { id } });
}

export async function findJobByKey(
  idempotencyKey: string,
  db: Db = getPrisma(),
) {
  return db.job.findUnique({ where: { idempotencyKey } });
}

/**
 * 処理する権利を取る。queued のもの、または running でも処理中の Worker が
 * 止まって期限（lockedUntil）を過ぎたものだけを取れる。
 * 同じメッセージが同時に 2 つの Worker に届いても、取れるのは片方だけ
 */
export async function claimJob(
  id: string,
  now: Date,
  lockedUntil: Date,
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.job.updateMany({
    where: {
      id,
      OR: [
        { status: "queued" },
        { status: "running", lockedUntil: { lt: now } },
      ],
    },
    data: {
      status: "running",
      lockedUntil,
      attempts: { increment: 1 },
    },
  });
  return count === 1;
}

export async function completeJob(
  id: string,
  now: Date,
  payload: Prisma.InputJsonValue | undefined,
  db: Db = getPrisma(),
): Promise<void> {
  await db.job.updateMany({
    where: { id, status: "running" },
    data: {
      status: "succeeded",
      completedAt: now,
      lockedUntil: null,
      lastError: null,
      ...(payload === undefined ? {} : { payload }),
    },
  });
}

/** 失敗を記録する。final なら failed（以降は処理しない）、そうでなければ queued に戻す */
export async function failJob(
  id: string,
  error: string,
  final: boolean,
  now: Date,
  db: Db = getPrisma(),
): Promise<void> {
  await db.job.updateMany({
    where: { id, status: "running" },
    data: {
      status: final ? "failed" : "queued",
      lastError: error.slice(0, 2000),
      lockedUntil: null,
      completedAt: final ? now : null,
    },
  });
}

export async function markJobsPublished(
  ids: string[],
  now: Date,
  db: Db = getPrisma(),
): Promise<void> {
  await db.job.updateMany({
    where: { id: { in: ids } },
    data: { publishedAt: now },
  });
}

/** 指定したジョブのうち、まだ SQS に送っていない queued のもの */
export async function listUnpublishedJobIds(
  ids: string[],
  db: Db = getPrisma(),
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.job.findMany({
    where: { id: { in: ids }, status: "queued", publishedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * キューに送り直すジョブ。
 * - queued のまま SQS に送れていない（コミット後の送信に失敗した）もの
 * - queued で、最後に送ってから長く経っても処理されていないもの
 * - running のまま期限を過ぎた（処理中の Worker が止まった）もの
 */
export async function listStrandedJobs(
  input: {
    unpublishedBefore: Date;
    publishedBefore: Date;
    lockedBefore: Date;
    limit: number;
  },
  db: Db = getPrisma(),
) {
  return db.job.findMany({
    where: {
      OR: [
        {
          status: "queued",
          publishedAt: null,
          createdAt: { lt: input.unpublishedBefore },
        },
        {
          status: "queued",
          publishedAt: { lt: input.publishedBefore },
        },
        {
          status: "running",
          lockedUntil: { lt: input.lockedBefore },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: input.limit,
    select: { id: true },
  });
}

/**
 * 失敗した（failed）ジョブを、もう一度処理できる状態（queued・未送信）に戻す
 * （第18章、障害の後の再実行。docs/runbooks/incident-ai.md）。
 * sweepStrandedJobs と同じく運用の処理なので組織では絞らず、種類と失敗した
 * 時刻で絞る。戻した ID を返す
 */
export async function requeueFailedJobs(
  filter: { type: string; failedSince: Date; limit: number },
  db: Db = getPrisma(),
): Promise<string[]> {
  const rows = await db.job.findMany({
    where: {
      status: "failed",
      type: filter.type,
      completedAt: { gte: filter.failedSince },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: filter.limit,
  });
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  await db.job.updateMany({
    where: { id: { in: ids }, status: "failed" },
    data: {
      status: "queued",
      attempts: 0,
      lockedUntil: null,
      publishedAt: null,
      completedAt: null,
    },
  });
  return ids;
}

/** 失敗したジョブの数（種類ごと。再実行の前に確かめる） */
export async function countFailedJobs(
  failedSince: Date,
  db: Db = getPrisma(),
): Promise<{ type: string; count: number }[]> {
  const rows = await db.job.groupBy({
    by: ["type"],
    where: { status: "failed", completedAt: { gte: failedSince } },
    _count: { _all: true },
  });
  return rows.map((r) => ({ type: r.type, count: r._count._all }));
}
