/**
 * テスト用 DB の作成・削除（DB を使うテストと E2E の準備で共有する）。
 * DB 名は SQL に埋め込むので、英数字と _ だけを許す。
 */
import { Client } from "pg";

export function databaseName(url: string | URL): string {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^\w+$/.test(name)) {
    throw new Error(`テスト用 DB の名前が不正: ${name}`);
  }
  return name;
}

/** 同じサーバーの別の DB を指す URL */
export function withDatabase(
  url: string | URL,
  name: string,
): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  databaseName(next);
  return next.toString();
}

/** 管理用の DB（postgres）に接続して fn を実行する */
export async function withAdminClient<T>(
  url: string | URL,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: withDatabase(url, "postgres"),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureDatabase(
  url: string | URL,
): Promise<void> {
  const name = databaseName(url);
  await withAdminClient(url, async (client) => {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (rowCount === 0)
      await client.query(`CREATE DATABASE "${name}"`);
  });
}

/** 接続が残っていても消す（PostgreSQL 13 以降の WITH (FORCE)） */
export async function dropDatabase(url: string | URL): Promise<void> {
  const name = databaseName(url);
  await withAdminClient(url, (client) =>
    client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  );
}
