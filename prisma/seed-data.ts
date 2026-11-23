/**
 * シードの内容（第5章のデモデータをそのまま DB に入れる）。
 * テーブルの形は docs/er.md に合わせる。
 *
 * 予約は「基準日」からの相対日で定義し、buildSeedData(now) の now の日付で
 * 実体化する。開発用 DB は投入した日、テスト用 DB は固定の日付を基準にする。
 *
 * node で直接実行するので、import は相対パスで .ts まで書く。
 */
import {
  addDays,
  toZonedYmd,
  zonedToUtc,
} from "../src/lib/datetime.ts";
import type {
  ReservationStatus,
  Role,
} from "../src/server/domain.ts";
import { hashPassword } from "better-auth/crypto";
import {
  DEMO_USER_ID,
  DEMO_USER_PASSWORD,
} from "../src/server/demo-user.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";

export type Organization = { id: string; name: string; slug: string };
export type Member = {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
};
export type StaffProfile = {
  id: string;
  organizationId: string;
  memberId: string;
  displayName: string;
  active: boolean;
};
export type Location = {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
};
export type Service = {
  id: string;
  organizationId: string;
  name: string;
  durationMinutes: number;
  priceYen: number;
};
export type Customer = {
  id: string;
  organizationId: string;
  name: string;
  nameKana: string;
  email: string;
  phone: string;
  note: string;
  deletedAt: Date | null;
};
export type Reservation = {
  id: string;
  organizationId: string;
  locationId: string;
  staffProfileId: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  priceYen: number;
  version: number;
};

const organizations: Organization[] = [
  { id: "org_a", name: "デモサロン", slug: "demo-salon" },
  { id: "org_b", name: "さくら整体院", slug: "sakura-seitai" },
  // デモユーザーが所属しない組織（URL で指定しても 404 になる）
  { id: "org_c", name: "よその相談室", slug: "other-office" },
];

const members: Member[] = [
  {
    id: "mem_a0",
    organizationId: "org_a",
    userId: DEMO_USER_ID,
    role: "owner",
  },
  {
    id: "mem_a1",
    organizationId: "org_a",
    userId: "user_a1",
    role: "admin",
  },
  {
    id: "mem_a2",
    organizationId: "org_a",
    userId: "user_a2",
    role: "staff",
  },
  {
    id: "mem_a3",
    organizationId: "org_a",
    userId: "user_a3",
    role: "staff",
  },
  {
    id: "mem_b0",
    organizationId: "org_b",
    userId: "user_b0",
    role: "owner",
  },
  {
    id: "mem_b1",
    organizationId: "org_b",
    userId: DEMO_USER_ID,
    role: "staff",
  },
  {
    id: "mem_c0",
    organizationId: "org_c",
    userId: "user_c0",
    role: "owner",
  },
];

const staffProfiles: StaffProfile[] = [
  {
    id: "stf_a1",
    organizationId: "org_a",
    memberId: "mem_a1",
    displayName: "佐藤 店長",
    active: true,
  },
  {
    id: "stf_a2",
    organizationId: "org_a",
    memberId: "mem_a2",
    displayName: "鈴木",
    active: true,
  },
  {
    id: "stf_a3",
    organizationId: "org_a",
    memberId: "mem_a3",
    displayName: "高橋",
    active: true,
  },
  {
    id: "stf_b0",
    organizationId: "org_b",
    memberId: "mem_b0",
    displayName: "桜井 院長",
    active: true,
  },
  {
    id: "stf_b1",
    organizationId: "org_b",
    memberId: "mem_b1",
    displayName: "田中",
    active: true,
  },
  {
    id: "stf_c0",
    organizationId: "org_c",
    memberId: "mem_c0",
    displayName: "伊藤",
    active: true,
  },
];

const locations: Location[] = [
  {
    id: "loc_a1",
    organizationId: "org_a",
    name: "渋谷店",
    timezone: "Asia/Tokyo",
  },
  {
    id: "loc_b1",
    organizationId: "org_b",
    name: "本院",
    timezone: "Asia/Tokyo",
  },
  {
    id: "loc_c1",
    organizationId: "org_c",
    name: "本所",
    timezone: "Asia/Tokyo",
  },
];

