import { describe, expect, it } from "vitest";
import {
  type Aws,
  deploy,
  registerInput,
  replaceImageTag,
} from "./ecs-deploy.mts";

const REGISTRY = "111122223333.dkr.ecr.ap-northeast-1.amazonaws.com";

function taskDefinition(component: string, revision: number) {
  return {
    taskDefinitionArn: `arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-prod-${component}:${revision}`,
    family: `flowdesk-prod-${component}`,
    revision,
    status: "ACTIVE",
    registeredAt: "2026-11-25T00:00:00Z",
    requiresAttributes: [],
    compatibilities: ["EC2", "FARGATE"],
    executionRoleArn:
      "arn:aws:iam::111122223333:role/flowdesk-prod-ecs-execution",
    networkMode: "awsvpc",
    cpu: "256",
    memory: "512",
    requiresCompatibilities: ["FARGATE"],
    runtimePlatform: {
      cpuArchitecture: "ARM64",
      operatingSystemFamily: "LINUX",
    },
    containerDefinitions: [
      {
        name: component,
        image: `${REGISTRY}/flowdesk-prod/${component}:git-old`,
        user: "1000:1000",
        secrets: [
          {
            name: "DATABASE_URL",
            valueFrom:
              "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:flowdesk/prod/database-url-AbCdEf",
          },
        ],
      },
    ],
  };
}

type Scenario = {
  migrateExitCode?: number;
  /** describe-services で返す rolloutState の並び（呼ばれるたびに 1 つ進む） */
  rollout?: Record<string, string[]>;
};

/** aws CLI の偽物。呼ばれた操作を順に記録する */
function fakeAws(scenario: Scenario = {}) {
  const calls: string[][] = [];
  let revision = 10;
  let describeTasks = 0;
  const registered = new Map<string, string>();
  const rolloutIndex: Record<string, number> = {};

  const aws: Aws = (args) => {
    calls.push(args);
    const [, op] = args;
    const arg = (name: string) => args[args.indexOf(name) + 1]!;
    switch (op) {
      case "describe-task-definition": {
        const family = arg("--task-definition");
        return {
          taskDefinition: taskDefinition(
            family.replace("flowdesk-prod-", ""),
            9,
          ),
        };
      }
      case "register-task-definition": {
        const input = JSON.parse(arg("--cli-input-json")) as {
          family: string;
        };
        const arn = `arn:aws:ecs:ap-northeast-1:111122223333:task-definition/${input.family}:${++revision}`;
        registered.set(input.family, arn);
        return { taskDefinition: { taskDefinitionArn: arn } };
      }
      case "run-task":
        return {
          tasks: [{ taskArn: "arn:aws:ecs:task/flowdesk-prod/abc" }],
          failures: [],
        };
      case "describe-tasks":
        describeTasks++;
        return {
          tasks: [
            describeTasks < 2
              ? { lastStatus: "RUNNING", containers: [] }
              : {
                  lastStatus: "STOPPED",
                  stoppedReason: "Essential container in task exited",
                  containers: [
                    {
                      name: "migrate",
                      exitCode: scenario.migrateExitCode ?? 0,
                    },
                  ],
                },
          ],
        };
      case "update-service":
        return {};
      case "describe-services": {
        const names = args.slice(args.indexOf("--services") + 1);
        return {
          services: names.map((name) => {
            const states = scenario.rollout?.[name] ?? [
              "IN_PROGRESS",
              "COMPLETED",
            ];
            const i = rolloutIndex[name] ?? 0;
            rolloutIndex[name] = i + 1;
            const state = states[Math.min(i, states.length - 1)]!;
            const ours = registered.get(`flowdesk-prod-${name}`)!;
            return {
              serviceName: name,
              deployments: [
                {
                  status: state === "FAILED" ? "ACTIVE" : "PRIMARY",
                  taskDefinition: ours,
                  rolloutState: state,
                  rolloutStateReason:
                    state === "FAILED"
                      ? "ECS deployment circuit breaker: tasks failed to start."
                      : undefined,
                },
                {
                  status: state === "FAILED" ? "PRIMARY" : "ACTIVE",
                  taskDefinition: `arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-prod-${name}:9`,
                  rolloutState: "COMPLETED",
                },
              ],
            };
          }),
        };
      }
      default:
        throw new Error(`想定していない呼び出し：${args.join(" ")}`);
    }
  };
  return { aws, calls };
}

