// 本番のイメージ（Dockerfile の prod-deps）で、npm ci --omit=dev の後に実行する。
//
// prisma（CLI）は devDependencies だが、better-auth の Prisma アダプターと
// @prisma/client の「任意の peer 依存」でもあるので、lockfile では
// devOptional になり、--omit=dev でも --omit=peer でも入ってしまう
// （第14章の npm audit の effect もこの経路）。--omit=optional を足すと
// 消えるが、tsx が使う esbuild のネイティブのバイナリ（optional）も消える。
//
// そこで lockfile で devOptional の印が付いたパッケージ（開発用か、本番からは
// 任意の peer でしか届かないもの）だけを node_modules から消す。
import { existsSync, readFileSync, rmSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
let removed = 0;
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!meta.devOptional || !path.startsWith("node_modules/"))
    continue;
  if (!existsSync(path)) continue;
  rmSync(path, { recursive: true, force: true });
  removed += 1;
}
// bin のリンク（node_modules/.bin/prisma など）も消す
for (const bin of [
  "prisma",
  "tsc",
  "tsserver",
  "vitest",
  "playwright",
]) {
  rmSync(`node_modules/.bin/${bin}`, { force: true });
}

for (const name of ["prisma", "effect", "@prisma/config"]) {
  if (existsSync(`node_modules/${name}`)) {
    console.error(`${name} が本番の依存に残っている`);
    process.exit(1);
  }
}
console.log(`devOptional のパッケージを ${removed} 個消した`);
