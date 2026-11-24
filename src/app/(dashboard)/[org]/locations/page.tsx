import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLocationsPage } from "@/server/services/locations";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import type { LocationFieldName } from "@/server/validation/location";
import {
  CatalogForm,
  DeleteButton,
  type CatalogField,
} from "../_components/catalog-forms";
import {
  createLocationAction,
  deleteLocationAction,
  updateLocationAction,
} from "./actions";

/** よく使うタイムゾーン（候補として出す。ほかの IANA の名前も入力できる） */
const TIMEZONES = [
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Taipei",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "UTC",
] as const;

const fields: CatalogField<LocationFieldName>[] = [
  { name: "name", label: "店舗名" },
  {
    name: "timezone",
    label: "タイムゾーン",
    suggestions: TIMEZONES,
  },
];

// S-12 店舗管理（閲覧は全ロール、編集は Owner・Admin）
export default async function LocationsPage({
  params,
}: PageProps<"/[org]/locations">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const page = await getLocationsPage(ctx);
  const usage = page.planUsage;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">店舗管理</h1>

      <section
        className="space-y-3"
        aria-labelledby="locations-title"
      >
        <h2 id="locations-title" className="font-semibold">
          店舗（{page.locations.length} 件）
        </h2>
        {page.canManage ? (
          <ul className="space-y-4">
            {page.locations.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
              >
                <CatalogForm
                  action={updateLocationAction.bind(
                    null,
                    ctx.slug,
                    l.id,
                  )}
                  fields={fields}
                  initialValues={{
                    name: l.name,
                    timezone: l.timezone,
                  }}
                  idPrefix={`location-${l.id}`}
                  formLabel={`${l.name}の編集`}
                  submitLabel="保存"
                />
                <DeleteButton
                  action={deleteLocationAction.bind(
                    null,
                    ctx.slug,
                    l.id,
                  )}
                  label={`${l.name}を削除`}
                  confirmMessage={`${l.name}を削除しますか？予約のある店舗は削除できません。`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>店舗名</TableHead>
                <TableHead>タイムゾーン</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.locations.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    {l.name}
                  </TableCell>
                  <TableCell>{l.timezone}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          予約の日時は店舗のタイムゾーンで入力・表示します。タイムゾーンを変えると、作成済みの予約の表示上の時刻も変わります。
        </p>
        {usage && (
          <p className="text-xs text-muted-foreground">
            {usage.label} プラン：店舗{" "}
            {usage.maxLocations === null
              ? `${usage.locations} 件（上限なし）`
              : `${usage.locations} / ${usage.maxLocations} 件`}
            。上限に達すると追加できません
            {ctx.role === "owner" ? (
              <>
                （
                <Link
                  href={`/${ctx.slug}/billing`}
                  className="underline"
                >
                  料金プラン
                </Link>
                ）
              </>
            ) : (
              "（プランの変更は Owner が行います）"
            )}
            。
          </p>
        )}
      </section>

      {page.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>店舗を追加する</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CatalogForm
              action={createLocationAction.bind(null, ctx.slug)}
              fields={fields}
              initialValues={{ timezone: ctx.timezone }}
              idPrefix="new-location"
              formLabel="店舗を追加する"
              submitLabel="追加"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
