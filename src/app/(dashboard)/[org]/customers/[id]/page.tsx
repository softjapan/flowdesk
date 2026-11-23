import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getCustomer } from "@/server/services/customers";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { idSchema } from "@/server/validation/form";
import { CustomerForm } from "../_components/customer-form";
import { DeleteCustomerButton } from "../_components/delete-customer-button";
import {
  deleteCustomerAction,
  updateCustomerAction,
} from "../actions";

// S-10 顧客詳細（編集・削除。写真と予約履歴は第11章で追加する）
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