const options = {
  cluster: "flowdesk-prod",
  imageTag: "git-abc1234",
  namePrefix: "flowdesk-prod",
  migrateSubnets: ["subnet-app-a", "subnet-app-c"],
  migrateSecurityGroups: ["sg-migrate"],
  sleep: async () => {},
  log: () => {},
};

const ops = (calls: string[][]) =>
  calls.map((c) =>
    [
      c[1],
      c.includes("--service") ? c[c.indexOf("--service") + 1] : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

describe("ECS へのデプロイの手順", () => {
  it("migrate を実行して終わってから、web と worker を更新する", async () => {
    const { aws, calls } = fakeAws();
    await deploy(aws, options);

    expect(ops(calls)).toEqual([
      "describe-task-definition",
      "register-task-definition",
      "run-task",
      "describe-tasks",
      "describe-tasks",
      "describe-task-definition",
      "register-task-definition",
      "describe-task-definition",
      "register-task-definition",
      "update-service web",
      "update-service worker",
      "describe-services",
      "describe-services",
    ]);

    const runTask = calls.find((c) => c[1] === "run-task")!;
    expect(runTask[runTask.indexOf("--task-definition") + 1]).toBe(
      "arn:aws:ecs:ap-northeast-1:111122223333:task-definition/flowdesk-prod-migrate:11",
    );
    expect(
      JSON.parse(
        runTask[runTask.indexOf("--network-configuration") + 1]!,
      ),
    ).toEqual({
      awsvpcConfiguration: {
        subnets: ["subnet-app-a", "subnet-app-c"],
        securityGroups: ["sg-migrate"],
        assignPublicIp: "DISABLED",
      },
    });
  });

  it("migrate が失敗したら、web と worker を更新しない", async () => {
    const { aws, calls } = fakeAws({ migrateExitCode: 1 });
    await expect(deploy(aws, options)).rejects.toThrow(
      /migrate が失敗した（終了コード 1/,
    );
    expect(calls.some((c) => c[1] === "update-service")).toBe(false);
  });

  it("サーキットブレーカーが前の版に戻したら失敗にする", async () => {
    const { aws } = fakeAws({
      rollout: { web: ["IN_PROGRESS", "FAILED"] },
    });
    await expect(deploy(aws, options)).rejects.toThrow(
      /web のデプロイが失敗し、前の版に戻った（ECS deployment circuit breaker/,
    );
  });

  it("latest や不正なタグは受け付けない", async () => {
    const { aws, calls } = fakeAws();
    await expect(
      deploy(aws, { ...options, imageTag: "latest" }),
    ).rejects.toThrow(/タグが不正/);
    await expect(
      deploy(aws, { ...options, imageTag: "x; rm -rf /" }),
    ).rejects.toThrow(/タグが不正/);
    expect(calls).toEqual([]);
  });
});

describe("タスク定義の登録し直し", () => {
  it("イメージのタグだけを差し替え、読み取り専用の項目を落とす", () => {
    const current = taskDefinition("web", 9);
    const input = registerInput(current, "web", "git-abc1234");

    expect(Object.keys(input).sort()).toEqual([
      "containerDefinitions",
      "cpu",
      "executionRoleArn",
      "family",
      "memory",
      "networkMode",
      "requiresCompatibilities",
      "runtimePlatform",
    ]);
    expect(input.containerDefinitions).toEqual([
      {
        ...current.containerDefinitions[0],
        image: `${REGISTRY}/flowdesk-prod/web:git-abc1234`,
      },
    ]);
  });

  it("名前の合うコンテナがなければ止める", () => {
    expect(() =>
      registerInput(
        taskDefinition("web", 9),
        "worker",
        "git-abc1234",
      ),
    ).toThrow(/worker という名前のコンテナがない/);
  });

  it("レジストリのポートの : を残す", () => {
    expect(replaceImageTag("localhost:5000/web:old", "new")).toBe(
      "localhost:5000/web:new",
    );
    expect(replaceImageTag("localhost:5000/web", "new")).toBe(
      "localhost:5000/web:new",
    );
  });
});
