import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import { effectiveEdition } from "./editionStore";
import {
  zenOfficeAllowsCommand,
  zenOfficeMenuItems,
  zenOfficePaletteItems,
  zenOfficeSidebarThread,
} from "./officeGuards";
import {
  OFFICE_WORK_SUMMARY_PREFIX,
  digestOfficeWork,
  isProviderHookMessage,
  officeTimelineEntries,
  officeWorkEntries,
  officeWorkspaceRelativePath,
} from "./officeTimeline.logic";

describe("edition per device", () => {
  it("prefers this device's choice, then the server default, then Code", () => {
    expect(effectiveEdition("office", "code")).toBe("office");
    expect(effectiveEdition("code", "office")).toBe("code");
    expect(effectiveEdition(null, "office")).toBe("office");
    expect(effectiveEdition(null, null)).toBe("code");
  });
});

describe("Office guards", () => {
  it("blocks terminal, diff, PR, script, branch and worktree shortcuts only in Office", () => {
    for (const command of [
      "terminal.toggle",
      "terminal.new",
      "diff.toggle",
      "pullRequest.copyNumber",
      "script.build.run",
      "composer.branch",
      "composer.workspace",
      "editor.openFavorite",
    ]) {
      expect(zenOfficeAllowsCommand(command, true)).toBe(false);
      expect(zenOfficeAllowsCommand(command, false)).toBe(true);
    }
    expect(zenOfficeAllowsCommand("commandPalette.toggle", true)).toBe(true);
    expect(zenOfficeAllowsCommand("chat.new", true)).toBe(true);
  });

  it("drops developer palette actions in Office", () => {
    const items = [
      { value: "action:new-thread" },
      { value: "action:pull-requests" },
      { value: "action:triage" },
      { value: "action:link-pull-request" },
      { value: "action:settings" },
    ];
    expect(zenOfficePaletteItems(items, true).map((item) => item.value)).toEqual([
      "action:new-thread",
      "action:settings",
    ]);
    expect(zenOfficePaletteItems(items, false)).toHaveLength(5);
  });

  it("removes branch and id menu entries and empty submenus", () => {
    const items = [
      { id: "new-thread-on-branch" },
      { id: "rename" },
      {
        id: "copy",
        children: [{ id: "copy-path" }, { id: "copy-branch" }, { id: "copy-thread-id" }],
      },
      { id: "auto-settle", children: [{ id: "auto-settle:enabled" }] },
    ];
    expect(zenOfficeMenuItems(items, true)).toEqual([
      { id: "rename" },
      { id: "copy", children: [{ id: "copy-path" }] },
    ]);
    expect(zenOfficeMenuItems(items, false)).toBe(items);
  });

  it("strips branch and pull request markers from sidebar threads, keeping the same object", () => {
    const thread = {
      id: "t1",
      branch: "feature/x",
      worktreePath: "/w",
      pullRequests: [{ number: 1 }],
      linkedPullRequest: { number: 1 },
    };
    const stripped = zenOfficeSidebarThread(thread, true);
    expect(stripped).toMatchObject({ branch: null, pullRequests: [], linkedPullRequest: null });
    expect(stripped.worktreePath).toBe("/w");
    expect(zenOfficeSidebarThread(thread, true)).toBe(stripped);
    expect(zenOfficeSidebarThread(thread, false)).toBe(thread);
  });
});

const work = (id: string, entry: Partial<WorkLogEntry>, runId = "run-1"): TimelineEntry =>
  ({
    id,
    kind: "work",
    createdAt: "2026-11-07T10:00:00.000Z",
    entry: { id, createdAt: "2026-11-07T10:00:00.000Z", label: id, tone: "tool", runId, ...entry },
  }) as TimelineEntry;
const message = (id: string): TimelineEntry =>
  ({ id, kind: "message", createdAt: "2026-11-07T10:00:00.000Z", message: { id } }) as never;

