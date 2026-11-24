/**
 * 料金プランとサブスクリプション（F-14・F-15、docs/billing.md）。
 * テスト用 DB を使う（npm run test:db）。Stripe の API キーは使わない：
 * - Webhook は、stripe パッケージの generateTestHeaderString で署名した
 *   イベントを Route Handler（POST /api/webhooks/stripe）に直接渡す
 * - Checkout・カスタマーポータルは、Stripe を呼ぶ部分（BillingGateway）を
 *   差し替えて、権限と組織の扱いだけを確かめる
 *
 * docs/authz-matrix.md のテストケース 5（Free プランで 3 人目の
 * スタッフを追加できない）もここで確かめる。
 *
 * このファイル専用のユーザーと組織を作り、最後に消す。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { getPrisma } from "@/server/db";
import { createInvitation } from "@/server/repositories/invitations";
import { createStaffProfile } from "@/server/repositories/members";
import { createMember } from "@/server/repositories/organizations";
import type { BillingGateway } from "@/server/stripe";
import {
  getBillingPage,
  openCustomerPortal,
  startProCheckout,
} from "@/server/services/billing";
import { acceptInvitation } from "@/server/services/invitations";
import { createLocation } from "@/server/services/locations";
import {
  getMembersPage,
  inviteMember,
} from "@/server/services/members";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import { createOrganization } from "@/server/services/organizations";
import { TEST_NOW } from "../../../test/db-fixture";
import {
  subscriptionEvent,
  TEST_PRO_PRICE_ID,
  TEST_WEBHOOK_SECRET,
  webhookRequest,
  type SubscriptionEventInput,
} from "../../../test/stripe-events";

const SLUG = "billing-test";
const CUSTOMER_ID = "cus_test_billing";
const users = {
  owner: "bill_owner",
  admin: "bill_admin",
  staff: "bill_staff",
  third: "bill_third",
  fourth: "bill_fourth",
} as const;
const emailOf = (userId: string) =>
  `${userId.replace(/_/g, "-")}@example.com`;

let organizationId = "";
const noDispatch = async () => {};

async function ctxOf(userId: string): Promise<OrgContext> {
  const ctx = await getOrgContext(SLUG, userId);
  if (!ctx) throw new Error(`組織に所属していない: ${userId}`);
  return ctx;
}

function subscriptionRow() {
  return getPrisma().subscription.findUnique({
    where: { organizationId },
  });
}

/** Stripe を呼ぶ代わりに、呼び出しを記録する */
function fakeGateway() {
  const calls = {
    customers: [] as { key: string; organizationId: string }[],
    checkouts: [] as Parameters<
      BillingGateway["createCheckoutSession"]
    >[0][],
    portals: [] as Parameters<
      BillingGateway["createPortalSession"]
    >[0][],
  };
  const gateway: BillingGateway = {
    async createCustomer(input, idempotencyKey) {
      calls.customers.push({
        key: idempotencyKey,
        organizationId: input.organizationId,
      });
      return { id: CUSTOMER_ID };
    },
    async createCheckoutSession(input) {
      calls.checkouts.push(input);
      return { url: "https://checkout.stripe.test/c/pay/cs_test_1" };
    },
    async createPortalSession(input) {
      calls.portals.push(input);
      return { url: "https://billing.stripe.test/p/session/test_1" };
    },
  };
  return { gateway, calls };
}

/** 招待を作り、受諾させる（招待のメールは送らない） */
async function inviteAndAccept(userId: string) {
  const invitation = await createInvitation({
    organizationId,
    email: emailOf(userId),
    role: "staff",
    inviterId: users.owner,
    expiresAt: new Date(TEST_NOW.getTime() + 48 * 3600 * 1000),
  });
  const result = await acceptInvitation(
    userId,
    invitation.id,
    TEST_NOW,
  );
  return { invitationId: invitation.id, result };
}

