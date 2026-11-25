/**
 * ECS へのデプロイ（第17章、docs/ci-cd.md）。.github/workflows/deploy.yml が
 * ECR に push した後に実行する。AWS の操作は aws CLI で行う（依存を足さない）。
 *
 *   1. migrate のタスク定義を、新しいイメージのタグで登録し直す
 *   2. migrate を run-task で 1 回実行し、終了コード 0 を確かめる
 *      （失敗したら web・worker は更新しない）
 *   3. web・worker のタスク定義を登録し直し、サービスを更新する
 *   4. 新しいデプロイが COMPLETED になるまで待つ。サーキットブレーカーが
 *      前の版に戻した（FAILED）ら失敗にする（services-stable は戻した後も
 *      「安定」になりうるので使わない）
 *
 * タスク定義の中身（環境変数・シークレットの ARN・ロール）は Terraform が
 * 決め、ここではイメージのタグだけを差し替える。
 *
 * Node 24 の型の除去でそのまま動く（node scripts/deploy/ecs-deploy.mts）。
 * 環境変数：ECS_CLUSTER・IMAGE_TAG・NAME_PREFIX（flowdesk-prod）・
 * MIGRATE_SUBNETS・MIGRATE_SECURITY_GROUPS（カンマ区切り）
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** aws CLI を呼び、JSON の出力を返す（テストでは差し替える） */
export type Aws = (args: string[]) => unknown;

type Component = "migrate" | "web" | "worker";

