/**
 * 非同期ジョブの仕組み（F-11・F-13）。
 *
 * 積む側（アプリ・Worker）：
 *   1. 業務の変更と同じトランザクションで job の行を作る（createJob）。
 *      変更が取り消されればジョブも残らない（Transactional Outbox）
 *   2. コミットした後に SQS へ { jobId } を送る（dispatchJobs）。
 *      送れなくても行は残るので、Worker の sweepStrandedJobs が送り直す
 *
 * 処理する側（Worker、runJob）：
 *   - SQS は同じメッセージを 2 回以上届けることがある（少なくとも 1 回の配信）。
 *     job の status と claimJob（条件付きの UPDATE）で、終わったジョブは
 *     処理せず、同時に届いても 1 つの Worker だけが処理する
 *   - 失敗したらメッセージを消さずに返し、SQS に再配信させる。
 *     MAX_ATTEMPTS 回失敗したら failed にし、メッセージは SQS が
 *     デッドレターキューへ移す（docker/elasticmq.conf の maxReceiveCount）
 *
 * 同じ依頼を 2 回積んでも、idempotencyKey が同じなら 1 件にまとまる。
 */
import type { Prisma } from "@/generated/prisma/client";
import { isQueueConfigured } from "@/server/aws";
import type { Db } from "@/server/db";
import { logger } from "@/server/logger";
import type { Mail } from "@/server/mail";
import { sendJobMessage } from "@/server/queue";
import { withSpan } from "@/server/telemetry/tracing";
import {
  claimJob,
  completeJob,
  failJob,
  findJob,
  insertJob,
  countFailedJobs,
  listStrandedJobs,
  markJobsPublished,
  requeueFailedJobs,
  type NewJob,
} from "@/server/repositories/jobs";

/** docker/elasticmq.conf（本番は SQS の redrive policy）の maxReceiveCount と合わせる */
export const MAX_ATTEMPTS = 3;

/**
 * 処理中の印の有効期限。キューの可視性タイムアウト（60 秒）より短くし、
 * Worker が止まったときは再配信されたメッセージで別の Worker が取り直せるようにする
 */
export const JOB_LEASE_MS = 50_000;

