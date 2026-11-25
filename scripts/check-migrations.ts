/**
 * マイグレーションの危険な操作を止める（第17章、docs/migrations.md）。
 * 見つかったら終了コード 1。npm run check と CI の両方で使う。
 *
 *   npm run migrations:check                         # すべてのマイグレーション
 *   npm run migrations:check -- --base origin/main   # あわせて、適用済みの
 *                                                    # マイグレーションの変更・削除も止める（CI）
 *
 * ルールは scripts/migration-rules.ts。適用済みで書き換えられない
 * マイグレーションの指摘は prisma/migration-safety-baseline.json に
 * 理由とともに記録する（新しいマイグレーションはこのファイルに足さず、
 * SQL の文の直前に `-- migration-safety: allow <rule> <理由>` を書く）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  checkMigration,
  invalidAllowComments,
  RULES,
  type RuleId,
} from "./migration-rules";

type BaselineEntry = {
  migration: string;
  rule: RuleId;
  line: number;
  reason: string;
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** 既存のマイグレーションの変更・削除・改名（追加は対象外） */
function changedAppliedMigrations(
  dir: string,
  base: string,
): string[] {
  const out = execFileSync(
    "git",
    [
      "diff",
      "--name-status",
      "--no-renames",
      "--diff-filter=MD",
      `${base}...HEAD`,
      "--",
      dir,
    ],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((l) => !l.endsWith("migration_lock.toml"));
}

function main(): void {
  const dir = argValue("--dir") ?? "prisma/migrations";
  const baselineFile =
    argValue("--baseline") ?? "prisma/migration-safety-baseline.json";
  const base = argValue("--base");
  const baseline: BaselineEntry[] = existsSync(baselineFile)
    ? (
        JSON.parse(readFileSync(baselineFile, "utf8")) as {
          entries: BaselineEntry[];
        }
      ).entries
    : [];

  const problems: string[] = [];
  const used = new Set<BaselineEntry>();
  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let allowedCount = 0;
  for (const name of migrations) {
    const file = path.join(dir, name, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");

    for (const line of invalidAllowComments(sql)) {
      problems.push(
        `${file}:${line}  allow の書き方が誤り（-- migration-safety: allow <rule> <理由>。rule は ${Object.keys(RULES).join("・")}）`,
      );
    }

    const { findings, allowedFindings } = checkMigration(sql);
    allowedCount += allowedFindings.length;
    for (const f of allowedFindings) {
      console.log(
        `  許可：${file}:${f.line}  ${f.rule}（${f.reason}）`,
      );
    }
    for (const f of findings) {
      const known = baseline.find(
        (b) =>
          b.migration === name &&
          b.rule === f.rule &&
          b.line === f.line,
      );
      if (known) {
        used.add(known);
        continue;
      }
      problems.push(
        `${file}:${f.line}  ${f.rule}：${RULES[f.rule]}\n      ${f.statement}`,
      );
    }
  }

  for (const b of baseline) {
    if (!used.has(b)) {
      console.warn(
        `  警告：baseline の ${b.migration}:${b.line}（${b.rule}）はもう該当しない。一覧から消す`,
      );
    }
  }

  if (base) {
    for (const change of changedAppliedMigrations(dir, base)) {
      problems.push(
        `${change.replace("\t", "  ")}  適用済みのマイグレーションを変更・削除しない（新しいマイグレーションで直す。CLAUDE.md）`,
      );
    }
  }

  if (problems.length === 0) {
    console.log(
      `migrations:check：${migrations.length} 個のマイグレーションに危険な操作はなかった（記録済み ${used.size}、allow ${allowedCount}）`,
    );
    return;
  }
  console.error(
    `migrations:check：危険な操作・誤りが ${problems.length} 件`,
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "列の削除・改名・型の変更は expand と contract に分ける（docs/migrations.md）。意図した操作なら文の直前に `-- migration-safety: allow <rule> <理由>` を書く",
  );
  process.exitCode = 1;
}

main();
