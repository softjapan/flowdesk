import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { listAttachments } from "@/server/services/attachments";
import { getCustomer } from "@/server/services/customers";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { idSchema } from "@/server/validation/form";
import { CustomerForm } from "../_components/customer-form";
import { DeleteCustomerButton } from "../_components/delete-customer-button";
import { AttachmentUploader } from "../_components/attachment-uploader";
import {
  completeUploadAction,
  deleteCustomerAction,
  updateCustomerAction,
} from "../actions";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// S-10 顧客詳細（編集・削除・写真と添付ファイル）
export default async function CustomerPage({
  params,
}: PageProps<"/[org]/customers/[id]">) {
  const { org, id } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const customerId = idSchema.safeParse(id);
  if (!customerId.success) notFound();
  // 他の組織・論理削除済みの顧客は、存在しない顧客と同じく 404
  const customer = await getCustomer(ctx, customerId.data);
  if (!customer) notFound();
  // 画像は 5 分間有効な署名付き URL で表示する
  const attachments = (await listAttachments(ctx, customer.id)) ?? [];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/${ctx.slug}/customers`}>
          <ChevronLeft aria-hidden="true" />
          顧客一覧へ戻る
        </Link>
      </Button>
      <h1 id="form-title" className="text-xl font-semibold">
        {customer.name} さんの情報
      </h1>
      <CustomerForm
        action={updateCustomerAction.bind(
          null,
          ctx.slug,
          customer.id,
        )}
        initialValues={customer}
        submitLabel="保存する"
      />
      <Separator />
      <section
        aria-labelledby="attachments-title"
        className="space-y-4"
      >
        <h2 id="attachments-title" className="text-lg font-semibold">
          写真・添付ファイル
        </h2>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            添付ファイルはありません。
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {attachments.map((a) => (
              <li key={a.id} className="space-y-1 text-sm">
                {a.isImage ? (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {/* 署名付き URL は 5 分で切れるので、next/image の最適化（キャッシュ）は使わない */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={a.fileName}
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={a.url}
                    className="flex aspect-square w-full items-center justify-center rounded-md border text-muted-foreground"
                  >
                    PDF
                  </a>
                )}
                <p className="truncate" title={a.fileName}>
                  {a.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(a.sizeBytes)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <AttachmentUploader
          slug={ctx.slug}
          customerId={customer.id}
          complete={completeUploadAction.bind(null, ctx.slug)}
        />
      </section>
      {customer.canDelete && (
        <>
          <Separator />
          <DeleteCustomerButton
            action={deleteCustomerAction.bind(
              null,
              ctx.slug,
              customer.id,
            )}
          />
        </>
      )}
    </div>
  );
}
