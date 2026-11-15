// @effect-diagnostics nodeBuiltinImport:off globalDate:off - temporary files and fixed dates.
// Review 0.2.3, P0-6: a company server never lends the owner's own AI login or personal
// connectors to colleagues without an explicit, recorded choice.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  claudeConfigServerNames,
  companyChatMcpPolicy,
  loadServerConsents,
  mcpRuleName,
  parseServerConfirmation,
  readClaudeConfigServerNames,
  saveServerConsents,
  serverBlockFor,
  type ServerConsent,
} from "./serverConsent.ts";

const NOW = new Date("2026-11-08T10:00:00.000Z");

const OWNER_CONNECTORS = [
  { name: "claude.ai Salarizare", origin: "account" },
  { name: "claude.ai Facebook", origin: "account" },
  { name: "claude.ai Trello", origin: "account" },
  { name: "horeca-local", origin: "user" },
];

const confirm = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: true,
  account: {
    provider: "claude",
    mode: "seat",
    label: "Claude ion@floraria.example (Claude Team)",
    personal: false,
  },
  seen: OWNER_CONNECTORS,
  shared: [],
  ...overrides,
});

describe("company server confirmation", () => {
  it("is required: nothing, a missing account or an unticked acknowledgement is refused", () => {
    expect(parseServerConfirmation(undefined, NOW, "u_ion")).toBeNull();
    expect(parseServerConfirmation({}, NOW, "u_ion")).toBeNull();
    expect(parseServerConfirmation(confirm({ acknowledged: false }), NOW, "u_ion")).toBeNull();
    expect(parseServerConfirmation(confirm({ account: { mode: "seat" } }), NOW, null)).toBeNull();
    expect(
      parseServerConfirmation(
        confirm({ account: { provider: "claude", mode: "seat", label: "  " } }),
        NOW,
        null,
      ),
    ).toBeNull();
  });

  it("records the account named in the dialog, who confirmed it and when", () => {
    const consent = parseServerConfirmation(
      confirm({
        account: {
          provider: "claude",
          mode: "seat",
          label: "Claude ion@mail.example (Claude Max)",
          personal: true,
        },
      }),
      NOW,
      "u_ion",
    )!;
    expect(consent.account).toEqual({
      provider: "claude",
      mode: "seat",
      label: "Claude ion@mail.example (Claude Max)",
      personal: true,
    });
    expect(consent.confirmedBy).toBe("u_ion");
    expect(consent.confirmedAt).toBe(NOW.toISOString());
  });

  it("shares no connector by default and only connectors that were listed", () => {
    expect(parseServerConfirmation(confirm(), NOW, null)!.shared).toEqual([]);
    const consent = parseServerConfirmation(
      confirm({ shared: ["claude.ai Trello", "claude.ai Trello", "never-listed"] }),
      NOW,
      null,
    )!;
    expect(consent.shared).toEqual(["claude.ai Trello"]);
  });

  it("survives a restart (file with mode 0600) and drops broken entries", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-consent-"));
    try {
      const file = NodePath.join(dir, "zen", "company-server.json");
      const consent = parseServerConfirmation(
        confirm({ shared: ["claude.ai Trello"] }),
        NOW,
        "u_ion",
      )!;
      saveServerConsents(file, { hub_iris: consent });
      if (NodePath.sep === "/") expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
      expect(loadServerConsents(file)).toEqual({ hub_iris: consent });
      NodeFS.writeFileSync(
        file,
        JSON.stringify({ version: 1, companies: { a: { account: null }, b: consent } }),
      );
      expect(Object.keys(loadServerConsents(file))).toEqual(["b"]);
      expect(loadServerConsents(NodePath.join(dir, "missing.json"))).toEqual({});
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("company server gate for colleagues' work", () => {
  const consent = parseServerConfirmation(confirm(), NOW, "u_ion")!;
  const account = { provider: "claude", mode: "seat", label: "x" };

  it("refuses until the choice is recorded, even when an AI account was saved before", () => {
    expect(serverBlockFor({ hubCompanyId: "h", consents: {}, companyAis: { h: account } })).toBe(
      "no-consent",
    );
  });

  it("refuses while the company AI account is not set ('Nesetat' is not the machine's account)", () => {
    expect(serverBlockFor({ hubCompanyId: "h", consents: { h: consent }, companyAis: {} })).toBe(
      "no-ai-account",
    );
  });

  it("lets work run once both are there, per company", () => {
    expect(
      serverBlockFor({ hubCompanyId: "h", consents: { h: consent }, companyAis: { h: account } }),
    ).toBeNull();
    expect(
      serverBlockFor({
        hubCompanyId: "other",
        consents: { h: consent },
        companyAis: { h: account },
      }),
    ).toBe("no-consent");
  });
});

describe("connectors in company chats", () => {
  it("denies every personal connector and turns claude.ai connectors off without a choice", () => {
    const policy = companyChatMcpPolicy(undefined, ["horeca-local", "salarizare"]);
    expect(policy.env).toEqual({ ENABLE_CLAUDEAI_MCP_SERVERS: "false" });
    expect(policy.deny).toEqual(["mcp__horeca-local", "mcp__salarizare"]);
  });

  it("denies the ones not shared after a confirmation that shares nothing", () => {
    const consent = parseServerConfirmation(confirm(), NOW, null)!;
    const policy = companyChatMcpPolicy(consent, []);
    expect(policy.env).toEqual({ ENABLE_CLAUDEAI_MCP_SERVERS: "false" });
    expect(policy.deny).toEqual([
      "mcp__claude_ai_Facebook",
      "mcp__claude_ai_Salarizare",
      "mcp__claude_ai_Trello",
      "mcp__horeca-local",
    ]);
  });

  it("keeps a shared claude.ai connector and still denies the owner's other ones by name", () => {
    const consent: ServerConsent = parseServerConfirmation(
      confirm({ shared: ["claude.ai Trello"] }),
      NOW,
      null,
    )!;
    const policy = companyChatMcpPolicy(consent, ["horeca-local", "new-personal"]);
    expect(policy.env).toEqual({});
    expect(policy.deny).toContain("mcp__claude_ai_Salarizare");
    expect(policy.deny).toContain("mcp__claude_ai_Facebook");
    expect(policy.deny).not.toContain("mcp__claude_ai_Trello");
    // Added after the confirmation: private by default.
    expect(policy.deny).toContain("mcp__new-personal");
  });

  it("never denies Zen's own tools", () => {
    const policy = companyChatMcpPolicy(undefined, ["t3-code", "zen-memory", "x"]);
    expect(policy.deny).toEqual(["mcp__x"]);
  });

  it("names rules the way Claude Code names MCP tools", () => {
    expect(mcpRuleName("claude.ai Google Drive")).toBe("mcp__claude_ai_Google_Drive");
    expect(mcpRuleName("claude.ai WordPress.com")).toBe("mcp__claude_ai_WordPress_com");
    expect(mcpRuleName("my-server_1")).toBe("mcp__my-server_1");
  });

  it("reads user-scope servers and the folder's local ones from Claude Code's config", () => {
    const config = {
      mcpServers: { salarizare: {}, trello: {} },
      projects: {
        "/home/ion/Florarie": { mcpServers: { "folder-only": {} } },
        "/home/ion/Other": { mcpServers: { elsewhere: {} } },
      },
    };
    expect(claudeConfigServerNames(config, "/home/ion/Florarie/").toSorted()).toEqual([
      "folder-only",
      "salarizare",
      "trello",
    ]);
    expect(claudeConfigServerNames(null, undefined)).toEqual([]);
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-claude-config-"));
    try {
      NodeFS.writeFileSync(NodePath.join(dir, ".claude.json"), JSON.stringify(config));
      expect(readClaudeConfigServerNames(undefined, { CLAUDE_CONFIG_DIR: dir }).toSorted()).toEqual(
        ["salarizare", "trello"],
      );
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
