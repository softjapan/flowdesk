import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/server/domain";
import { listMyOrganizations } from "@/server/services/organizations";
import { getCurrentUserId } from "@/server/session";
import { createOrganizationAction } from "./actions";
import { CreateOrgForm } from "./_components/create-org-form";

async function MyOrganizations() {
  const orgs = await listMyOrganizations(await getCurrentUserId());
  if (orgs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        所属している組織はありません。組織を作成するか、招待メールのリンクから参加してください。
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border">
      {orgs.map((o) => (
        <li key={o.slug}>
          <Link
            href={`/${o.slug}`}
            className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
          >
            <span className="font-medium">{o.name}</span>
            <Badge variant="outline">{ROLE_LABELS[o.role]}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// S-04 組織の選択・作成
export default function OrgsPage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="my-orgs-title">
        <h1 id="my-orgs-title" className="text-xl font-semibold">
          組織を選ぶ
        </h1>
        <Suspense
          fallback={<Skeleton className="h-24 w-full" aria-hidden />}
        >
          <MyOrganizations />
        </Suspense>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="create-org-title">組織を作成する</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOrgForm action={createOrganizationAction} />
        </CardContent>
      </Card>
    </div>
  );
}