const services: Service[] = [
  {
    id: "svc_a1",
    organizationId: "org_a",
    name: "カット",
    durationMinutes: 60,
    priceYen: 4400,
  },
  {
    id: "svc_a2",
    organizationId: "org_a",
    name: "カラー",
    durationMinutes: 90,
    priceYen: 8800,
  },
  {
    id: "svc_a3",
    organizationId: "org_a",
    name: "パーマ",
    durationMinutes: 120,
    priceYen: 11000,
  },
  {
    id: "svc_b1",
    organizationId: "org_b",
    name: "整体 60 分",
    durationMinutes: 60,
    priceYen: 6600,
  },
  {
    id: "svc_b2",
    organizationId: "org_b",
    name: "整体 30 分",
    durationMinutes: 30,
    priceYen: 3300,
  },
  {
    id: "svc_c1",
    organizationId: "org_c",
    name: "相談 50 分",
    durationMinutes: 50,
    priceYen: 5500,
  },
];

const familyNames: [string, string][] = [
  ["山田", "ヤマダ"],
  ["中村", "ナカムラ"],
  ["小林", "コバヤシ"],
  ["加藤", "カトウ"],
  ["吉田", "ヨシダ"],
  ["山本", "ヤマモト"],
  ["松本", "マツモト"],
  ["井上", "イノウエ"],
  ["木村", "キムラ"],
  ["林", "ハヤシ"],
  ["清水", "シミズ"],
  ["森", "モリ"],
];
const givenNames: [string, string][] = [
  ["花子", "ハナコ"],
  ["太郎", "タロウ"],
  ["美咲", "ミサキ"],
  ["健", "ケン"],
  ["陽菜", "ヒナ"],
  ["翔", "ショウ"],
];

function buildCustomers(
  organizationId: string,
  prefix: string,
  count: number,
  offset: number,
): Customer[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + offset;
    const [family, familyKana] = familyNames[n % familyNames.length]!;
    const [given, givenKana] =
      givenNames[(n * 5) % givenNames.length]!;
    const no = String(i + 1).padStart(3, "0");
    return {
      id: `${prefix}_${no}`,
      organizationId,
      name: `${family} ${given}`,
      nameKana: `${familyKana} ${givenKana}`,
      email: `${prefix}${no}@example.com`,
      phone: `090-${String(1000 + n).padStart(4, "0")}-${String(5000 + n * 7).slice(-4)}`,
      note: "",
      // 論理削除済みの顧客を 1 件だけ混ぜる
      deletedAt:
        i === count - 1 ? new Date("2026-01-01T00:00:00Z") : null,
    };
  });
}

const customers: Customer[] = [
  ...buildCustomers("org_a", "cus_a", 33, 0),
  ...buildCustomers("org_b", "cus_b", 8, 3),
  ...buildCustomers("org_c", "cus_c", 5, 6),
];

/** 予約のひな形。day は今日からの相対日、hour は店舗の現地時刻 */
type ReservationTemplate = {
  day: number;
  hour: number;
  staff: number;
  customer: number;
  service: number;
};

/**
 * 1 日あたり 1〜4 件、10 時から 2 時間おきに枠を埋める。
 * 最長のメニューが 2 時間なので、同じスタッフでも時間は重ならない。
 */
function buildTemplates(
  fromDay: number,
  toDay: number,
  staffCount: number,
  customerCount: number,
  serviceCount: number,
): ReservationTemplate[] {
  const templates: ReservationTemplate[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    const perDay = ((Math.abs(day) * 7 + 3) % 4) + 1;
    for (let slot = 0; slot < perDay; slot++) {
      const seed = Math.abs(day) * 4 + slot;
      templates.push({
        day,
        hour: 10 + slot * 2,
        staff: (seed + slot) % staffCount,
        // 係数は顧客数と互いに素にする。7 だと、顧客が 7 人の
        // 組織で全件が同じ顧客に割り当てられていた
        customer: (seed * 3) % customerCount,
        service: seed % serviceCount,
      });
    }
  }
  return templates;
}

function statusFor(day: number, index: number): ReservationStatus {
  if (index % 9 === 4) return "cancelled";
  if (day < 0) return "done";
  if (day === 0) return "confirmed";
  return index % 3 === 0 ? "pending" : "confirmed";
}