export const JOB_TYPES = {
  mailSend: "mail.send",
  reservationConfirmed: "reservation.confirmed",
  reservationReminder: "reservation.reminder",
  customerExport: "customer.export",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/** 業務の変更と同じトランザクションの tx を渡す。id を返す（dispatchJobs に渡す） */
export function createJob(job: NewJob, db: Db): Promise<string> {
  return insertJob(job, db);
}

/**
 * メールの送信の依頼。key は「何のメールか」を表す値にする
 * （同じ key のメールは 1 通だけ送る）
 */
export function createMailJob(
  mail: Mail,
  options: { key: string; organizationId: string | null },
  db: Db,
): Promise<string> {
  return createJob(
    {
      organizationId: options.organizationId,
      type: JOB_TYPES.mailSend,
      payload: mail,
      idempotencyKey: `mail:${options.key}`,
    },
    db,
  );
}

export type ReservationJobPayload = {
  organizationId: string;
  reservationId: string;
  /** 依頼した時点の開始日時。処理する時点で変わっていたら送らない */
  startsAt: string;
};

/** 予約の確定・リマインドのメールのジョブ。日時を変えたら、新しい日時で 1 通送る */
export function reservationMailJob(
  type:
    | typeof JOB_TYPES.reservationConfirmed
    | typeof JOB_TYPES.reservationReminder,
  organizationId: string,
  reservationId: string,
  startsAt: Date,
): NewJob {
  const payload: ReservationJobPayload = {
    organizationId,
    reservationId,
    startsAt: startsAt.toISOString(),
  };
  return {
    organizationId,
    type,
    payload,
    idempotencyKey: `${type}:${reservationId}:${payload.startsAt}`,
  };
}

/** SQS へ送る。失敗しても例外にしない（行は残り、Worker が送り直す） */
export type Dispatch = (jobIds: string[]) => Promise<void>;

export const dispatchJobs: Dispatch = async (jobIds) => {
  if (jobIds.length === 0) return;
  if (!isQueueConfigured()) {
    logger.warn(
      "SQS_QUEUE_URL が未設定のため、ジョブをキューに送らない",
      {
        jobIds,
      },
    );
    return;
  }
  const sent: string[] = [];
  for (const id of jobIds) {
    try {
      await sendJobMessage(id);
      sent.push(id);
    } catch (error) {
      logger.error("ジョブをキューに送れなかった", {
        jobId: id,
        err: error,
      });
    }
  }
  if (sent.length > 0) {
    await markJobsPublished(sent, new Date()).catch(
      (error: unknown) => {
        logger.error("ジョブの送信日時を記録できなかった", {
          jobIds: sent,
          err: error,
        });
      },
    );
  }
};

/** トランザクションの外から 1 件積む（作ってからすぐ送る） */
export async function enqueueJob(
  job: NewJob,
  dispatch: Dispatch = dispatchJobs,
): Promise<string> {
  const id = await insertJob(job);
  await dispatch([id]);
  return id;
}

/** トランザクションの外からメールを 1 通積む（パスワード再設定など） */
export async function enqueueMail(
  mail: Mail,
  options: { key: string; organizationId: string | null },
  dispatch: Dispatch = dispatchJobs,
): Promise<string> {
  return enqueueJob(
    {
      organizationId: options.organizationId,
      type: JOB_TYPES.mailSend,
      payload: mail,
      idempotencyKey: `mail:${options.key}`,
    },
    dispatch,
  );
}

/** 再試行しても結果が変わらない失敗（payload の形式が違うなど）。すぐ failed にする */
export class PermanentJobError extends Error {}

export type JobRecord = {
  id: string;
  organizationId: string | null;
  type: string;
  payload: Prisma.JsonValue;
};

export type JobContext = {
  now: Date;
  /** 後続のジョブを積む（例：CSV を作った後の完了メール） */
  enqueue: (job: NewJob) => Promise<string>;
};

export type JobHandler = {
  /**
   * ジョブの本体。同じジョブが（前回の途中で落ちて）もう一度動いても
   * 結果が同じになるように書く。戻り値の payload があれば、完了時に
   * job.payload を置き換える（送ったメールの本文を DB に残さないため）
   */
  run: (
    job: JobRecord,
    ctx: JobContext,
  ) => Promise<{ payload?: Prisma.InputJsonValue } | void>;
  /** MAX_ATTEMPTS 回失敗したとき（エクスポートを「失敗」にするなど） */
  onFailed?: (job: JobRecord, ctx: JobContext) => Promise<void>;
};

export type JobHandlers = Record<string, JobHandler>;

/**
 * runJob の結果。Worker はこれでメッセージの扱いを決める
 * - done：終わった（今回処理した・前に終わっていた・ジョブがない）。メッセージを消す
 * - busy：他の Worker が処理中。消さずに再配信を待つ
 * - retry：失敗した。消さずに再配信させる
 * - dead：MAX_ATTEMPTS 回失敗した。消さずに置き、SQS にデッドレターキューへ移させる
 */
export type RunJobOutcome =
  | { status: "done" }
  | { status: "busy" }
  | { status: "retry"; attempts: number }
  | { status: "dead" };

/** job.lastError に残す文字列。接続の失敗（AggregateError）は中のエラーも並べる */
function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return `${error.name}: ${error.errors.map(errorMessage).join("; ")}`;
  }
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: unknown }).code;
  return `${error.name}: ${error.message || String(code ?? "")}`;
}

