/**
 * リポジトリに秘密情報が入っていないかを調べる（第14章、docs/security.md）。
 * 見つかったら終了コード 1。ローカルの pre-commit と CI の両方で使う。
 *
 *   npm run secrets:scan                 # 追跡中のファイル（作業ツリーの内容）
 *   npm run secrets:scan -- --staged     # ステージした差分の追加行（pre-commit）
 *   npm run secrets:scan -- --history    # すべてのコミットの追加行（CI・定期）
 *
 * 秘密そのものは出力しない（先頭 6 文字と長さだけ）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { type Finding, scanFileName, scanText } from "./secret-rules";

/** 検出のルールを書いたファイル自身と、バイナリ・生成物は対象外 */
const SKIP = [
  /^scripts\/secret-rules(\.test)?\.ts$/,
  /^package-lock\.json$/,
  /\.(png|jpe?g|gif|webp|ico|woff2?|pdf|zip)$/,
  /^src\/generated\//,
];

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
  });
}

function skipped(file: string): boolean {
  return SKIP.some((p) => p.test(file));
}

function scanWorkingTree(): Finding[] {
  // 追跡中のファイルと、まだ追加していないが無視もしていないファイル
  const files = git([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ])
    .split("\0")
    .filter(Boolean);
  const findings: Finding[] = [];
  for (const file of files) {
    findings.push(...scanFileName(file));
    if (skipped(file)) continue;
    let text: string;
    try {
      if (statSync(file).size > 5 * 1024 * 1024) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue; // 削除済み（ステージ前）のファイル
    }
    findings.push(...scanText(file, text));
  }
  return findings;
}

/**
 * git の差分（-U0）から追加行だけを取り出して調べる。
 * 行番号は差分のヘッダー（@@ -a,b +c,d @@）から求める
 */
function scanPatch(patch: string, label: (file: string) => string) {
  const findings: Finding[] = [];
  let file = "";
  let line = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.replace(/^\+\+\+ (b\/)?/, "");
      if (file !== "/dev/null") findings.push(...scanFileName(file));
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+") && file && !skipped(file)) {
      for (const f of scanText(label(file), raw.slice(1))) {
        findings.push({ ...f, line });
      }
      line++;
    }
  }
  return findings;
}

function scanStaged(): Finding[] {
  return scanPatch(
    git([
      "diff",
      "--cached",
      "-U0",
      "--no-color",
      "--diff-filter=ACMR",
    ]),
    (file) => file,
  );
}

function scanHistory(): Finding[] {
  const findings: Finding[] = [];
  const commits = git(["rev-list", "--all"])
    .split("\n")
    .filter(Boolean);
  for (const commit of commits) {
    const patch = git([
      "show",
      "-U0",
      "--no-color",
      "--format=",
      "--diff-filter=ACMR",
      commit,
    ]);
    findings.push(
      ...scanPatch(patch, (file) => `${commit.slice(0, 7)}:${file}`),
    );
  }
  return findings;
}

function main(): void {
  const mode = process.argv.includes("--history")
    ? "history"
    : process.argv.includes("--staged")
      ? "staged"
      : "tree";
  const findings =
    mode === "history"
      ? scanHistory()
      : mode === "staged"
        ? scanStaged()
        : scanWorkingTree();

  if (findings.length === 0) {
    console.log(
      `secrets:scan（${mode}）：秘密情報は見つからなかった`,
    );
    return;
  }
  console.error(
    `secrets:scan（${mode}）：秘密情報らしきものが ${findings.length} 件`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.rule}  ${f.preview}`);
  }
  console.error(
    "鍵は .env.local か本番の環境変数に置く。履歴に入った鍵は、消すより先に無効化（ローテーション）する（docs/security.md）",
  );
  process.exitCode = 1;
}

main();
