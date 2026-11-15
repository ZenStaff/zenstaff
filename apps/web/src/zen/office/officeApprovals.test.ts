import { describe, expect, it } from "vite-plus/test";

import { zenMessagesFor } from "../i18n/zenI18n";
import { describeApproval, describeCommand, isRiskyApprovalAction } from "./officeApprovals";
import { officeChatText } from "./officeChat.i18n";

const command = (detail: string) => describeApproval({ requestKind: "command", detail });

describe("Office approvals in plain words", () => {
  it("names the site a download or a check goes to", () => {
    expect(command("Bash: curl -sI https://www.example.ro/contact | head -20")).toEqual({
      action: "download",
      subject: "example.ro",
      steps: 2,
    });
    expect(command("Bash: dig +short TXT example.com")).toMatchObject({ action: "checkSite" });
    expect(command("Bash: yt-dlp -f mp4 https://youtube.com/watch?v=1")).toMatchObject({
      action: "downloadVideo",
      subject: "youtube.com",
    });
  });

  it("skips cd, variables and wrappers, and prefers the real work over reading", () => {
    expect(command("Bash: cd /work && LANG=C ffmpeg -i in.mov -vf scale=720:-2 out.mp4")).toEqual({
      action: "editMedia",
      subject: "out.mp4",
      steps: 1,
    });
    expect(command("Bash: ls -la && sudo rm -rf old-drafts")).toMatchObject({
      action: "deleteFiles",
      subject: "old-drafts",
      steps: 2,
    });
    expect(command("Bash: npx lighthouse https://a.ro --quiet")).toMatchObject({
      action: "checkSite",
      subject: "a.ro",
    });
  });

  it("passes over pwd and echo to the step that matters", () => {
    expect(command("Bash: pwd && ls inputs && cat inputs/notes.txt")).toMatchObject({
      action: "readFile",
      subject: "notes.txt",
    });
    expect(command("Bash: echo hi > report.md")).toMatchObject({
      action: "writeFile",
      subject: "report.md",
    });
    expect(command("Bash: pwd")).toMatchObject({ action: "runCommand", subject: null });
  });

  it("recognises installs, scripts and unknown programs", () => {
    expect(command("Bash: npm install --save sharp")).toMatchObject({
      action: "installSoftware",
      subject: "sharp",
    });
    expect(command("Bash: python3 /tmp/x/transcribe.py audio.m4a")).toMatchObject({
      action: "runScript",
      subject: "transcribe.py",
    });
    expect(command('Bash: node "$ZEN_WORKFLOW_DIR/render.mjs"')).toMatchObject({
      action: "runScript",
      subject: "render.mjs",
    });
    expect(command("Bash: frobnicate --all")).toMatchObject({
      action: "runCommand",
      subject: "frobnicate",
    });
    // Codex sends the bare command, without a tool name.
    expect(describeCommand("git status")).toMatchObject({ action: "versionControl" });
    expect(command("pandoc brief.md -o brief.docx")).toMatchObject({
      action: "convertDocument",
      subject: "brief.docx",
    });
  });

  it("reads Claude's file and web tools", () => {
    expect(
      describeApproval({
        requestKind: "file-change",
        detail: "Write: /home/ana/work/press-release.md",
      }),
    ).toEqual({ action: "writeFile", subject: "press-release.md", steps: 1 });
    expect(
      describeApproval({ requestKind: "file-change", detail: "Edit: C:\\work\\notes.md" }),
    ).toMatchObject({
      action: "editFile",
      subject: "notes.md",
    });
    expect(
      describeApproval({
        requestKind: "command",
        detail: 'WebFetch: {"url":"https://www.anaf.ro/info","prompt":"x"}',
      }),
    ).toMatchObject({ action: "openWeb", subject: "anaf.ro" });
    expect(
      describeApproval({
        requestKind: "command",
        detail: 'WebSearch: {"query":"pret faina 2026"}',
      }),
    ).toMatchObject({ action: "searchWeb", subject: "pret faina 2026" });
    expect(
      describeApproval({
        requestKind: "command",
        detail: 'mcp__t3-code__schedule_task: {"cron":"0 9 * * *"}',
      }),
    ).toMatchObject({ action: "scheduleTask" });
    expect(
      describeApproval({ requestKind: "command", detail: "mcp__google_drive__search_files: {}" }),
    ).toMatchObject({ action: "useApp", subject: "google drive: search files" });
    expect(describeApproval({ requestKind: "file-read" })).toMatchObject({
      action: "readFile",
      subject: null,
    });
  });

  it("flags actions that change or remove things", () => {
    expect(isRiskyApprovalAction("deleteFiles")).toBe(true);
    expect(isRiskyApprovalAction("installSoftware")).toBe(true);
    expect(isRiskyApprovalAction("readFile")).toBe(false);
  });

  it("has a Romanian sentence for every action, with comma-below letters", () => {
    const ro = zenMessagesFor(officeChatText, "ro");
    const en = zenMessagesFor(officeChatText, "en");
    for (const action of Object.keys(en.approval) as Array<keyof typeof en.approval>) {
      const sentence = ro.approval[action]("x.md");
      expect(sentence.length, action).toBeGreaterThan(0);
      expect(sentence, action).not.toBe(en.approval[action]("x.md"));
      expect(sentence, action).not.toMatch(/[şţŞŢ]/);
    }
    expect(ro.approval.checkSite("example.ro")).toBe("Să verifice site-ul example.ro");
    expect(ro.approvalMoreSteps(3)).toBe("și încă 2 pași");
    expect(ro.packWorkflows(5)).toBe("5 sarcini în acest pachet");
  });
});
