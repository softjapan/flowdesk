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
import { formatYen } from "@/lib/money";
import { getMenusPage } from "@/server/services/menus";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import type { MenuFieldName } from "@/server/validation/menu";
import {
  CatalogForm,
  DeleteButton,
  type CatalogField,
} from "../_components/catalog-forms";
import {
  createMenuAction,
  deleteMenuAction,
  updateMenuAction,
} from "./actions";

const fields: CatalogField<MenuFieldName>[] = [
  { name: "name", label: "メニュー名" },
  {
    name: "durationMinutes",
    label: "所要時間",
    numeric: true,
    suffix: "分",
    className: "w-20",
  },
  {
    name: "priceYen",
    label: "料金（税込）",
    numeric: true,
    suffix: "円",
    className: "w-28",
  },
];

// S-11 メニュー管理（閲覧は全ロール、編集は Owner・Admin）
export default async function ServicesPage({
  params,
}: PageProps<"/[org]/services">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const page = await getMenusPage(ctx);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">メニュー管理</h1>

      <section className="space-y-3" aria-labelledby="menus-title">
        <h2 id="menus-title" className="font-semibold">
          メニュー（{page.menus.length} 件）
        </h2>
        {page.canManage ? (
          <ul className="space-y-4">
            {page.menus.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
              >
                <CatalogForm
                  action={updateMenuAction.bind(null, ctx.slug, m.id)}
                  fields={fields}
                  initialValues={{
                    name: m.name,
                    durationMinutes: String(m.durationMinutes),
                    priceYen: String(m.priceYen),
                  }}
                  idPrefix={`menu-${m.id}`}
                  formLabel={`${m.name}の編集`}
                  submitLabel="保存"
                />
                <DeleteButton
                  action={deleteMenuAction.bind(null, ctx.slug, m.id)}
                  label={`${m.name}を削除`}
                  confirmMessage={`${m.name}を削除しますか？予約で使われているメニューは削除できません。`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>メニュー名</TableHead>
                <TableHead className="text-right">所要時間</TableHead>
                <TableHead className="text-right">
                  料金（税込）
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.menus.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.durationMinutes} 分
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatYen(m.priceYen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          料金と所要時間を変えても、作成済みの予約の料金・終了時刻は変わりません。
        </p>
      </section>

      {page.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>メニューを追加する</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CatalogForm
              action={createMenuAction.bind(null, ctx.slug)}
              fields={fields}
              initialValues={{}}
              idPrefix="new-menu"
              formLabel="メニューを追加する"
              submitLabel="追加"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
