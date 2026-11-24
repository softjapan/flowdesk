import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
import { formatTime, toZonedYmd } from "@/lib/datetime";
import { ROLE_LABELS } from "@/server/domain";
import { getMembersPage } from "@/server/services/members";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import {
  cancelInvitationAction,
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
} from "./actions";
import {
  ConfirmButton,
  InviteForm,
  RoleForm,
} from "./_components/member-forms";

// S-13 メンバー管理（招待・ロール変更・削除）
export default async function MembersPage({
  params,
}: PageProps<"/[org]/members">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const page = await getMembersPage(ctx, new Date());
  const at = (d: Date) =>
    `${toZonedYmd(d, ctx.timezone)} ${formatTime(d, ctx.timezone)}`;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">メンバー管理</h1>

      <section className="space-y-3" aria-labelledby="members-title">
        <h2 id="members-title" className="font-semibold">
          メンバー（{page.members.length} 人）
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>氏名</TableHead>
              <TableHead>メール</TableHead>
              <TableHead>ロール</TableHead>
              <TableHead>参加日</TableHead>
              <TableHead>
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  {m.name}
                  {m.isSelf && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      （自分）
                    </span>
                  )}
                </TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  {m.roleOptions.length > 0 ? (
                    <RoleForm
                      action={changeRoleAction.bind(
                        null,
                        ctx.slug,
                        m.id,
                      )}
                      memberName={m.name}
                      current={m.role}
                      options={m.roleOptions}
                    />
                  ) : (
                    <Badge variant="outline">
                      {ROLE_LABELS[m.role]}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {toZonedYmd(m.joinedAt, ctx.timezone)}
                </TableCell>
                <TableCell>
                  {m.canRemove && (
                    <ConfirmButton
                      action={removeMemberAction.bind(
                        null,
                        ctx.slug,
                        m.id,
                      )}
                      label={m.isSelf ? "組織から抜ける" : "削除"}
                      pendingLabel="削除しています…"
                      confirmMessage={
                        m.isSelf
                          ? "この組織から抜けますか？もう一度参加するには招待が必要です。"
                          : `${m.name} さんを組織から削除しますか？担当した予約の履歴は残ります。`
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Admin が変更できるのは Staff と Admin
          のロールだけで、削除できるのは Staff だけです。組織には
          Owner が 1 人以上必要です。
        </p>
        {page.planUsage && (
          <p className="text-xs text-muted-foreground">
            {page.planUsage.label} プラン：スタッフ{" "}
            {page.planUsage.maxStaff === null
              ? `${page.planUsage.staff} 人（上限なし）`
              : `${page.planUsage.staff} / ${page.planUsage.maxStaff} 人`}
            。上限に達すると、招待と招待の受諾ができません
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

      {page.inviteRoles.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id="invite-title">メンバーを招待する</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InviteForm
                action={inviteMemberAction.bind(null, ctx.slug)}
                roles={page.inviteRoles}
              />
            </CardContent>
          </Card>

          <section
            className="space-y-3"
            aria-labelledby="invitations-title"
          >
            <h2 id="invitations-title" className="font-semibold">
              招待中（{page.invitations.length} 件）
            </h2>
            {page.invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                受諾を待っている招待はありません。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>メール</TableHead>
                    <TableHead>ロール</TableHead>
                    <TableHead>招待した人</TableHead>
                    <TableHead>有効期限</TableHead>
                    <TableHead>
                      <span className="sr-only">操作</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.invitations.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.email}</TableCell>
                      <TableCell>{ROLE_LABELS[i.role]}</TableCell>
                      <TableCell>{i.inviterName}</TableCell>
                      <TableCell className="tabular-nums">
                        {at(i.expiresAt)}
                      </TableCell>
                      <TableCell>
                        {i.canCancel && (
                          <ConfirmButton
                            action={cancelInvitationAction.bind(
                              null,
                              ctx.slug,
                              i.id,
                            )}
                            label="取り消す"
                            pendingLabel="取り消しています…"
                            confirmMessage={`${i.email} への招待を取り消しますか？`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
