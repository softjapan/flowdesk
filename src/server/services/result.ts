/**
 * 更新系の Service の戻り値。失敗の理由は入口（Server Action・
 * Route Handler）が HTTP の意味や画面のメッセージに変換する。
 */
export type Failure =
  /** 存在しない・他の組織・論理削除済み（区別せず 404 にする） */
  | "not_found"
  /** 組織のメンバーだが、ロールや担当の条件を満たさない */
  | "forbidden"
  /** 読んだ後に他の人が更新した（楽観ロック） */
  | "conflict"
  /** 同じスタッフの予約と時間が重なる（排他制約） */
  | "slot_taken"
  /** キャンセル済み・来店済みの予約は変更できない */
  | "not_editable"
  /** 最後の Owner を降格・削除しようとした（組織に Owner がいなくなる） */
  | "last_owner"
  /** 招待しようとした相手が、すでに組織のメンバー */
  | "already_member"
  /** 組織の URL（スラッグ）が使われている */
  | "slug_taken"
  /** S3 にファイルがない、または申告と形式・サイズが違う */
  | "upload_mismatch"
  /** プランの上限（Free はスタッフ 2 人・店舗 1 つ）に達している */
  | "plan_limit"
  /** すでに Pro（変更・解約はカスタマーポータルで行う） */
  | "already_subscribed"
  /** Stripe の顧客がまだない（Pro に申し込んだことがない） */
  | "no_billing_account"
  /** Stripe の API キー・Price が設定されていない */
  | "billing_unavailable";

export type Result<T> =
  { ok: true; value: T } | { ok: false; reason: Failure };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(reason: Failure): Result<T> {
  return { ok: false, reason };
}
