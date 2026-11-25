/**
 * DATABASE_URL（pg の書き方）を Prisma の CLI（スキーマエンジン）の
 * 書き方に直す（第17章、docs/architecture.md の 4）。prisma7.config.ts が使う。
 *
 * 本番の DATABASE_URL は RDS のサーバー証明書を検証する
 * `sslmode=verify-full&sslrootcert=<CA のファイル>`。アプリ（pg）はこれで
 * 検証するが、Prisma 7.10 の CLI は sslrootcert と verify-full を知らず、
 * **検証せずに接続する**（手元の TLS 必須の PostgreSQL で、CA の違う
 * 証明書でも migrate status が通った）。CLI では次の形にする：
 *   sslmode=require&sslcert=<CA のファイル>&sslaccept=strict
 * sslcert（CLI ではサーバーを確かめる CA の意味）はファイルの最初の
 * 証明書だけを使うので、CA は 1 つだけのファイルにする。
 */
export function toPrismaCliUrl(databaseUrl: string): string {
  if (!databaseUrl) return databaseUrl;
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get("sslmode");
  if (mode !== "verify-full" && mode !== "verify-ca")
    return databaseUrl;

  const ca = url.searchParams.get("sslrootcert");
  if (!ca) {
    throw new Error(
      `sslmode=${mode} には sslrootcert（CA のファイル）を付ける`,
    );
  }
  url.searchParams.delete("sslrootcert");
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("sslcert", ca);
  // ホスト名も確かめる（verify-ca より強いが、RDS のエンドポイントは証明書と一致する）
  url.searchParams.set("sslaccept", "strict");
  return url.toString();
}