describe("Office timeline", () => {
  it("folds tool work into one summary per run and drops hook messages", () => {
    const entries = [
      message("m1"),
      work("cmd", { itemType: "command_execution", command: "ls" }),
      work("think", { itemType: "reasoning", tone: "thinking" }),
      work("edit", { itemType: "file_change", changedFiles: ["/f/press-release.md"] }),
      work("hook", { itemType: "system_notice", tone: "info", label: "Stop says: scanner off" }),
      work("ask", { itemType: "approval_request", tone: "info" }),
      work("other-run", { itemType: "web_search" }, "run-2"),
      message("m2"),
    ];
    const folded = officeTimelineEntries(entries);
    expect(folded.map((entry) => entry.id)).toEqual([
      "m1",
      `${OFFICE_WORK_SUMMARY_PREFIX}cmd`,
      "ask",
      `${OFFICE_WORK_SUMMARY_PREFIX}other-run`,
      "m2",
    ]);
    const summary = folded[1] as Extract<TimelineEntry, { kind: "work" }>;
    expect(officeWorkEntries(summary.entry)?.map((entry) => entry.id)).toEqual([
      "cmd",
      "think",
      "edit",
    ]);
  });

  it("joins finished runs of plain steps to the run's summary instead of repeating them", () => {
    const entries = [
      work("c1", { itemType: "command_execution", command: "ls" }),
      message("m1"),
      work("c2", { itemType: "command_execution", command: "pwd" }),
      message("m2"),
      work("edit", { itemType: "file_change", changedFiles: ["/f/plan.md"] }),
      message("m3"),
      work("c3", { itemType: "command_execution", command: "ls" }),
    ];
    const folded = officeTimelineEntries(entries);
    // The two quiet runs before the edit wait for it; the one after joins it.
    expect(folded.map((entry) => entry.id)).toEqual([
      "m1",
      "m2",
      `${OFFICE_WORK_SUMMARY_PREFIX}edit`,
      "m3",
    ]);
    const summary = folded[2] as Extract<TimelineEntry, { kind: "work" }>;
    expect(officeWorkEntries(summary.entry)?.map((entry) => entry.id)).toEqual([
      "c1",
      "c2",
      "edit",
      "c3",
    ]);
  });

  it("opens a reported file through its workspace-relative path", () => {
    expect(officeWorkspaceRelativePath("/w/docs/plan.md", "/w")).toBe("docs/plan.md");
    expect(officeWorkspaceRelativePath("./docs/plan.md", "/w")).toBe("docs/plan.md");
    expect(officeWorkspaceRelativePath("C:\\W\\a.md", "c:\\w")).toBe("a.md");
    // Outside the folder as spelled: opened as a host file, never as a workspace path.
    expect(officeWorkspaceRelativePath("/other/plan.md", "/w")).toBe("/other/plan.md");
    expect(officeWorkspaceRelativePath("/w2/plan.md", "/w")).toBe("/w2/plan.md");
    expect(officeWorkspaceRelativePath("/w/", "/w")).toBeNull();
  });

  it("opens a file reported through the real path of a symlinked home", () => {
    // /root -> /data/root: the agent's cwd is the physical folder, the thread's is the link.
    const root = "/root/Zen Staff/Firma";
    expect(officeWorkspaceRelativePath("/data/root/Zen Staff/Firma/afis final.png", root)).toBe(
      "/data/root/Zen Staff/Firma/afis final.png",
    );
    expect(officeWorkspaceRelativePath("/root/Zen Staff/Firma/afis final.png", root)).toBe(
      "afis final.png",
    );
    expect(officeWorkspaceRelativePath("/data/root/x.md", undefined)).toBe("/data/root/x.md");
  });

  it("returns the same array when there is nothing to fold", () => {
    const entries = [message("m1"), work("err", { itemType: "error", tone: "error" })];
    expect(officeTimelineEntries(entries)).toBe(entries);
  });

  it("recognises provider hook output", () => {
    const hook = (label: string) =>
      isProviderHookMessage({ id: "h", createdAt: "", label, tone: "info" });
    expect(hook("Stop says: ○○○ Semgrep Guardian: not signed in")).toBe(true);
    expect(hook("SessionStart:compact says: signing you in")).toBe(true);
    expect(hook("You have reached your usage limit")).toBe(false);
  });

  it("digests work into files, reads, searches and other steps", () => {
    const digest = digestOfficeWork([
      { id: "1", createdAt: "", label: "", tone: "tool", changedFiles: ["/a/x.md", "/a/x.md"] },
      {
        id: "2",
        createdAt: "",
        label: "",
        tone: "tool",
        requestKind: "file-read",
        detail: "/a/brief.txt",
      },
      { id: "3", createdAt: "", label: "", tone: "tool", itemType: "web_search" },
      {
        id: "4",
        createdAt: "",
        label: "",
        tone: "tool",
        command: "ls",
        toolLifecycleStatus: "failed",
      },
      { id: "5", createdAt: "", label: "", tone: "thinking", itemType: "reasoning" },
    ]);
    expect(digest).toEqual({
      changedFiles: ["x.md"],
      readFiles: ["brief.txt"],
      webSearches: 1,
      otherSteps: 1,
      active: false,
      failed: 1,
      filePaths: { "x.md": "/a/x.md", "brief.txt": "/a/brief.txt" },
    });
  });
});
