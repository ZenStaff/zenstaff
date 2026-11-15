import { zenScheduledWorkflowMarker } from "@t3tools/contracts/zenToolchains";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMyWorkflows,
  MY_WORKFLOWS_LIMIT,
  MY_WORKFLOWS_RUN_LOG_LIMIT,
  type MyWorkflowSource,
  paletteWorkflowGroups,
  parsePins,
  parseRuns,
  recordRun,
  scheduledWorkflowIds,
  setPins,
  togglePin,
} from "./myWorkflowsModel";

const wf = (id: string, company = false): MyWorkflowSource => ({
  id,
  name: id.toUpperCase(),
  icon: "sparkles",
  company,
});

const catalog = ["a", "b", "c", "d", "e", "f", "g"].map((id) => wf(id));
const run = (count: number, lastAt: string) => ({ count, lastAt });

describe("buildMyWorkflows", () => {
  it("lists pins in pin order, then the most used, each once, capped", () => {
    const { rows, hidden } = buildMyWorkflows({
      workflows: catalog,
      pins: ["c", "a"],
      runs: {
        a: run(9, "2026-11-01T00:00:00Z"),
        b: run(2, "2026-11-02T00:00:00Z"),
        d: run(5, "2026-11-01T00:00:00Z"),
        e: run(2, "2026-11-05T00:00:00Z"),
        f: run(1, "2026-11-06T00:00:00Z"),
        g: run(1, "2026-11-01T00:00:00Z"),
      },
      scheduled: new Set(),
    });
    // a is pinned, so its 9 runs do not move it out of pin order; e beats b on recency.
    expect(rows.map((row) => row.id)).toEqual(["c", "a", "d", "e", "b"]);
    expect(rows.length).toBe(MY_WORKFLOWS_LIMIT);
    expect(hidden).toBe(2);
    expect(rows.map((row) => row.pinned)).toEqual([true, true, false, false, false]);
    expect(rows[1]!.runs).toBe(9);
  });

  it("leaves out pins and runs of workflows that are not loaded, and duplicate sources", () => {
    const { rows } = buildMyWorkflows({
      workflows: [wf("a"), wf("a", true), wf("b")],
      pins: ["gone", "b", "b"],
      runs: { removed: run(4, "2026-11-01T00:00:00Z"), a: run(1, "2026-11-01T00:00:00Z") },
      scheduled: new Set(),
    });
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
    // The first source of an id wins.
    expect(rows[1]!.company).toBe(false);
  });

  it("marks company workflows and the ones a scheduled task repeats", () => {
    const { rows } = buildMyWorkflows({
      workflows: [wf("menu", true), wf("posts")],
      pins: ["menu", "posts"],
      runs: {},
      scheduled: new Set(["posts"]),
    });
    expect(rows.map(({ id, company, scheduled }) => ({ id, company, scheduled }))).toEqual([
      { id: "menu", company: true, scheduled: false },
      { id: "posts", company: false, scheduled: true },
    ]);
  });

  it("is empty with no pins and no runs", () => {
    expect(
      buildMyWorkflows({ workflows: catalog, pins: [], runs: {}, scheduled: new Set() }),
    ).toEqual({ rows: [], hidden: 0 });
  });
});

describe("pins", () => {
  it("toggles one pin, adding at the end", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });

  it("pins or unpins every workflow of a pack", () => {
    expect(setPins(["a"], ["a", "b", "c"], true)).toEqual(["a", "b", "c"]);
    expect(setPins(["a", "b", "x"], ["a", "b"], false)).toEqual(["x"]);
  });

  it("reads stored pins defensively", () => {
    expect(parsePins('["a","a",3,"",null,"b"]')).toEqual(["a", "b"]);
    expect(parsePins("{")).toEqual([]);
    expect(parsePins('{"a":1}')).toEqual([]);
    expect(parsePins(null)).toEqual([]);
  });
});

describe("run log", () => {
  it("counts starts and keeps the latest time", () => {
    const once = recordRun({}, "a", "2026-11-01T00:00:00Z");
    const twice = recordRun(once, "a", "2026-11-02T00:00:00Z");
    expect(twice).toEqual({ a: run(2, "2026-11-02T00:00:00Z") });
  });

  it("forgets the least recently used workflows past the limit", () => {
    let runs = {};
    for (let index = 0; index <= MY_WORKFLOWS_RUN_LOG_LIMIT; index += 1) {
      const day = String(index).padStart(3, "0");
      runs = recordRun(runs, `w${day}`, `2026-01-01T00:00:00.${day}Z`);
    }
    expect(Object.keys(runs)).toHaveLength(MY_WORKFLOWS_RUN_LOG_LIMIT);
    expect(runs).not.toHaveProperty("w000");
    expect(runs).toHaveProperty(`w${String(MY_WORKFLOWS_RUN_LOG_LIMIT).padStart(3, "0")}`);
  });

  it("reads a stored log defensively", () => {
    expect(
      parseRuns(
        JSON.stringify({
          a: { count: 2.7, lastAt: "2026-11-01T00:00:00Z" },
          b: { count: 0, lastAt: "2026-11-01T00:00:00Z" },
          c: { count: 1 },
          d: "x",
        }),
      ),
    ).toEqual({ a: run(2, "2026-11-01T00:00:00Z") });
    expect(parseRuns("[1]")).toEqual({});
    expect(parseRuns("nope")).toEqual({});
  });
});

describe("scheduledWorkflowIds", () => {
  it("reads the workflow marker of enabled scheduled tasks only", () => {
    const ids = scheduledWorkflowIds([
      {
        prompt: `${zenScheduledWorkflowMarker("website-watch")}\n\nCheck the menu.`,
        enabled: true,
      },
      { prompt: `${zenScheduledWorkflowMarker("weekly-posts")}\n\nPosts.`, enabled: false },
      { prompt: "Say hello [zen-workflow: inline] in a sentence", enabled: true },
      { prompt: "No marker", enabled: true },
    ]);
    expect([...ids]).toEqual(["website-watch"]);
  });
});

describe("paletteWorkflowGroups", () => {
  it("puts the person's workflows first and every other one by name", () => {
    const groups = paletteWorkflowGroups({
      workflows: [wf("zeta"), wf("alpha"), wf("mid"), wf("beta")],
      pins: ["mid"],
      runs: { beta: run(3, "2026-11-01T00:00:00Z") },
    });
    expect(groups.mine.map((workflow) => workflow.id)).toEqual(["mid", "beta"]);
    expect(groups.rest.map((workflow) => workflow.id)).toEqual(["alpha", "zeta"]);
  });

  it("is not capped like the sidebar", () => {
    const groups = paletteWorkflowGroups({
      workflows: catalog,
      pins: catalog.map((w) => w.id),
      runs: {},
    });
    expect(groups.mine).toHaveLength(catalog.length);
    expect(groups.rest).toEqual([]);
  });
});