// イベントの作成日時。署名の時刻（今）とは別で、古くてもよい
const T0 = Math.floor(Date.now() / 1000) - 3600;
let sequence = 0;
function event(
  input: Partial<SubscriptionEventInput> &
    Pick<SubscriptionEventInput, "type" | "status" | "created">,
) {
  return subscriptionEvent({
    customerId: CUSTOMER_ID,
    subscriptionId: "sub_test_1",
    organizationId,
    id: `evt_billing_${++sequence}`,
    ...input,
  });
}

async function send(body: unknown) {
  const response = await POST(webhookRequest(body));
  return {
    status: response.status,
    body: (await response.json()) as { outcome?: string },
  };
}

const savedEnv = {
  secret: process.env.STRIPE_WEBHOOK_SECRET,
  price: process.env.STRIPE_PRICE_PRO,
};

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = TEST_PRO_PRICE_ID;
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
    { name: "課金テスト", slug: SLUG },
    TEST_NOW,
  );
  if (!created.ok) throw new Error(created.reason);
  organizationId = (
    await prisma.organization.findUniqueOrThrow({
      where: { slug: SLUG },
    })
  ).id;
  // Admin と Staff の 2 人が予約を担当する（Free の上限ちょうど）
  for (const [userId, role] of [
    [users.admin, "admin"],
    [users.staff, "staff"],
  ] as const) {
    const member = await createMember(
      { organizationId, userId, role },
      TEST_NOW,
    );
    await createStaffProfile({
      organizationId,
      memberId: member.id,
      displayName: userId,
    });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.stripeEvent.deleteMany({
    where: { id: { startsWith: "evt_billing_" } },
  });
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(users) } },
  });
  process.env.STRIPE_WEBHOOK_SECRET = savedEnv.secret;
  process.env.STRIPE_PRICE_PRO = savedEnv.price;
});

