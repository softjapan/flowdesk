import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatYen } from "@/lib/money";
import { getOrgContext } from "@/server/services/org-context";
import { getReservation } from "@/server/services/reservations";
import { getCurrentUserId } from "@/server/session";
import { idSchema } from "@/server/validation/form";
import { StatusBadge } from "../../_components/status-badge";
import { CancelReservationButton } from "../_components/cancel-reservation-button";
import { ReservationForm } from "../_components/reservation-form";
import {
  cancelReservationAction,
  updateReservationAction,
} from "../actions";

// S-08 予約の変更・キャンセル
export default async function ReservationPage({
  params,
}: PageProps<"/[org]/reservations/[id]">) {
  const { org, id } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const reservationId = idSchema.safeParse(id);
  if (!reservationId.success) notFound();
  // 他の組織の予約は、存在しない予約と同じく 404
  const r = await getReservation(ctx, reservationId.data);
  if (!r) notFound();
  const changeable = r.canManage && r.editable;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link
          href={`/${ctx.slug}/reservations?${new URLSearchParams({
            view: "day",
            date: r.values.date,
          })}`}
        >
          <ChevronLeft aria-hidden="true" />
          予約カレンダーへ戻る
        </Link>
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="form-title" className="text-xl font-semibold">
          予約の詳細
        </h1>
        <StatusBadge status={r.status} />
        <span className="text-sm text-muted-foreground tabular-nums">
          料金 {formatYen(r.priceYen)}（予約時点）
        </span>
      </div>
      {!r.editable && (
        <p className="text-sm text-muted-foreground">
          キャンセル済み・来店済みの予約は変更できません。
        </p>
      )}
      {r.editable && !r.canManage && (
        <p className="text-sm text-muted-foreground">
          自分が担当の予約だけを変更できます。
        </p>
      )}
      <ReservationForm
        // 保存すると Server Action の refresh() で読み込み直し、新しい
        // version が hidden の項目に入る
        action={updateReservationAction.bind(null, ctx.slug, r.id)}
        options={r.options}
        initialValues={r.values}
        version={r.version}
        timezone={r.timezone}
        submitLabel="変更を保存する"
        disabled={!changeable}
      />
      {changeable && (
        <>
          <Separator />
          <CancelReservationButton
            action={cancelReservationAction.bind(
              null,
              ctx.slug,
              r.id,
            )}
            version={r.version}
          />
        </>
      )}
    </div>
  );
}