export async function runJob(
  jobId: string,
  handlers: JobHandlers,
  options: { now?: Date; dispatch?: Dispatch } = {},
): Promise<RunJobOutcome> {
  const now = options.now ?? new Date();
  const dispatch = options.dispatch ?? dispatchJobs;
  const job = await findJob(jobId);
  // ジョブがない（組織ごと削除された・別の環境のメッセージ）・すでに終わった
  if (!job || job.status === "succeeded" || job.status === "failed") {
    return { status: "done" };
  }
  const claimed = await claimJob(
    jobId,
    now,
    new Date(now.getTime() + JOB_LEASE_MS),
  );
  if (!claimed) return { status: "busy" };
  const attempts = job.attempts + 1;

  const record: JobRecord = {
    id: job.id,
    organizationId: job.organizationId,
    type: job.type,
    payload: job.payload,
  };
  const ctx: JobContext = {
    now,
    enqueue: (next) => enqueueJob(next, dispatch),
  };
  const handler = handlers[job.type];
  try {
    if (!handler) {
      throw new PermanentJobError(`未知のジョブ: ${job.type}`);
    }
    // ハンドラーの処理をスパンにする（属性は ID と種類だけ。payload は載せない）
    const result = await withSpan(
      `job ${job.type}`,
      {
        "flowdesk.job.id": job.id,
        "flowdesk.job.type": job.type,
        "flowdesk.job.attempt": attempts,
        "flowdesk.organization.id": job.organizationId ?? "",
      },
      () => handler.run(record, ctx),
    );
    await completeJob(jobId, new Date(), result?.payload);
    return { status: "done" };
  } catch (error) {
    const final =
      error instanceof PermanentJobError || attempts >= MAX_ATTEMPTS;
    logger.error("ジョブが失敗", {
      jobId,
      jobType: job.type,
      attempts,
      final,
      err: error,
    });
    await failJob(jobId, errorMessage(error), final, new Date());
    if (!final) return { status: "retry", attempts };
    await handler?.onFailed?.(record, ctx).catch((e: unknown) => {
      logger.error("失敗時の処理が失敗", { jobId, err: e });
    });
    // 形式の誤りなど再試行しても同じ失敗は、DLQ を待たずに終える
    return error instanceof PermanentJobError
      ? { status: "done" }
      : { status: "dead" };
  }
}

/**
 * SQS に届いていないジョブを送り直す（Worker が定期的に呼ぶ）。
 * 二重に送っても runJob が 1 回しか処理しないので、迷ったら送る側に倒す
 */
export async function sweepStrandedJobs(
  now: Date,
  dispatch: Dispatch = dispatchJobs,
): Promise<number> {
  const stranded = await listStrandedJobs({
    // コミット直後の送信と競合しないよう、少し待ってから拾う
    unpublishedBefore: new Date(now.getTime() - 30_000),
    publishedBefore: new Date(now.getTime() - 15 * 60_000),
    lockedBefore: new Date(now.getTime() - 60_000),
    limit: 100,
  });
  await dispatch(stranded.map((j) => j.id));
  return stranded.length;
}

/**
 * 障害（SMTP が止まったなど）で failed になったジョブを再実行する（第18章）。
 * DLQ のメッセージを本体のキューに戻すだけでは、runJob が failed のジョブを
 * 「終わった」として捨てるので再実行されない。DB の job を queued に戻してから
 * 送る（DLQ に残ったメッセージは、受け取っても runJob が done にするので消してよい）。
 * 原因を直してから使う。payload の宛先・本文はそのまま使われる
 */
export async function retryFailedJobs(
  input: { type: string; failedSince: Date; limit?: number },
  dispatch: Dispatch = dispatchJobs,
): Promise<string[]> {
  const ids = await requeueFailedJobs({
    type: input.type,
    failedSince: input.failedSince,
    limit: input.limit ?? 500,
  });
  logger.info("失敗したジョブを再実行する", {
    jobType: input.type,
    count: ids.length,
  });
  await dispatch(ids);
  return ids;
}

/** 再実行の前に、失敗したジョブの数を種類ごとに見る */
export function summarizeFailedJobs(failedSince: Date) {
  return countFailedJobs(failedSince);
}
