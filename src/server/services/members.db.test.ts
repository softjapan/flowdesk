/**
 * 組織・招待・メンバー管理・監査ログのテスト（F-03・F-04・F-16、
 * docs/authz-matrix.md の「テストで必ず確認するケース」3・4・6）。
 * テスト用 DB を使う（npm run test:db）。
 *
 * シードの組織を変えないよう、このファイル専用のユーザーと組織を作り、
 * 最後に消す（組織を消すとメンバー・招待・監査ログも消える）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { getPrisma } from "@/server/db";
import type { Role } from "@/server/domain";
import { createMember } from "@/server/repositories/organizations";
import { listAuditLogs } from "@/server/services/audit-logs";
import {
  acceptInvitation,
  getInvitationForUser,
  rejectInvitation,
} from "@/server/services/invitations";
import {
  cancelInvitation,
  changeMemberRole,
  getMembersPage,
  inviteMember,
  removeMember,
} from "@/server/services/members";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import { createOrganization } from "@/server/services/organizations";
import { TEST_NOW } from "../../../test/db-fixture";

const SLUG = "rbac-test";
const users = {
  owner: "rbac_owner",
  owner2: "rbac_owner2",
  admin: "rbac_admin",
  admin2: "rbac_admin2",
  staff: "rbac_staff",
  staff2: "rbac_staff2",
  invitee: "rbac_invitee",
  invitee2: "rbac_invitee2",
  inviter: "rbac_inviter",
  stranger: "rbac_stranger",
} as const;
const emailOf = (userId: string) =>
  `${userId.replace(/_/g, "-")}@example.com`;

let organizationId = "";
const memberIds: Partial<Record<keyof typeof users, string>> = {};

async function ctxOf(userId: string): Promise<OrgContext> {
  const ctx = await getOrgContext(SLUG, userId);
  if (!ctx) throw new Error(`組織に所属していない: ${userId}`);
  return ctx;
}

async function roleOf(memberId: string): Promise<string | undefined> {
  const row = await getPrisma().member.findFirst({
    where: { id: memberId, organizationId },
  });
  return row?.role;
}

async function setRole(memberId: string, role: Role) {
  await getPrisma().member.updateMany({
    where: { id: memberId, organizationId },
    data: { role },
  });
}

async function auditCount(action: string, targetId: string) {
  return getPrisma().auditLog.count({
    where: { organizationId, action, targetId },
  });
}

function memberId(key: keyof typeof users): string {
  const id = memberIds[key];
  if (!id) throw new Error(`メンバーがいない: ${key}`);
  return id;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.user.createMany({
    data: Object.values(users).map((id) => ({
      id,
      name: `テスト ${id}`,
      email: emailOf(id),
      emailVerified: true,
    })),
  });
  const created = await createOrganization(
    users.owner,
    { name: "権限テスト", slug: SLUG },
    TEST_NOW,
  );
  if (!created.ok) throw new Error(created.reason);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { slug: SLUG },
  });
  organizationId = org.id;
  const owner = await prisma.member.findFirstOrThrow({
    where: { organizationId, userId: users.owner },
  });
  memberIds.owner = owner.id;
  const setup: [keyof typeof users, Role][] = [
    ["owner2", "staff"], // 必要なテストで Owner にする
    ["admin", "admin"],
    ["admin2", "admin"],
    ["staff", "staff"],
    ["staff2", "staff"],
  ];
  for (const [key, role] of setup) {
    const m = await createMember(
      { organizationId, userId: users[key], role },
      TEST_NOW,
    );
    memberIds[key] = m.id;
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(users) } },
  });
});

describe("組織の作成（S-04）", () => {
  it("作った人が Owner になり、監査ログに残る", async () => {
    expect((await ctxOf(users.owner)).role).toBe("owner");
    expect(
      await getPrisma().auditLog.count({
        where: {
          organizationId,
          action: "organization.create",
          actorUserId: users.owner,
        },
      }),
    ).toBe(1);
  });

  it("使われているスラッグでは作れない", async () => {
    expect(
      await createOrganization(
        users.stranger,
        { name: "重複", slug: SLUG },
        TEST_NOW,
      ),
    ).toEqual({ ok: false, reason: "slug_taken" });
    expect(
      await createOrganization(
        users.stranger,
        { name: "重複", slug: "demo-salon" },
        TEST_NOW,
      ),
    ).toEqual({ ok: false, reason: "slug_taken" });
  });
});

describe("ケース 3：Admin は自分を Owner に昇格できない", () => {
  it("自分を Owner にしようとすると forbidden で、ロールも監査ログも変わらない", async () => {
    const id = memberId("admin");
    expect(
      await changeMemberRole(await ctxOf(users.admin), id, "owner"),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await roleOf(id)).toBe("admin");
    expect(await auditCount("member.update_role", id)).toBe(0);
  });

  it("他の人を Owner にすることも、Owner を降格することもできない", async () => {
    const ctx = await ctxOf(users.admin);
    expect(
      await changeMemberRole(ctx, memberId("staff"), "owner"),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await changeMemberRole(ctx, memberId("owner"), "admin"),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await roleOf(memberId("owner"))).toBe("owner");
  });

  it("Admin は Staff⇔Admin を変更でき、監査ログに変更前後が残る（ケース 6）", async () => {
    const ctx = await ctxOf(users.admin);
    const id = memberId("staff2");
    expect(await changeMemberRole(ctx, id, "admin")).toEqual({
      ok: true,
      value: { id },
    });
    expect(await roleOf(id)).toBe("admin");
    const log = await getPrisma().auditLog.findFirst({
      where: {
        organizationId,
        action: "member.update_role",
        targetId: id,
      },
    });
    expect(log).toMatchObject({
      actorUserId: users.admin,
      targetType: "member",
      diff: { userId: users.staff2, from: "staff", to: "admin" },
    });
    expect((await changeMemberRole(ctx, id, "staff")).ok).toBe(true);
    expect(await roleOf(id)).toBe("staff");
  });

  it("Staff はロールを変更できない", async () => {
    expect(
      await changeMemberRole(
        await ctxOf(users.staff),
        memberId("staff"),
        "admin",
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("ケース 4：最後の Owner は削除・降格できない", () => {
  it("Owner が 1 人なら、自分を降格も削除もできない", async () => {
    const ctx = await ctxOf(users.owner);
    const id = memberId("owner");
    expect(await changeMemberRole(ctx, id, "admin")).toEqual({
      ok: false,
      reason: "last_owner",
    });
    expect(await removeMember(ctx, id)).toEqual({
      ok: false,
      reason: "last_owner",
    });
    expect(await roleOf(id)).toBe("owner");
    expect(await auditCount("member.update_role", id)).toBe(0);
  });

  it("Admin は Owner を削除できない", async () => {
    expect(
      await removeMember(await ctxOf(users.admin), memberId("owner")),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("Owner が 2 人なら降格できる。同時にお互いを降格しても Owner は残る", async () => {
    const owner = memberId("owner");
    const owner2 = memberId("owner2");
    const ctx = await ctxOf(users.owner);
    expect((await changeMemberRole(ctx, owner2, "owner")).ok).toBe(
      true,
    );
    const ctx2 = await ctxOf(users.owner2);
    const results = await Promise.all([
      changeMemberRole(ctx, owner2, "admin"),
      changeMemberRole(ctx2, owner, "admin"),
    ]);
    // 先に通った方で Owner が 1 人になり、後の方は last_owner か、
    // 自分が降格済みで forbidden になる
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await getPrisma().member.count({
        where: { organizationId, role: "owner" },
      }),
    ).toBe(1);
    // 元に戻す
    await setRole(owner, "owner");
    await setRole(owner2, "staff");
  });

  it("Owner が 2 人なら、Owner を削除できる", async () => {
    const owner2 = memberId("owner2");
    await setRole(owner2, "owner");
    const result = await removeMember(
      await ctxOf(users.owner),
      owner2,
    );
    expect(result).toEqual({
      ok: true,
      value: { id: owner2, removedSelf: false },
    });
    // 戻す（削除したので作り直す）
    const m = await createMember(
      { organizationId, userId: users.owner2, role: "staff" },
      TEST_NOW,
    );
    memberIds.owner2 = m.id;
  });
});

describe("メンバーの削除（F-04）", () => {
  it("Admin は Admin を削除できない", async () => {
    expect(
      await removeMember(
        await ctxOf(users.admin),
        memberId("admin2"),
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("Admin は Staff を削除でき、スタッフ情報と担当の予約は残る", async () => {
    const prisma = getPrisma();
    const id = memberId("staff2");
    const profile = await prisma.staffProfile.create({
      data: {
        organizationId,
        memberId: id,
        displayName: "削除される人",
      },
    });
    expect(
      await removeMember(await ctxOf(users.admin), id),
    ).toMatchObject({ ok: true });
    expect(
      await prisma.member.count({ where: { id, organizationId } }),
    ).toBe(0);
    expect(
      await prisma.staffProfile.findFirst({
        where: { id: profile.id, organizationId },
      }),
    ).toMatchObject({ memberId: null, active: false });
    const log = await prisma.auditLog.findFirst({
      where: {
        organizationId,
        action: "member.remove",
        targetId: id,
      },
    });
    expect(log?.diff).toEqual({
      userId: users.staff2,
      role: "staff",
    });
    // 削除したユーザーは組織を開けない
    expect(await getOrgContext(SLUG, users.staff2)).toBeNull();
  });

  it("他の組織のメンバー ID は not_found（存在を漏らさない）", async () => {
    const other = await getOrgContext("other-office", "user_c0");
    if (!other) throw new Error("シードの組織がない");
    expect(
      await changeMemberRole(other, memberId("staff"), "admin"),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await removeMember(other, memberId("staff"))).toEqual({
      ok: false,
      reason: "not_found",
    });
    // 自分の組織から、他の組織のメンバー（シードの mem_c0）も同じ
    expect(
      await removeMember(await ctxOf(users.owner), "mem_c0"),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await roleOf(memberId("staff"))).toBe("staff");
  });
});

describe("招待（F-03）", () => {
  // メールは Worker が送る。ここではキューに送られたジョブ ID を記録し、
  // 依頼されたメール（job の payload）を DB から読む
  const dispatched: string[] = [];
  const send = async (jobIds: string[]) => {
    dispatched.push(...jobIds);
  };
  async function queuedMail(jobId: string | undefined) {
    const job = await getPrisma().job.findUnique({
      where: { id: jobId ?? "" },
    });
    return job?.payload as
      { to: string; subject: string; text: string } | undefined;
  }
  const inviteeEmail = emailOf(users.invitee);

  it("Admin は Owner を招待できない。Staff は招待できない", async () => {
    expect(
      await inviteMember(
        await ctxOf(users.admin),
        { email: inviteeEmail, role: "owner" },
        TEST_NOW,
        send,
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await inviteMember(
        await ctxOf(users.staff),
        { email: inviteeEmail, role: "staff" },
        TEST_NOW,
        send,
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(dispatched).toHaveLength(0);
  });

  it("すでにメンバーのアドレスは招待できない", async () => {
    expect(
      await inviteMember(
        await ctxOf(users.owner),
        { email: emailOf(users.staff), role: "admin" },
        TEST_NOW,
        send,
      ),
    ).toEqual({ ok: false, reason: "already_member" });
  });

  it("招待するとメールが送られ、本人だけが受諾できる", async () => {
    const result = await inviteMember(
      await ctxOf(users.admin),
      { email: inviteeEmail, role: "staff" },
      TEST_NOW,
      send,
    );
    if (!result.ok) throw new Error(result.reason);
    const { id } = result.value;
    expect(dispatched).toHaveLength(1);
    const mail = await queuedMail(dispatched.at(-1));
    expect(mail?.to).toBe(inviteeEmail);
    expect(mail?.text).toContain(`/invitations/${id}`);
    expect(await auditCount("invitation.create", id)).toBe(1);

    // 他人宛ての招待は見えず、受諾もできない
    expect(
      await getInvitationForUser(users.stranger, id, TEST_NOW),
    ).toBeNull();
    expect(
      await acceptInvitation(users.stranger, id, TEST_NOW),
    ).toEqual({ ok: false, reason: "not_found" });
    // 有効期限（48 時間）を過ぎると受諾できない
    const later = new Date(TEST_NOW.getTime() + 49 * 60 * 60 * 1000);
    expect(
      (await getInvitationForUser(users.invitee, id, later))?.state,
    ).toBe("expired");
    expect(await acceptInvitation(users.invitee, id, later)).toEqual({
      ok: false,
      reason: "not_found",
    });

    expect(
      await getInvitationForUser(users.invitee, id, TEST_NOW),
    ).toMatchObject({ slug: SLUG, role: "staff", state: "pending" });
    expect(
      await acceptInvitation(users.invitee, id, TEST_NOW),
    ).toEqual({ ok: true, value: { slug: SLUG } });
    const ctx = await ctxOf(users.invitee);
    expect(ctx.role).toBe("staff");
    // 予約の担当に選べるよう、スタッフ情報も作られる
    expect(
      await getPrisma().staffProfile.count({
        where: {
          organizationId,
          memberId: ctx.memberId,
          active: true,
        },
      }),
    ).toBe(1);
    expect(await auditCount("member.add", ctx.memberId)).toBe(1);
    // 2 回目は受諾できない
    expect(
      await acceptInvitation(users.invitee, id, TEST_NOW),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("招待し直すと前の招待は無効になり、取り消した招待は受諾できない", async () => {
    const ctx = await ctxOf(users.owner);
    const email = emailOf(users.stranger);
    const first = await inviteMember(
      ctx,
      { email, role: "admin" },
      TEST_NOW,
      send,
    );
    const second = await inviteMember(
      ctx,
      { email, role: "staff" },
      TEST_NOW,
      send,
    );
    if (!first.ok || !second.ok) throw new Error("招待できない");
    expect(
      (
        await getInvitationForUser(
          users.stranger,
          first.value.id,
          TEST_NOW,
        )
      )?.state,
    ).toBe("closed");

    // Staff の一覧には招待を出さない
    expect(
      (await getMembersPage(await ctxOf(users.staff), TEST_NOW))
        .invitations,
    ).toEqual([]);
    expect(
      (await getMembersPage(ctx, TEST_NOW)).invitations.map(
        (i) => i.email,
      ),
    ).toEqual([email]);

    expect(
      await cancelInvitation(
        await ctxOf(users.staff),
        second.value.id,
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect((await cancelInvitation(ctx, second.value.id)).ok).toBe(
      true,
    );
    expect(
      await acceptInvitation(
        users.stranger,
        second.value.id,
        TEST_NOW,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await getOrgContext(SLUG, users.stranger)).toBeNull();
  });

  it("辞退した招待は受諾できない", async () => {
    const result = await inviteMember(
      await ctxOf(users.owner),
      { email: emailOf(users.stranger), role: "staff" },
      TEST_NOW,
      send,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(
      (
        await rejectInvitation(
          users.stranger,
          result.value.id,
          TEST_NOW,
        )
      ).ok,
    ).toBe(true);
    expect(
      await acceptInvitation(
        users.stranger,
        result.value.id,
        TEST_NOW,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  // 第14章のセキュリティレビューで見つかった：招待した Admin を削除・
  // 降格しても、その人が出した Admin の招待で 48 時間は加入できた
  it("招待した人が降格・削除されたら、その人の招待では加入できない", async () => {
    const email = emailOf(users.invitee2);
    const demoted = await inviteMember(
      await ctxOf(users.admin2),
      { email, role: "admin" },
      TEST_NOW,
      send,
    );
    if (!demoted.ok) throw new Error(demoted.reason);
    await setRole(memberId("admin2"), "staff");
    try {
      expect(
        (
          await getInvitationForUser(
            users.invitee2,
            demoted.value.id,
            TEST_NOW,
          )
        )?.state,
      ).toBe("closed");
      expect(
        await acceptInvitation(
          users.invitee2,
          demoted.value.id,
          TEST_NOW,
        ),
      ).toEqual({ ok: false, reason: "not_found" });
      expect(await getOrgContext(SLUG, users.invitee2)).toBeNull();
    } finally {
      await setRole(memberId("admin2"), "admin");
    }
    // ロールが戻れば（今も招待できるなら）受諾できる状態に戻る
    expect(
      (
        await getInvitationForUser(
          users.invitee2,
          demoted.value.id,
          TEST_NOW,
        )
      )?.state,
    ).toBe("pending");

    // 招待した人を削除した場合（招待し直すと前の招待は閉じる）
    const inviter = await createMember(
      { organizationId, userId: users.inviter, role: "admin" },
      TEST_NOW,
    );
    const removed = await inviteMember(
      await ctxOf(users.inviter),
      { email, role: "admin" },
      TEST_NOW,
      send,
    );
    if (!removed.ok) throw new Error(removed.reason);
    expect(
      (await removeMember(await ctxOf(users.owner), inviter.id)).ok,
    ).toBe(true);
    expect(
      (
        await getInvitationForUser(
          users.invitee2,
          removed.value.id,
          TEST_NOW,
        )
      )?.state,
    ).toBe("closed");
    expect(
      await acceptInvitation(
        users.invitee2,
        removed.value.id,
        TEST_NOW,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await getOrgContext(SLUG, users.invitee2)).toBeNull();
  });

  it("キューに送れなくても、招待とメールの依頼は残る（Worker が送り直す）", async () => {
    const result = await inviteMember(
      await ctxOf(users.owner),
      { email: "nobody@example.com", role: "staff" },
      TEST_NOW,
      async () => {
        throw new Error("SQS に接続できない");
      },
    ).catch((error: unknown) => error);
    // dispatchJobs は失敗を例外にしないが、差し替えた関数が投げても
    // 招待とメールの依頼はコミット済み
    expect(result).toBeInstanceOf(Error);
    const job = await getPrisma().job.findFirst({
      where: {
        organizationId,
        type: "mail.send",
        payload: { path: ["to"], equals: "nobody@example.com" },
      },
    });
    expect(job?.status).toBe("queued");
    expect(job?.publishedAt).toBeNull();
  });
});

describe("監査ログの閲覧（S-15）", () => {
  it("Staff は閲覧できない", async () => {
    expect(await listAuditLogs(await ctxOf(users.staff), {})).toEqual(
      {
        ok: false,
        reason: "forbidden",
      },
    );
  });

  it("権限の変更を、対象と操作者で絞り込んで見られる", async () => {
    const result = await listAuditLogs(await ctxOf(users.owner), {
      target: "member",
      actor: users.admin,
    });
    if (!result.ok) throw new Error(result.reason);
    const roleChanges = result.value.items.filter(
      (i) => i.action === "member.update_role",
    );
    expect(roleChanges.map((i) => i.summary)).toContain(
      `テスト ${users.staff2}：Staff → Admin`,
    );
    expect(
      result.value.items.every(
        (i) =>
          i.targetLabel === "メンバー" &&
          i.actorName === `テスト ${users.admin}`,
      ),
    ).toBe(true);
  });

  it("他の組織の監査ログは含まれない", async () => {
    const result = await listAuditLogs(await ctxOf(users.owner), {});
    if (!result.ok) throw new Error(result.reason);
    const ids = result.value.items.map((i) => i.id);
    expect(
      await getPrisma().auditLog.count({
        where: { id: { in: ids }, NOT: { organizationId } },
      }),
    ).toBe(0);
  });

  it("期間で絞り込める（未来の期間なら 0 件）", async () => {
    const result = await listAuditLogs(await ctxOf(users.owner), {
      from: "2099-01-01",
    });
    expect(result).toMatchObject({ ok: true, value: { total: 0 } });
  });
});

describe("Better Auth の organization の HTTP の入口", () => {
  it("ロール変更・削除・招待の入口は閉じてある（Service を通さない変更を防ぐ）", async () => {
    for (const path of [
      "update-member-role",
      "remove-member",
      "invite-member",
      "accept-invitation",
      "create",
    ]) {
      const response = await getAuth().handler(
        new Request(
          `http://localhost:3000/api/auth/organization/${path}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              memberId: memberId("admin"),
              role: "owner",
              organizationId,
            }),
          },
        ),
      );
      expect(response.status).toBe(404);
    }
    expect(await roleOf(memberId("admin"))).toBe("admin");
  });
});