describe("ケース 5：Free プランで 3 人目のスタッフを追加できない", () => {
  it("スタッフが 2 人いると、招待できない", async () => {
    expect(
      await inviteMember(
        await ctxOf(users.owner),
        { email: emailOf(users.third), role: "staff" },
        TEST_NOW,
        noDispatch,
      ),
    ).toEqual({ ok: false, reason: "plan_limit" });
    expect(
      await getPrisma().invitation.count({
        where: { organizationId, email: emailOf(users.third) },
      }),
    ).toBe(0);
  });

  it("上限に達する前の招待も、受諾できない（招待は残る）", async () => {
    const { invitationId, result } = await inviteAndAccept(
      users.third,
    );
    expect(result).toEqual({ ok: false, reason: "plan_limit" });
    expect(await getOrgContext(SLUG, users.third)).toBeNull();
    const invitation = await getPrisma().invitation.findFirst({
      where: { id: invitationId, organizationId },
    });
    expect(invitation?.status).toBe("pending");
    expect(
      await getPrisma().staffProfile.count({
        where: { organizationId, active: true },
      }),
    ).toBe(2);
  });

  it("同時に 2 人が受諾しても、上限を超えない", async () => {
    // 1 人分を空ける（メンバーを削除するとスタッフ情報は無効になる）
    const staff = await ctxOf(users.staff);
    await getPrisma().staffProfile.updateMany({
      where: { organizationId, memberId: staff.memberId },
      data: { active: false },
    });
    const results = await Promise.all([
      inviteAndAccept(users.third),
      inviteAndAccept(users.fourth),
    ]);
    expect(results.filter((r) => r.result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (r) => !r.result.ok && r.result.reason === "plan_limit",
      ),
    ).toHaveLength(1);
    expect(
      await getPrisma().staffProfile.count({
        where: {
          organizationId,
          active: true,
          memberId: { not: null },
        },
      }),
    ).toBe(2);
    // 元に戻す：後から加わった方を外し、Staff を有効に戻す
    const joined = results.find((r) => r.result.ok);
    const joinedUser =
      joined === results[0] ? users.third : users.fourth;
    const prisma = getPrisma();
    const member = await prisma.member.findFirstOrThrow({
      where: { organizationId, userId: joinedUser },
    });
    await prisma.staffProfile.deleteMany({
      where: { organizationId, memberId: member.id },
    });
    await prisma.member.deleteMany({
      where: { organizationId, id: member.id },
    });
    await prisma.invitation.deleteMany({ where: { organizationId } });
    await prisma.staffProfile.updateMany({
      where: { organizationId, memberId: staff.memberId },
      data: { active: true },
    });
  });

  it("店舗は 1 つまで。Staff は店舗を作れない", async () => {
    const owner = await ctxOf(users.owner);
    expect(
      await createLocation(await ctxOf(users.staff), {
        name: "本店",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      (
        await createLocation(owner, {
          name: "本店",
          timezone: "Asia/Tokyo",
        })
      ).ok,
    ).toBe(true);
    expect(
      await createLocation(await ctxOf(users.admin), {
        name: "2 号店",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "plan_limit" });
    expect(
      await getPrisma().location.count({ where: { organizationId } }),
    ).toBe(1);
  });

  it("Owner・Admin はメンバー管理で上限の使用状況を見られる。Staff には出さない", async () => {
    expect(
      (await getMembersPage(await ctxOf(users.admin), TEST_NOW))
        .planUsage,
    ).toMatchObject({ plan: "free", staff: 2, maxStaff: 2 });
    expect(
      (await getMembersPage(await ctxOf(users.staff), TEST_NOW))
        .planUsage,
    ).toBeNull();
  });
});

describe("Checkout とカスタマーポータル（S-14、Owner のみ）", () => {
  it("Admin・Staff は申し込めず、ポータルも開けない。Stripe も呼ばない", async () => {
    const { gateway, calls } = fakeGateway();
    for (const userId of [users.admin, users.staff]) {
      const ctx = await ctxOf(userId);
      expect(await startProCheckout(ctx, gateway)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(await openCustomerPortal(ctx, gateway)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect((await getBillingPage(ctx, gateway)).ok).toBe(false);
    }
    expect(calls).toEqual({
      customers: [],
      checkouts: [],
      portals: [],
    });
  });

  it("Stripe の設定がなければ billing_unavailable", async () => {
    const ctx = await ctxOf(users.owner);
    expect(await startProCheckout(ctx, null)).toEqual({
      ok: false,
      reason: "billing_unavailable",
    });
    const page = await getBillingPage(ctx, null);
    expect(page).toMatchObject({
      ok: true,
      value: { configured: false, canCheckout: false },
    });
  });

  it("申し込む前はポータルを開けない", async () => {
    const { gateway } = fakeGateway();
    expect(
      await openCustomerPortal(await ctxOf(users.owner), gateway),
    ).toEqual({ ok: false, reason: "no_billing_account" });
  });

  it("Owner は Checkout に進める。顧客は組織に 1 人だけ作り、プランは Webhook まで変えない", async () => {
    const { gateway, calls } = fakeGateway();
    const ctx = await ctxOf(users.owner);
    const first = await startProCheckout(ctx, gateway);
    expect(first).toEqual({
      ok: true,
      value: { url: "https://checkout.stripe.test/c/pay/cs_test_1" },
    });
    expect(calls.customers).toEqual([
      {
        key: `flowdesk-customer:${organizationId}`,
        organizationId,
      },
    ]);
    expect(calls.checkouts[0]).toMatchObject({
      customerId: CUSTOMER_ID,
      organizationId,
    });
    expect(calls.checkouts[0]?.successUrl).toContain(
      `/${SLUG}/billing?checkout=success`,
    );
    expect(await subscriptionRow()).toMatchObject({
      stripeCustomerId: CUSTOMER_ID,
      plan: "free",
      status: "none",
    });

    // 2 回目は、作った顧客を使う
    expect((await startProCheckout(ctx, gateway)).ok).toBe(true);
    expect(calls.customers).toHaveLength(1);

    expect(await openCustomerPortal(ctx, gateway)).toEqual({
      ok: true,
      value: { url: "https://billing.stripe.test/p/session/test_1" },
    });
    expect(calls.portals[0]).toMatchObject({
      customerId: CUSTOMER_ID,
    });
  });
});

describe("Webhook（/api/webhooks/stripe）", () => {
  it("署名が不正なら 400 で、何も記録しない", async () => {
    const body = event({
      type: "customer.subscription.updated",
      status: "active",
      created: T0,
    });
    const wrongSecret = await POST(
      webhookRequest(body, { secret: "whsec_wrong" }),
    );
    expect(wrongSecret.status).toBe(400);
    const tampered = await POST(
      webhookRequest(body, {
        tamper: (p) => p.replace(CUSTOMER_ID, "cus_attacker"),
      }),
    );
    expect(tampered.status).toBe(400);
    const unsigned = await POST(
      new Request("http://localhost:3000/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(unsigned.status).toBe(400);
    expect(
      await getPrisma().stripeEvent.count({ where: { id: body.id } }),
    ).toBe(0);
    expect((await subscriptionRow())?.plan).toBe("free");
  });

  it("申し込み（incomplete → active）で Pro になり、監査ログに残る", async () => {
    expect(
      await send(
        event({
          type: "customer.subscription.created",
          status: "incomplete",
          created: T0,
        }),
      ),
    ).toEqual({
      status: 200,
      body: { received: true, outcome: "applied" },
    });
    expect((await subscriptionRow())?.plan).toBe("free");

    const activated = event({
      type: "customer.subscription.updated",
      status: "active",
      created: T0 + 10,
      periodEnd: T0 + 30 * 24 * 3600,
    });
    expect((await send(activated)).body.outcome).toBe("applied");
    expect(await subscriptionRow()).toMatchObject({
      plan: "pro",
      status: "active",
      stripeSubscriptionId: "sub_test_1",
      stripePriceId: TEST_PRO_PRICE_ID,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date((T0 + 30 * 24 * 3600) * 1000),
    });
    const log = await getPrisma().auditLog.findFirst({
      where: {
        organizationId,
        action: "subscription.update",
        diff: { path: ["eventId"], equals: activated.id },
      },
    });
    expect(log).toMatchObject({
      actorUserId: "system:stripe",
      diff: {
        from: { plan: "free", status: "incomplete" },
        to: { plan: "pro", status: "active" },
      },
    });
  });

  it("同じイベントが 2 回届いても、処理は 1 回（2 回目は 200 で何もしない）", async () => {
    const body = event({
      type: "customer.subscription.updated",
      status: "past_due",
      created: T0 + 20,
    });
    expect((await send(body)).body.outcome).toBe("applied");
    expect(await send(body)).toEqual({
      status: 200,
      body: { received: true, outcome: "duplicate" },
    });
    expect(
      await getPrisma().auditLog.count({
        where: {
          organizationId,
          action: "subscription.update",
          diff: { path: ["eventId"], equals: body.id },
        },
      }),
    ).toBe(1);
    expect(
      await getPrisma().stripeEvent.findUnique({
        where: { id: body.id },
      }),
    ).toMatchObject({ result: "applied", organizationId });
  });

  it("同じイベントが同時に届いても、処理は 1 回", async () => {
    const body = event({
      type: "customer.subscription.updated",
      status: "active",
      created: T0 + 30,
    });
    const outcomes = (
      await Promise.all([send(body), send(body), send(body)])
    ).map((r) => r.body.outcome);
    expect(outcomes.sort()).toEqual([
      "applied",
      "duplicate",
      "duplicate",
    ]);
    expect((await subscriptionRow())?.status).toBe("active");
  });

  it("Pro になると、3 人目のスタッフを追加できる", async () => {
    const { result } = await inviteAndAccept(users.third);
    expect(result).toEqual({ ok: true, value: { slug: SLUG } });
    expect(
      (await getMembersPage(await ctxOf(users.owner), TEST_NOW))
        .planUsage,
    ).toMatchObject({ plan: "pro", staff: 3, maxStaff: null });
  });

  it("順番が入れ替わって古いイベントが後から届いても、新しい状態を保つ", async () => {
    // ポータルで解約を予約した（新しい）イベントが先に届き、
    // その前の更新（古い）イベントが後から届く
    const newer = event({
      type: "customer.subscription.updated",
      status: "active",
      cancelAtPeriodEnd: true,
      created: T0 + 50,
    });
    const older = event({
      type: "customer.subscription.updated",
      status: "active",
      cancelAtPeriodEnd: false,
      created: T0 + 40,
    });
    expect((await send(newer)).body.outcome).toBe("applied");
    expect(await send(older)).toEqual({
      status: 200,
      body: { received: true, outcome: "stale" },
    });
    expect(await subscriptionRow()).toMatchObject({
      plan: "pro",
      cancelAtPeriodEnd: true,
      lastEventAt: new Date((T0 + 50) * 1000),
    });
  });

  it("解約（deleted）の後に古い更新が届いても、Pro に戻らない", async () => {
    expect(
      (
        await send(
          event({
            type: "customer.subscription.deleted",
            status: "canceled",
            created: T0 + 70,
          }),
        )
      ).body.outcome,
    ).toBe("applied");
    expect(
      (
        await send(
          event({
            type: "customer.subscription.updated",
            status: "active",
            created: T0 + 60,
          }),
        )
      ).body.outcome,
    ).toBe("stale");
    // 同じ秒に作られた「有効」のイベントでも、解約済みは戻さない
    expect(
      (
        await send(
          event({
            type: "customer.subscription.updated",
            status: "active",
            created: T0 + 70,
          }),
        )
      ).body.outcome,
    ).toBe("stale");
    expect(await subscriptionRow()).toMatchObject({
      plan: "free",
      status: "canceled",
    });
  });

  it("Free に戻ると、上限を超えたスタッフはそのままで、追加だけできない", async () => {
    expect(
      (await getMembersPage(await ctxOf(users.owner), TEST_NOW))
        .planUsage,
    ).toMatchObject({ plan: "free", staff: 3, maxStaff: 2 });
    expect(await getOrgContext(SLUG, users.third)).not.toBeNull();
    expect((await inviteAndAccept(users.fourth)).result).toEqual({
      ok: false,
      reason: "plan_limit",
    });
  });

  it("対象外のイベント・知らない顧客・組織の食い違いは、200 で記録だけする", async () => {
    const unknownType = {
      ...event({
        type: "customer.subscription.updated",
        status: "active",
        created: T0 + 80,
      }),
      type: "invoice.paid",
    };
    const unknownCustomer = event({
      type: "customer.subscription.updated",
      status: "active",
      created: T0 + 80,
      customerId: "cus_someone_else",
    });
    const otherOrg = event({
      type: "customer.subscription.updated",
      status: "active",
      created: T0 + 80,
      organizationId: "org_a",
    });
    for (const body of [unknownType, unknownCustomer, otherOrg]) {
      expect(await send(body)).toEqual({
        status: 200,
        body: { received: true, outcome: "ignored" },
      });
    }
    expect((await subscriptionRow())?.plan).toBe("free");
    // シードの組織（org_a）は変わらない
    expect(
      await getPrisma().subscription.count({
        where: { organizationId: "org_a" },
      }),
    ).toBe(0);
  });

  it("処理に失敗したら 500 で、イベントの記録も残さない（Stripe の再送で処理し直す）", async () => {
    const broken = event({
      type: "customer.subscription.updated",
      status: "active",
      created: T0 + 90,
    });
    // items がないサブスクリプション（反映の途中で例外になる）
    const body = {
      ...broken,
      data: { object: { ...broken.data.object, items: undefined } },
    };
    const response = await POST(webhookRequest(body));
    expect(response.status).toBe(500);
    expect(
      await getPrisma().stripeEvent.count({ where: { id: body.id } }),
    ).toBe(0);
    expect((await subscriptionRow())?.status).toBe("canceled");
  });
});
