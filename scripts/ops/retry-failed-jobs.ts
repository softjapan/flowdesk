/**
 * 障害で failed になったジョブを再実行する（第18章、docs/runbooks/incident-ai.md の 6）。
 *   npm run jobs:retry -- --since 2026-11-25T19:00:00Z                 # 数えるだけ
 *   npm run jobs:retry -- --since 2026-11-25T19:00:00Z --type mail.send --apply
 *
 * - 原因（SMTP・DB など）を直してから実行する。--apply がなければ何も変えない
 * - DLQ のメッセージを本体のキューに戻すだけでは再実行されない（runJob が
 *   failed のジョブを捨てる）。DB の job を queued に戻して送る
 * - 本番では migrate と同じく ECS の run-task で実行する（DATABASE_URL・
 *   SQS_QUEUE_URL はタスク定義から渡る。手元の端末に本番の秘密を置かない）
 */
import "@/server/load-env";
import { parseArgs } from "node:util";
import { getPrisma } from "@/server/db";
import {
  JOB_TYPES,
  retryFailedJobs,
  summarizeFailedJobs,
} from "@/server/services/jobs";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      since: { type: "string" },
      type: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const since = new Date(values.since ?? "");
  if (Number.isNaN(since.getTime())) {
    throw new Error(
      "--since に ISO 8601 の日時を渡す（障害が始まった時刻）",
    );
  }
  const summary = await summarizeFailedJobs(since);
  console.log(`${since.toISOString()} 以降に失敗したジョブ`);
  for (const row of summary)
    console.log(`  ${row.type}: ${row.count} 件`);

  if (!values.apply || !values.type) {
    console.log("（--type と --apply を付けると再実行する）");
    return;
  }
  const types = Object.values(JOB_TYPES) as string[];
  if (!types.includes(values.type)) {
    throw new Error(`--type は ${types.join("・")} のどれか`);
  }
  const ids = await retryFailedJobs({
    type: values.type,
    failedSince: since,
  });
  console.log(`${values.type} を ${ids.length} 件、キューに戻した`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
