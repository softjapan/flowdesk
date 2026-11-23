import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { CustomerForm } from "../_components/customer-form";
import { createCustomerAction } from "../actions";

// S-17 顧客の新規登録（作成は全ロールに許可。docs/authz-matrix.md）
export default async function NewCustomerPage({
  params,
}: PageProps<"/[org]/customers/new">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/${ctx.slug}/customers`}>
          <ChevronLeft aria-hidden="true" />
          顧客一覧へ戻る
        </Link>
      </Button>
      <h1 id="form-title" className="text-xl font-semibold">
        顧客の新規登録
      </h1>
      <CustomerForm
        action={createCustomerAction.bind(null, ctx.slug)}
        submitLabel="登録する"
      />
    </div>
  );
}
