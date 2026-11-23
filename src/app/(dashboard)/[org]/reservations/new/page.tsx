import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toZonedYmd } from "@/lib/datetime";
import { getOrgContext } from "@/server/services/org-context";
import { getReservationFormOptions } from "@/server/services/reservations";
import { getCurrentUserId } from "@/server/session";
import { ReservationForm } from "../_components/reservation-form";
import { createReservationAction } from "../actions";

// S-08 予約の作成（Staff は自分が担当の予約だけを作れる）
export default async function NewReservationPage({
  params,
}: PageProps<"/[org]/reservations/new">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const options = await getReservationFormOptions(ctx);
  const only = (list: { id: string }[]) =>
    list.length === 1 ? list[0]?.id : undefined;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/${ctx.slug}/reservations`}>
          <ChevronLeft aria-hidden="true" />
          予約カレンダーへ戻る
        </Link>
      </Button>
      <h1 id="form-title" className="text-xl font-semibold">
        予約の作成
      </h1>
      {options.staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          担当できるスタッフが登録されていないため、予約を作成できません。
        </p>
      ) : (
        <ReservationForm
          action={createReservationAction.bind(null, ctx.slug)}
          options={options}
          initialValues={{
            staffProfileId: only(options.staff),
            locationId: only(options.locations),
            date: toZonedYmd(new Date(), ctx.timezone),
            time: "10:00",
            status: "confirmed",
          }}
          timezone={ctx.timezone}
          submitLabel="予約を作成する"
        />
      )}
    </div>
  );
}
