/**
 * DB を導入するまでの固定のデモデータ（第7章で Prisma に置き換える）。
 * テーブルの形は docs/er.md に合わせる。取得関数はすべて organizationId を
 * 引数に取り、ID だけでは取得できないようにしておく。
 *
 * 予約は「今日」を基準にした相対日で定義し、呼び出し時の日付で実体化する。
 * こうしておくと、いつ起動してもダッシュボードの「本日の予約」が空にならない。
 */
import { addDays, toZonedYmd, zonedToUtc } from "@/lib/datetime";

export type Role = "owner" | "admin" | "staff";
export type ReservationStatus =
  "pending" | "confirmed" | "cancelled" | "done";

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

/** 認証（第8章）までの仮のログインユーザー */
export const DEMO_USER_ID = "user_demo";

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
        customer: (seed * 7) % customerCount,
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
  return templates.map((t, i) => {
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

function reservationsOf(organizationId: string, now: Date) {
  const location = locations.find(
    (l) => l.organizationId === organizationId,
  );
  const templates = reservationTemplates[organizationId];
  if (!location || !templates) return [];
  const todayYmd = toZonedYmd(now, location.timezone);
  return materializeReservations(organizationId, templates, todayYmd);
}

/**
 * デモデータの取得口。Prisma に置き換えるときも、同じく organizationId で
 * 絞り込む形を保つ。
 */
export const demoDb = {
  async findOrganizationBySlug(slug: string) {
    return organizations.find((o) => o.slug === slug) ?? null;
  },
  async findMember(organizationId: string, userId: string) {
    return (
      members.find(
        (m) =>
          m.organizationId === organizationId && m.userId === userId,
      ) ?? null
    );
  },
  async listLocations(organizationId: string) {
    return locations.filter(
      (l) => l.organizationId === organizationId,
    );
  },
  async listStaffProfiles(organizationId: string) {
    return staffProfiles.filter(
      (s) => s.organizationId === organizationId && s.active,
    );
  },
  async listServices(organizationId: string) {
    return services.filter(
      (s) => s.organizationId === organizationId,
    );
  },
  /** 論理削除済みは含めない */
  async listCustomers(organizationId: string) {
    return customers.filter(
      (c) => c.organizationId === organizationId && !c.deletedAt,
    );
  },
  /** startsAt が [from, to) の予約 */
  async listReservations(
    organizationId: string,
    range: { from: Date; to: Date },
    now: Date,
  ) {
    return reservationsOf(organizationId, now)
      .filter(
        (r) =>
          r.startsAt.getTime() >= range.from.getTime() &&
          r.startsAt.getTime() < range.to.getTime(),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  },
};
