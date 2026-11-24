import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/server/domain";
import { getInvitationForUser } from "@/server/services/invitations";
import { getCurrentUserId, getSession } from "@/server/session";
import { idSchema } from "@/server/validation/form";
import {
  acceptInvitationAction,
  rejectInvitationAction,
} from "./actions";

// 招待のリンクは推測できない ID だが、検索エンジンには載せない
export const metadata: Metadata = { robots: { index: false } };

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

function Message({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {children}
        <p>
          <Link href="/orgs" className="underline">
            組織の一覧へ
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

async function Invitation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const parsed = idSchema.safeParse(id);
  const invitation = parsed.success
    ? await getInvitationForUser(userId, parsed.data, new Date())
    : null;

  if (!invitation) {
    const email = (await getSession())?.user.email;
    // 他人宛ての招待と存在しない招待を区別しない（組織名を漏らさない）
    return (
      <Message title="招待が見つかりません">
        <p>
          リンクが正しいか、招待メールを受け取ったメールアドレスのアカウントでログインしているかを確認してください。
        </p>
        {email && (
          <p className="text-muted-foreground">
            現在のアカウント：{email}
          </p>
        )}
      </Message>
    );
  }

  switch (invitation.state) {
    case "accepted":
      return (
        <Message title="この招待は受諾済みです">
          <p>
            <Link href={`/${invitation.slug}`} className="underline">
              {invitation.organizationName} を開く
            </Link>
          </p>
        </Message>
      );
    case "expired":
      return (
        <Message title="招待の有効期限が切れています">
          <p>
            {invitation.organizationName}
            の管理者に、もう一度招待するよう依頼してください。
          </p>
        </Message>
      );
    case "closed":
      return (
        <Message title="この招待は無効です">
          <p>辞退したか、管理者が招待を取り消しました。</p>
        </Message>
      );
    case "pending":
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{invitation.organizationName} への招待</h1>
            </CardTitle>
            <CardDescription>
              {invitation.inviterName} さんから{" "}
              {ROLE_LABELS[invitation.role]} として招待されています。
              有効期限：{dateFormat.format(invitation.expiresAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <form
              action={acceptInvitationAction.bind(
                null,
                invitation.id,
              )}
            >
              <Button type="submit">参加する</Button>
            </form>
            <form
              action={rejectInvitationAction.bind(
                null,
                invitation.id,
              )}
            >
              <Button type="submit" variant="outline">
                辞退する
              </Button>
            </form>
          </CardContent>
        </Card>
      );
  }
}

// S-05 招待の受諾
export default function InvitationPage({
  params,
}: PageProps<"/invitations/[id]">) {
  return (
    <Suspense
      fallback={<Skeleton className="h-40 w-full" aria-hidden />}
    >
      <Invitation params={params} />
    </Suspense>
  );
}