function materializeReservations(
  organizationId: string,
  templates: ReservationTemplate[],
  todayYmd: string,
): Reservation[] {
  const location = locations.find(
    (l) => l.organizationId === organizationId,
  )!;
  const orgStaff = staffProfiles.filter(
    (s) => s.organizationId === organizationId,
  );
  const orgCustomers = customers.filter(
    (c) => c.organizationId === organizationId && !c.deletedAt,
  );
  const orgServices = services.filter(
    (s) => s.organizationId === organizationId,
  );
  return templates.map((t, i): Reservation => {
    const service = orgServices[t.service]!;
    const startsAt = zonedToUtc(
      addDays(todayYmd, t.day),
      location.timezone,
      t.hour,
    );
    return {
      id: `rsv_${organizationId}_${String(i + 1).padStart(4, "0")}`,
      organizationId,
      locationId: location.id,
      staffProfileId: orgStaff[t.staff]!.id,
      customerId: orgCustomers[t.customer]!.id,
      serviceId: service.id,
      startsAt,
      endsAt: new Date(
        startsAt.getTime() + service.durationMinutes * 60_000,
      ),
      status: statusFor(t.day, i),
      priceYen: service.priceYen,
      version: 1,
    };
  });
}

const reservationTemplates: Record<string, ReservationTemplate[]> = {
  org_a: buildTemplates(-45, 14, 3, 32, 3),
  org_b: buildTemplates(-20, 7, 2, 7, 2),
  org_c: buildTemplates(-5, 5, 1, 4, 1),
};

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

const userNames: Record<string, string> = {
  [DEMO_USER_ID]: "デモ ユーザー",
  user_a1: "佐藤 一郎",
  user_a2: "鈴木 次郎",
  user_a3: "高橋 三郎",
  user_b0: "桜井 桜",
  user_c0: "伊藤 四郎",
};

export type SeedData = {
  users: User[];
  organizations: Organization[];
  members: Member[];
  staffProfiles: StaffProfile[];
  locations: Location[];
  services: Service[];
  customers: Customer[];
  reservations: Reservation[];
};

/** now の日付（各組織の店舗のタイムゾーン）を基準に、投入する行を組み立てる */
export function buildSeedData(now: Date): SeedData {
  const users = [...new Set(members.map((m) => m.userId))].map(
    (id) => ({
      id,
      name: userNames[id] ?? id,
      email: `${id.replace(/_/g, "-")}@example.com`,
      emailVerified: true,
    }),
  );
  const reservations = organizations.flatMap((o) => {
    const location = locations.find(
      (l) => l.organizationId === o.id,
    )!;
    const templates = reservationTemplates[o.id] ?? [];
    const todayYmd = toZonedYmd(now, location.timezone);
    return materializeReservations(o.id, templates, todayYmd);
  });
  return {
    users,
    organizations,
    members,
    staffProfiles,
    locations,
    services,
    customers,
    reservations,
  };
}

/** シードが空にするテーブル（Better Auth のテーブルも含む） */
const tables = [
  "auditLog",
  "subscription",
  "attachment",
  "reservation",
  "customer",
  "service",
  "location",
  "staffProfile",
  "invitation",
  "member",
  "organization",
  "verification",
  "account",
  "session",
  "user",
];

/**
 * 全テーブルを空にしてから投入する。何度実行しても同じ状態になる。
 * 開発用・テスト用の DB 専用（本番では実行しない）。
 */
export async function seedDatabase(
  prisma: PrismaClient,
  now: Date,
): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("本番環境ではシードを実行しない");
  }
  const data = buildSeedData(now);
  const createdAt = new Date("2026-01-01T00:00:00Z");
  // 全員に同じ開発用パスワードを設定する（Better Auth と同じ scrypt で
  // ハッシュ化する）。ロールごとの動作をどのユーザーでも試せるようにする
  const password = await hashPassword(DEMO_USER_PASSWORD);
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`,
    ),
    prisma.user.createMany({ data: data.users }),
    // Better Auth のメールアドレスとパスワードのログインは、
    // providerId が "credential" の account にパスワードを持つ
    prisma.account.createMany({
      data: data.users.map((u) => ({
        id: `acc_${u.id}`,
        accountId: u.id,
        providerId: "credential",
        userId: u.id,
        password,
      })),
    }),
    prisma.organization.createMany({
      data: data.organizations.map((o) => ({ ...o, createdAt })),
    }),
    prisma.member.createMany({
      data: data.members.map((m) => ({ ...m, createdAt })),
    }),
    prisma.staffProfile.createMany({ data: data.staffProfiles }),
    prisma.location.createMany({ data: data.locations }),
    prisma.service.createMany({ data: data.services }),
    prisma.customer.createMany({ data: data.customers }),
    prisma.reservation.createMany({ data: data.reservations }),
  ]);
}
