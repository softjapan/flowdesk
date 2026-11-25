/**
 * npm audit の結果を、判断済みの一覧（audit-allowlist.json）と比べる
 * （第14章、docs/security.md）。CI の定期実行と依存の更新の PR で使う。
 *
 *   npm run audit:check
 *
 * 終了コード 1 になるのは次のとき：
 * - 一覧にない advisory（moderate 以上）が出た
 * - 一覧の reviewBy を過ぎた（判断を見直す）
 * 一覧にあるがもう出ない advisory は、一覧から消すよう警告だけ出す。
 * npm audit はレジストリに問い合わせるので、npm run check には含めない。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Via = string | { url: string; severity: string; name: string };
type AuditReport = {
  vulnerabilities: Record<string, { via: Via[] }>;
};
type Allowed = { id: string; package: string; reviewBy: string };

const LEVELS = ["info", "low", "moderate", "high", "critical"];

function runAudit(): AuditReport {
  try {
    return JSON.parse(
      execFileSync("npm", ["audit", "--json"], { encoding: "utf8" }),
    ) as AuditReport;
  } catch (error) {
    // 脆弱性があると npm audit は 0 以外で終わるが、JSON は出す
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as AuditReport;
  }
}

function main(): void {
  const allowlist = (
    JSON.parse(readFileSync("audit-allowlist.json", "utf8")) as {
      advisories: Allowed[];
    }
  ).advisories;
  const found = new Map<string, { pkg: string; severity: string }>();
  for (const v of Object.values(runAudit().vulnerabilities)) {
    for (const via of v.via) {
      if (typeof via === "string") continue;
      const id = via.url.split("/").at(-1) ?? via.url;
      found.set(id, { pkg: via.name, severity: via.severity });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const problems: string[] = [];
  for (const [id, { pkg, severity }] of found) {
    const allowed = allowlist.find((a) => a.id === id);
    if (!allowed) {
      if (LEVELS.indexOf(severity) >= LEVELS.indexOf("moderate")) {
        problems.push(
          `未判断の advisory：${id}（${pkg}、${severity}）`,
        );
      }
    } else if (allowed.reviewBy < today) {
      problems.push(
        `見直しの期限切れ：${id}（${pkg}、期限 ${allowed.reviewBy}）`,
      );
    } else {
      console.log(`判断済み：${id}（${pkg}、${severity}）`);
    }
  }
  for (const a of allowlist) {
    if (!found.has(a.id)) {
      console.warn(
        `もう出ない advisory：${a.id}（${a.package}）。audit-allowlist.json から消す`,
      );
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(
      "対応方針を決めて docs/security.md と audit-allowlist.json に書く",
    );
    process.exitCode = 1;
  }
}

main();
