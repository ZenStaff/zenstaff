import { describe, expect, it } from "vite-plus/test";

import { folderName, resumeCommand } from "./cliSessionsState";

describe("resumeCommand", () => {
  const sessionId = "0b6f5f3c-8a1e-4c55-9c7e-2f1b8f3f9a10";

  it("changes into the session folder first, quoting it for POSIX shells", () => {
    expect(resumeCommand({ provider: "claudeAgent", sessionId, cwd: "/home/ana/proiect" })).toBe(
      `cd /home/ana/proiect && claude --resume ${sessionId}`,
    );
    expect(resumeCommand({ provider: "claudeAgent", sessionId, cwd: "/home/a/it's mine" })).toBe(
      `cd '/home/a/it'\\''s mine' && claude --resume ${sessionId}`,
    );
    expect(resumeCommand({ provider: "codex", sessionId, cwd: null })).toBe(
      `codex resume ${sessionId}`,
    );
  });

  it("uses PowerShell syntax for Windows folders", () => {
    expect(
      resumeCommand({ provider: "claudeAgent", sessionId, cwd: "C:\\Users\\Alex's\\app" }),
    ).toBe(`Set-Location -LiteralPath 'C:\\Users\\Alex''s\\app'; claude --resume ${sessionId}`);
  });

  it("names folders by their last segment on either platform", () => {
    expect(folderName("/home/ana/proiect/")).toBe("proiect");
    expect(folderName("C:\\work\\horeca")).toBe("horeca");
    expect(folderName(null)).toBe("Unknown folder");
  });
});