export type DeployOptions = {
  cluster: string;
  imageTag: string;
  namePrefix: string;
  migrateSubnets: string[];
  migrateSecurityGroups: string[];
  pollIntervalMs?: number;
  migrateTimeoutMs?: number;
  serviceTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

type ContainerDefinition = { name: string; image: string };
type TaskDefinition = {
  family: string;
  containerDefinitions: ContainerDefinition[];
  [key: string]: unknown;
};

/** register-task-definition が受け付ける項目（describe の結果の残りは読み取り専用） */
const REGISTER_KEYS = [
  "family",
  "taskRoleArn",
  "executionRoleArn",
  "networkMode",
  "containerDefinitions",
  "volumes",
  "placementConstraints",
  "requiresCompatibilities",
  "cpu",
  "memory",
  "pidMode",
  "ipcMode",
  "proxyConfiguration",
  "inferenceAccelerators",
  "ephemeralStorage",
  "runtimePlatform",
] as const;

const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** <repository>:<tag> のタグだけを差し替える（レジストリのポートの : は残す） */
export function replaceImageTag(image: string, tag: string): string {
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  const repository = colon > slash ? image.slice(0, colon) : image;
  if (repository.includes("@")) {
    throw new Error(
      `ダイジェストで指定したイメージは扱わない：${image}`,
    );
  }
  return `${repository}:${tag}`;
}

export function registerInput(
  current: TaskDefinition,
  component: Component,
  tag: string,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of REGISTER_KEYS) {
    if (current[key] !== undefined) input[key] = current[key];
  }
  let replaced = 0;
  input.containerDefinitions = current.containerDefinitions.map(
    (c) => {
      if (c.name !== component) return c;
      replaced++;
      return { ...c, image: replaceImageTag(c.image, tag) };
    },
  );
  if (replaced !== 1) {
    throw new Error(
      `${current.family} に ${component} という名前のコンテナがない`,
    );
  }
  return input;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deploy(aws: Aws, options: DeployOptions) {
  const {
    cluster,
    imageTag,
    namePrefix,
    pollIntervalMs = 15_000,
    migrateTimeoutMs = 15 * 60_000,
    serviceTimeoutMs = 20 * 60_000,
    sleep = defaultSleep,
    log = console.log,
  } = options;
  if (!TAG.test(imageTag) || imageTag === "latest") {
    throw new Error(`イメージのタグが不正：${imageTag}`);
  }

  const register = (component: Component): string => {
    const family = `${namePrefix}-${component}`;
    const { taskDefinition } = aws([
      "ecs",
      "describe-task-definition",
      "--task-definition",
      family,
    ]) as { taskDefinition: TaskDefinition };
    const input = registerInput(taskDefinition, component, imageTag);
    const registered = aws([
      "ecs",
      "register-task-definition",
      "--cli-input-json",
      JSON.stringify(input),
    ]) as { taskDefinition: { taskDefinitionArn: string } };
    const arn = registered.taskDefinition.taskDefinitionArn;
    log(`登録：${arn}`);
    return arn;
  };

  // ---- 1・2. migrate ------------------------------------------------------
  const migrateArn = register("migrate");
  const run = aws([
    "ecs",
    "run-task",
    "--cluster",
    cluster,
    "--task-definition",
    migrateArn,
    "--launch-type",
    "FARGATE",
    "--count",
    "1",
    "--started-by",
    `deploy-${imageTag}`.slice(0, 36),
    "--network-configuration",
    JSON.stringify({
      awsvpcConfiguration: {
        subnets: options.migrateSubnets,
        securityGroups: options.migrateSecurityGroups,
        assignPublicIp: "DISABLED",
      },
    }),
  ]) as {
    tasks: { taskArn: string }[];
    failures: { reason?: string }[];
  };
  const taskArn = run.tasks[0]?.taskArn;
  if (!taskArn) {
    throw new Error(
      `migrate を起動できなかった：${JSON.stringify(run.failures)}`,
    );
  }
  log(`migrate を起動：${taskArn}`);

  const migrateDeadline = Date.now() + migrateTimeoutMs;
  for (;;) {
    const { tasks } = aws([
      "ecs",
      "describe-tasks",
      "--cluster",
      cluster,
      "--tasks",
      taskArn,
    ]) as {
      tasks: {
        lastStatus: string;
        stoppedReason?: string;
        containers: { name: string; exitCode?: number }[];
      }[];
    };
    const task = tasks[0];
    if (task?.lastStatus === "STOPPED") {
      const exitCode = task.containers.find(
        (c) => c.name === "migrate",
      )?.exitCode;
      if (exitCode !== 0) {
        throw new Error(
          `migrate が失敗した（終了コード ${exitCode ?? "なし"}、${task.stoppedReason ?? ""}）。web・worker は更新しない。ログは CloudWatch の /ecs/${namePrefix}/migrate`,
        );
      }
      log("migrate が終わった（終了コード 0）");
      break;
    }
    if (Date.now() > migrateDeadline) {
      throw new Error(
        "migrate が時間内に終わらなかった。web・worker は更新しない",
      );
    }
    await sleep(pollIntervalMs);
  }

  // ---- 3・4. web・worker ---------------------------------------------------
  const targets = (["web", "worker"] as const).map((service) => ({
    service,
    taskDefinition: register(service),
  }));
  for (const { service, taskDefinition } of targets) {
    aws([
      "ecs",
      "update-service",
      "--cluster",
      cluster,
      "--service",
      service,
      "--task-definition",
      taskDefinition,
    ]);
    log(`更新：${service} → ${taskDefinition}`);
  }

  // サービス名 → 待っている新しいタスク定義
  const pending = new Map<string, string>(
    targets.map((t) => [t.service, t.taskDefinition]),
  );
  const serviceDeadline = Date.now() + serviceTimeoutMs;
  while (pending.size > 0) {
    const { services } = aws([
      "ecs",
      "describe-services",
      "--cluster",
      cluster,
      "--services",
      ...pending.keys(),
    ]) as {
      services: {
        serviceName: string;
        deployments: {
          status: string;
          taskDefinition: string;
          rolloutState?: string;
          rolloutStateReason?: string;
        }[];
      }[];
    };
    for (const s of services) {
      const expected = pending.get(s.serviceName);
      if (!expected) continue;
      const ours = s.deployments.find(
        (d) => d.taskDefinition === expected,
      );
      const primary = s.deployments.find(
        (d) => d.status === "PRIMARY",
      );
      if (ours?.rolloutState === "FAILED" || !ours) {
        throw new Error(
          `${s.serviceName} のデプロイが失敗し、前の版に戻った（${ours?.rolloutStateReason ?? "新しいデプロイがない"}）`,
        );
      }
      if (
        ours.rolloutState === "COMPLETED" &&
        primary?.taskDefinition === expected
      ) {
        log(`完了：${s.serviceName}`);
        pending.delete(s.serviceName);
      }
    }
    if (pending.size === 0) break;
    if (Date.now() > serviceDeadline) {
      throw new Error(
        `時間内に終わらなかった：${[...pending.keys()].join("・")}`,
      );
    }
    await sleep(pollIntervalMs);
  }
  return { migrateArn, targets };
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} を設定する`);
  return value;
}

const awsCli: Aws = (args) => {
  const out = execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return out.trim() ? JSON.parse(out) : null;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = (name: string) =>
    env(name)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  deploy(awsCli, {
    cluster: env("ECS_CLUSTER"),
    imageTag: env("IMAGE_TAG"),
    namePrefix: env("NAME_PREFIX"),
    migrateSubnets: list("MIGRATE_SUBNETS"),
    migrateSecurityGroups: list("MIGRATE_SECURITY_GROUPS"),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
