import { beforeEach, describe, expect, it, vi } from "vitest";
import { runJob } from "@/server/services/jobs";
import { processMessage } from "./process-message";

// runJob（DB を使う）は差し替え、メッセージの扱いだけを確かめる
vi.mock("@/server/services/jobs", () => ({ runJob: vi.fn() }));
const mockedRunJob = vi.mocked(runJob);

describe("processMessage", () => {
  beforeEach(() => {
    mockedRunJob.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("形式の違うメッセージは処理せずに消す", async () => {
    for (const body of [undefined, "not json", '{"id":"x"}']) {
      expect(await processMessage(body, {})).toEqual({
        type: "delete",
      });
    }
    expect(mockedRunJob).not.toHaveBeenCalled();
  });

  it("終わったジョブは消し、処理中なら置いておく", async () => {
    mockedRunJob.mockResolvedValueOnce({ status: "done" });
    expect(await processMessage('{"jobId":"job1"}', {})).toEqual({
      type: "delete",
    });
    expect(mockedRunJob).toHaveBeenCalledWith("job1", {}, {});

    mockedRunJob.mockResolvedValueOnce({ status: "busy" });
    expect(await processMessage('{"jobId":"job1"}', {})).toEqual({
      type: "keep",
    });
  });

  it("失敗したら回数に応じて間を空けて再試行し、上限に達したら DLQ に任せる", async () => {
    mockedRunJob.mockResolvedValueOnce({
      status: "retry",
      attempts: 1,
    });
    expect(await processMessage('{"jobId":"j"}', {})).toEqual({
      type: "retry",
      afterSeconds: 10,
    });
    mockedRunJob.mockResolvedValueOnce({
      status: "retry",
      attempts: 2,
    });
    expect(await processMessage('{"jobId":"j"}', {})).toEqual({
      type: "retry",
      afterSeconds: 30,
    });
    mockedRunJob.mockResolvedValueOnce({ status: "dead" });
    expect(await processMessage('{"jobId":"j"}', {})).toEqual({
      type: "keep",
    });
  });
});
