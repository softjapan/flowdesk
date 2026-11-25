/**
 * Service の処理時間とクエリの数を計測する（第15章、docs/performance.md）。
 *   npm run perf:bench -- [--iterations 30] [--out 結果.json]
 *
 * 画面の Server Component と同じ Service を、デモユーザー（デモサロンの
 * Owner）の文脈で順に呼ぶ。Prisma のクエリのイベントを数え、1 回の呼び出し
 * あたりのクエリ数と、所要時間の p50・p95・最大を出す。
 * HTTP・描画・認証を含めた画面の計測は load-test.ts で行う。
 */
import "@/server/load-env";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { DEMO_USER_ID } from "@/server/demo-user";
import { percentile } from "./stats";

const { values: args } = parseArgs({
  options: {
    iterations: { type: "string", default: "30" },
    warmup: { type: "string", default: "3" },
    out: { type: "string" },
    only: { type: "string" },
  },
});

type Scenario = {
  name: string;
  /** 書き込みを伴う処理は回数を減らす */
  iterations?: number;
  run: () => Promise<unknown>;
};

type Result = {
  name: string;
  iterations: number;
  queries: number;
  p50: number;
  p95: number;
  max: number;
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL が設定されていない（.env.example を参照）",
    );
  }
  // Repository が使う getPrisma() に、クエリを数える Client を渡す
  // （src/server/db.ts は globalThis.prisma があればそれを使う）
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: [{ emit: "event", level: "query" }],
  });
  let queryCount = 0;
  prisma.$on("query", () => {
    queryCount++;
  });
  (globalThis as { prisma?: PrismaClient }).prisma = prisma;

  // Client を差し替えてから Service を読み込む
  const { getOrgContext } =
    await import("@/server/services/org-context");
  const { listCustomers } =
    await import("@/server/services/customers");
  const { getCalendar, getReservationFormOptions } =
    await import("@/server/services/reservations");
  const { getDashboard } =
    await import("@/server/services/dashboard");
  const { scheduleReminders } =
    await import("@/server/services/job-handlers");

  const ctx = await getOrgContext("demo-salon", DEMO_USER_ID);
  if (!ctx)
    throw new Error("デモサロンが見つからない（シードを入れる）");
  const now = new Date();

  const scenarios: Scenario[] = [
    {
      name: "組織の文脈（getOrgContext）",
      run: () => getOrgContext("demo-salon", DEMO_USER_ID),
    },
    {
      name: "顧客一覧 1 ページ目",
      run: () => listCustomers(ctx, {}),
    },
    {
      name: "顧客一覧 500 ページ目",
      run: () => listCustomers(ctx, { page: "500" }),
    },
    {
      name: "顧客一覧 検索（フリガナ「ヤマダ」）",
      run: () => listCustomers(ctx, { q: "ヤマダ" }),
    },
    {
      name: "顧客一覧 検索（電話「0801234」）",
      run: () => listCustomers(ctx, { q: "0801234" }),
    },
    {
      name: "予約カレンダー 週",
      run: () => getCalendar(ctx, {}, now),
    },
    {
      name: "予約カレンダー 日",
      run: () => getCalendar(ctx, { view: "day" }, now),
    },
    {
      name: "ダッシュボード（Owner）",
      run: () => getDashboard(ctx, now),
    },
    {
      name: "ダッシュボード（Staff）",
      run: () => getDashboard({ ...ctx, role: "staff" }, now),
    },
    {
      name: "予約フォームの選択肢",
      run: () => getReservationFormOptions(ctx),
    },
    {
      name: "前日リマインドの登録（Worker）",
      iterations: 5,
      run: () => scheduleReminders(now, async () => {}),
    },
  ].filter((s) => !args.only || s.name.includes(args.only));

  const results: Result[] = [];
  for (const scenario of scenarios) {
    const iterations = scenario.iterations ?? Number(args.iterations);
    for (let i = 0; i < Number(args.warmup); i++) {
      await scenario.run();
    }
    const times: number[] = [];
    const counts: number[] = [];
    for (let i = 0; i < iterations; i++) {
      queryCount = 0;
      const start = performance.now();
      await scenario.run();
      times.push(performance.now() - start);
      counts.push(queryCount);
    }
    const result: Result = {
      name: scenario.name,
      iterations,
      queries: Math.max(...counts),
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      max: Math.max(...times),
    };
    results.push(result);
    console.log(
      `${result.name}\tクエリ ${result.queries}\t` +
        `p50 ${result.p50.toFixed(1)} ms\tp95 ${result.p95.toFixed(1)} ms\t` +
        `最大 ${result.max.toFixed(1)} ms（${iterations} 回）`,
    );
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(results, null, 2));
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
