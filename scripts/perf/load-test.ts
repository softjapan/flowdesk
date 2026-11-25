/**
 * 画面の負荷試験（第15章、docs/performance.md）。依存を増やさないよう、
 * Node 24 の fetch で同時に N 本のリクエストを送り続ける。
 *   npm run perf:load -- --base http://localhost:3200 \
 *     [--concurrency 10] [--duration 20] [--out 結果.json]
 *
 * - 最初にデモユーザーでログインし、Cookie を使い回す。Better Auth は本番
 *   モードで /sign-in を 10 秒に 3 回までに制限するので、ログインは 1 回だけ
 * - 応答の本文を最後まで読んだ時間（total）を p95 の判定に使う。Cache
 *   Components の画面は静的なシェルを先に返し、Suspense の中身を後から
 *   流すので、ヘッダーが届いた時間（ttfb）だけでは中身の遅さが見えない
 * - 200 以外（ログイン画面へのリダイレクトなど）はエラーとして数える
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
} from "@/server/demo-user";
import { percentile } from "./stats";

const DEFAULT_PATHS = [
  "/demo-salon",
  "/demo-salon/customers",
  "/demo-salon/customers?page=500",
  "/demo-salon/customers?q=ヤマダ",
  "/demo-salon/reservations",
  "/demo-salon/reservations?view=day",
  "/demo-salon/reservations/new",
];

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3200" },
    concurrency: { type: "string", default: "10" },
    duration: { type: "string", default: "20" },
    warmup: { type: "string", default: "10" },
    path: { type: "string", multiple: true },
    out: { type: "string" },
  },
});

async function signIn(base: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      email: DEMO_USER_EMAIL,
      password: DEMO_USER_PASSWORD,
    }),
  });
  if (!res.ok) {
    throw new Error(`ログインに失敗した（${res.status}）`);
  }
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

type Sample = { ttfb: number; total: number; bytes: number };

async function request(
  url: string,
  cookie: string,
): Promise<Sample | null> {
  const start = performance.now();
  const res = await fetch(url, {
    headers: { cookie },
    redirect: "manual",
  });
  const ttfb = performance.now() - start;
  const body = await res.text();
  if (res.status !== 200) return null;
  return {
    ttfb,
    total: performance.now() - start,
    bytes: body.length,
  };
}

type PathResult = {
  path: string;
  concurrency: number;
  requests: number;
  errors: number;
  rps: number;
  ttfbP95: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** 本文の文字数（HTML と RSC のペイロード） */
  bodyChars: number;
};

async function run(
  base: string,
  path: string,
  cookie: string,
): Promise<PathResult> {
  const url = new URL(path, base).toString();
  for (let i = 0; i < Number(args.warmup); i++) {
    await request(url, cookie);
  }
  const concurrency = Number(args.concurrency);
  const deadline = performance.now() + Number(args.duration) * 1000;
  const samples: Sample[] = [];
  let errors = 0;
  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const sample = await request(url, cookie).catch(() => null);
        if (sample) samples.push(sample);
        else errors++;
      }
    }),
  );
  const elapsed = (performance.now() - startedAt) / 1000;
  const totals = samples.map((s) => s.total);
  return {
    path,
    concurrency,
    requests: samples.length,
    errors,
    rps: samples.length / elapsed,
    ttfbP95: percentile(
      samples.map((s) => s.ttfb),
      95,
    ),
    p50: percentile(totals, 50),
    p95: percentile(totals, 95),
    p99: percentile(totals, 99),
    max: Math.max(...totals),
    bodyChars: samples[0]?.bytes ?? 0,
  };
}

async function main(): Promise<void> {
  const base = args.base;
  const cookie = await signIn(base);
  const results: PathResult[] = [];
  for (const path of args.path ?? DEFAULT_PATHS) {
    const r = await run(base, path, cookie);
    results.push(r);
    console.log(
      `${r.path}\t同時 ${r.concurrency}\t${r.requests} 件（エラー ${r.errors}）\t` +
        `${r.rps.toFixed(1)} req/s\tp50 ${r.p50.toFixed(0)} ms\t` +
        `p95 ${r.p95.toFixed(0)} ms\tp99 ${r.p99.toFixed(0)} ms\t` +
        `TTFB p95 ${r.ttfbP95.toFixed(0)} ms\t本文 ${r.bodyChars} 文字`,
    );
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(results, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
