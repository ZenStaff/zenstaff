import type { ZenMemoryFact, ZenMemorySettings } from "@t3tools/contracts/zenMemory";
import { describe, expect, it } from "vite-plus/test";

import { zenMessagesFor } from "../i18n/zenI18n";
import { memoryText } from "./memory.i18n";
import {
  connectionState,
  forgettableEntity,
  formatMemoryDate,
  groupPromises,
  isOverdue,
  localToday,
  promiseGroup,
  quotaPercent,
  sourceLinks,
} from "./memoryModel";

const fact = (overrides: Partial<ZenMemoryFact>): ZenMemoryFact => ({
  id: "f",
  type: "Promise",
  fact: "x",
  validFrom: null,
  validTo: null,
  current: true,
  subject: null,
  object: null,
  owner: null,
  promisedTo: null,
  dueDate: null,
  decisionDate: null,
  status: "open",
  sources: [],
  ...overrides,
});

const settings = (overrides: Partial<ZenMemorySettings>): ZenMemorySettings => ({
  companyId: "brutaria",
  available: true,
  url: null,
  hasKey: false,
  keyStore: null,
  connected: false,
  saveConversations: true,
  pendingCount: 0,
  nextRetryAt: null,
  lastSave: null,
  ...overrides,
});

describe("promise groups", () => {
  const today = "2026-11-07";

  it("puts each status in its section, overdue by the server or by a past due date", () => {
    expect(promiseGroup(fact({ status: "open", dueDate: "2026-11-10" }), today)).toBe("open");
    expect(promiseGroup(fact({ status: "open", dueDate: "2026-11-06" }), today)).toBe("overdue");
    expect(promiseGroup(fact({ status: "overdue" }), today)).toBe("overdue");
    expect(promiseGroup(fact({ status: "done", dueDate: "2026-01-01" }), today)).toBe("done");
    expect(promiseGroup(fact({ status: "cancelled" }), today)).toBe("done");
    expect(promiseGroup(fact({ status: "superseded" }), today)).toBe("done");
    expect(promiseGroup(fact({ status: null }), today)).toBe("open");
    expect(isOverdue(fact({ status: "open", dueDate: "2026-11-07" }), today)).toBe(false);
  });

  it("sorts overdue and open by due date, undated last", () => {
    const groups = groupPromises(
      [
        fact({ id: "late2", dueDate: "2026-11-05" }),
        fact({ id: "soon", dueDate: "2026-11-09" }),
        fact({ id: "late1", dueDate: "2026-11-01" }),
        fact({ id: "undated" }),
        fact({ id: "later", dueDate: "2026-12-01" }),
        fact({ id: "done", status: "done" }),
      ],
      today,
    );
    expect(groups.overdue.map((item) => item.id)).toEqual(["late1", "late2"]);
    expect(groups.open.map((item) => item.id)).toEqual(["soon", "later", "undated"]);
    expect(groups.done.map((item) => item.id)).toEqual(["done"]);
  });
});

describe("sources and actions", () => {
  it("links a source to its chat only when the chat is on this machine", () => {
    const links = sourceLinks(
      fact({
        sources: [
          { threadId: "thr-local", title: "A", user: null, machine: null, project: null, at: null },
          {
            threadId: "thr-remote",
            title: "B",
            user: null,
            machine: null,
            project: null,
            at: null,
          },
          { threadId: null, title: null, user: null, machine: null, project: null, at: null },
        ],
      }),
      new Map([["thr-local", "env-1"]]),
    );
    expect(links.map((link) => link.local)).toEqual([
      { environmentId: "env-1", threadId: "thr-local" },
      null,
      null,
    ]);
  });

  it("forgets the counterparty first, else the subject", () => {
    expect(
      forgettableEntity(
        fact({ subject: { id: "s", name: "Ana" }, object: { id: "o", name: "Hotel" } }),
      ),
    ).toEqual({ id: "o", name: "Hotel" });
    expect(forgettableEntity(fact({ subject: { id: "s", name: "Ana" } }))).toEqual({
      id: "s",
      name: "Ana",
    });
    expect(forgettableEntity(fact({}))).toBeNull();
  });
});

describe("connection and quotas", () => {
  it("tells personal, not set, connected and saving off apart", () => {
    expect(connectionState(null)).toBe("personal");
    expect(connectionState(settings({ available: false }))).toBe("personal");
    expect(connectionState(settings({}))).toBe("not-set");
    expect(connectionState(settings({ connected: true }))).toBe("connected");
    expect(connectionState(settings({ connected: true, saveConversations: false }))).toBe(
      "saving-off",
    );
  });

  it("shows quota use as a capped percentage, 0 for unlimited", () => {
    expect(quotaPercent({ name: "q", limit: 500, used: 125, resetsAt: null })).toBe(25);
    expect(quotaPercent({ name: "q", limit: 500, used: 900, resetsAt: null })).toBe(100);
    expect(quotaPercent({ name: "q", limit: 0, used: 900, resetsAt: null })).toBe(0);
  });

  it("formats dates in the app's language", () => {
    expect(formatMemoryDate("2026-11-13", "ro")).toMatch(/13 nov\.? 2026/);
    expect(formatMemoryDate("2026-11-13", "en")).toBe("Nov 13, 2026");
    expect(formatMemoryDate(null, "en")).toBeNull();
    expect(formatMemoryDate("soon", "en")).toBe("soon");
    expect(localToday(new Date(2026, 10, 7, 23, 30))).toBe("2026-11-07");
  });
});

describe("strings", () => {
  it("has Romanian for every memory string", () => {
    const ro = zenMessagesFor(memoryText, "ro");
    expect(ro.promises).toBe("Promisiuni");
    expect(ro.groupOverdue).toBe("Întârziate");
    expect(ro.status.overdue).toBe("întârziată");
    expect(Object.keys(memoryText.ro).toSorted()).toEqual(Object.keys(memoryText.en).toSorted());
  });
});
