import { describe, expect, it } from "vite-plus/test";

import { parseRunnerTasks, rememberRunnerTask, type RunnerTask } from "./runnerTasks";

const task = (runId: string, startedAt = "2026-11-08T10:00:00.000Z"): RunnerTask => ({
  companyId: "florarie",
  staffId: "s1",
  runId,
  agentName: "Ioana",
  title: "Planul săptămânii",
  startedAt,
});

describe("my tasks on the company server (review P1-19)", () => {
  const now = Date.parse("2026-11-08T12:00:00.000Z");

  it("keeps the newest first, one entry per run", () => {
    const list = rememberRunnerTask([task("a"), task("b")], task("a"), now);
    expect(list.map((item) => item.runId)).toEqual(["a", "b"]);
  });

  it("forgets runs older than a week and keeps at most 20", () => {
    expect(
      rememberRunnerTask([task("old", "2026-10-01T00:00:00.000Z")], task("new"), now),
    ).toHaveLength(1);
    const many = Array.from({ length: 30 }, (_, index) => task(`r${index}`));
    expect(rememberRunnerTask(many, task("x"), now)).toHaveLength(20);
  });

  it("reads only well-formed entries", () => {
    expect(parseRunnerTasks(null)).toEqual([]);
    expect(parseRunnerTasks("not json")).toEqual([]);
    expect(parseRunnerTasks(JSON.stringify([task("a"), { runId: 1 }]))).toEqual([task("a")]);
  });
});
