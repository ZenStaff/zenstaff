// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalTimers:off - tests of the plain connector code.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ZEN_CONNECTOR_PATH_KINDS,
  catalogEntryForServer,
  choosePath,
  claudeMcpAddArgs,
  connectorEntryProblems,
  detectConnectIntent,
  detectMcpUrlIntent,
  manualMcpCommand,
  normalizeChatText,
  parseClaudeMcpList,
  searchConnectors,
  type ZenConnectorEntry,
  type ZenPathContext,
} from "@t3tools/contracts/zenConnectors";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { callbackTarget, loginCommand, parseLoginOutput, type RunClaude } from "./claudeCli.ts";
import { handleMcpMessage, signThreadToken, startGateway, verifyThreadToken } from "./gateway.ts";
import {
  ConnectorsManager,
  checkCustomUrl,
  loadCatalog,
  looksLikeSecret,
  serverNameForUrl,
} from "./manager.ts";
import { CONECTARE_SKILL } from "./skill/skill.gen.ts";
import { setZenConnectorThreadResolver, withZenConnectorMcp } from "./threadMcp.ts";
import { agentTools, dispatch } from "./ZenConnectors.ts";

const { entries, problems } = loadCatalog();
const byId = (id: string) => entries.find((entry) => entry.id === id)!;

const temporaryDirs: string[] = [];
function tempDir(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-connectors-"));
  temporaryDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
  setZenConnectorThreadResolver(null);
});

describe("catalog", () => {
  it("every shipped entry validates", () => {
    expect(problems).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });

  it("has the requested apps", () => {
    for (const id of [
      "gmail",
      "outlook",
      "google-drive",
      "onedrive-sharepoint",
      "google-calendar",
      "slack",
      "microsoft-teams",
      "notion",
      "trello",
      "hubspot",
      "pipedrive",
      "smartbill",
      "oblio",
      "efactura-anaf",
      "stripe",
      "shopify",
      "woocommerce",
      "meta-pages",
      "google-business-profile",
      "elevenlabs",
      "horecaos",
    ]) {
      expect(
        entries.some((entry) => entry.id === id),
        id,
      ).toBe(true);
    }
  });

  it("every app has a fallback and says how each path was checked", () => {
    for (const entry of entries) {
      expect(
        entry.paths.some((path) => path.kind === "csv" || path.kind === "automation"),
        `${entry.id} has no export or automation fallback`,
      ).toBe(true);
      for (const path of entry.paths) expect(path.verified.note.length).toBeGreaterThan(5);
    }
  });

  it("Romanian invoicing apps carry their verified API notes", () => {
    expect(byId("smartbill").api?.verified.status).toBe("verified");
    expect(byId("smartbill").api?.auth).toMatch(/Basic.*e-mail.*token/i);
    expect(byId("oblio").api?.auth).toMatch(/client_secret/);
    expect(byId("efactura-anaf").api?.auth).toMatch(/logincert\.anaf\.ro/);
    expect(byId("efactura-anaf").tier).toBe("enterprise");
    expect(byId("saga").paths.map((path) => path.kind)).toEqual(["csv"]);
  });

  it("the catalog never asks for keys, tokens or headers", () => {
    const text = JSON.stringify(entries);
    expect(text).not.toMatch(
      /"(?:fields|secret|apiKey|token|header|headers|clientSecret|password)"\s*:/,
    );
    const bad = {
      ...byId("gmail"),
      paths: [{ ...byId("gmail").paths[0]!, fields: [{ id: "token" }] }],
    };
    expect(connectorEntryProblems(bad).join(" ")).toMatch(/never asks for keys/);
  });

  it("rejects broken entries", () => {
    const base = byId("notion");
    expect(connectorEntryProblems({ ...base, description: { en: "x", ro: "" } }).join(" ")).toMatch(
      /Romanian/,
    );
    expect(
      connectorEntryProblems({ ...base, paths: [{ ...base.paths.at(-1)!, kind: "browser" }] }).join(
        " ",
      ),
    ).toMatch(/tosAllowsBrowser/);
    expect(connectorEntryProblems({ ...base, aliases: ["Notion"] }).join(" ")).toMatch(/aliases/);
    expect(
      connectorEntryProblems({
        ...base,
        paths: [{ ...base.paths[1]!, mcp: { transport: "http", url: "http://x", auth: "oauth" } }],
      }).join(" "),
    ).toMatch(/https/);
    expect(
      connectorEntryProblems({ ...base, paths: [base.paths[0]!, base.paths[0]!] }).join(" "),
    ).toMatch(/twice/);
    expect(ZEN_CONNECTOR_PATH_KINDS).toEqual([
      "native",
      "local-mcp",
      "automation",
      "csv",
      "browser",
    ]);
  });
});

describe("intent from chat", () => {
  const positive: ReadonlyArray<[string, string]> = [
    ["conectează-mi Gmail", "gmail"],
    ["Conecteaza-mi gmailul te rog", "gmail"],
    ["vreau să lucrezi în SmartBill", "smartbill"],
    ["poți să lucrezi direct în smartbill?", "smartbill"],
    ["leagă HubSpot-ul nostru", "hubspot"],
    ["integrează Notion cu tine", "notion"],
    ["Conectați contul de Trello", "trello"],
    ["dă-ți acces la Google Drive", "google-drive"],
    ["conectează-mi pagina de Facebook", "meta-pages"],
    ["conectare la SPV", "efactura-anaf"],
    ["connect my Gmail", "gmail"],
    ["Please connect our Notion workspace", "notion"],
    ["can you hook up Stripe?", "stripe"],
    ["I want you to work in HubSpot", "hubspot"],
    ["connect us to HoReCaOS", "horecaos"],
    ["set up the Slack integration", "slack"],
    ["Conectează-mi Google Calendar și Gmail", "google-calendar"],
  ];
  it.each(positive)("%s -> %s", (text, appId) => {
    expect(detectConnectIntent(text, entries)?.appId).toBe(appId);
  });

  it("a kind without a brand asks which one", () => {
    const crm = detectConnectIntent("leagă CRM-ul nostru", entries);
    expect(crm?.appId).toBeNull();
    expect(crm?.category).toBe("crm");
    expect(crm?.candidates).toEqual(expect.arrayContaining(["hubspot", "pipedrive"]));
    expect(detectConnectIntent("connect our invoicing app", entries)?.category).toBe("invoicing");
    expect(
      detectConnectIntent("Conectează-mi Google Calendar și Gmail", entries)?.candidates,
    ).toContain("gmail");
  });

  const negative = [
    "Scrie un e-mail către client despre factura din SmartBill",
    "Trimite-i lui Ion raportul din HubSpot",
    "Here is the link to our Notion page with the plan",
    "Can you summarise the Gmail thread I pasted?",
    "Maria lucrează în SmartBill de doi ani",
    "leagă paragrafele astea într-un text cozi",
    "conectează-te la ședință la ora 10",
    "Connect the dots between these two reports",
    "Cum export facturile din Oblio?",
    "We use Stripe and Shopify for the shop",
    "Fă-mi o postare pentru pagina de Facebook",
    "conectează imprimanta la wifi",
    "Please add Stripe numbers to the report",
    "",
    `conectează-mi Gmail ${"x".repeat(700)}`,
  ];
  it.each(negative)("no card for: %s", (text) => {
    expect(detectConnectIntent(text, entries)).toBeNull();
  });

  it("a public MCP address with a connect phrase becomes a card", () => {
    expect(detectMcpUrlIntent("conectează-l, te rog: https://mcp.deepwiki.com/mcp.")).toBe(
      "https://mcp.deepwiki.com/mcp",
    );
    expect(detectMcpUrlIntent("connect https://learn.microsoft.com/api/mcp")).toBe(
      "https://learn.microsoft.com/api/mcp",
    );
    expect(detectMcpUrlIntent("connect https://example.com/blog")).toBeNull();
    expect(detectMcpUrlIntent("citește https://mcp.deepwiki.com/mcp")).toBeNull();
  });

  it("normalises Romanian diacritics, both comma and cedilla forms", () => {
    expect(normalizeChatText("Conectează-mi Ştiinţa ȘI Țara")).toBe(
      "conecteaza-mi stiinta si tara",
    );
  });

  it("search finds apps by name, alias and kind", () => {
    expect(searchConnectors("smart bill", entries)[0]?.id).toBe("smartbill");
    expect(searchConnectors("facturare", entries).map((entry) => entry.id)).toContain("oblio");
    expect(searchConnectors("anaf", entries)[0]?.id).toBe("efactura-anaf");
  });
});

describe("path choice", () => {
  const context = (patch: Partial<ZenPathContext> = {}): ZenPathContext => ({
    claudeCli: true,
    hasAutomation: false,
    browserAvailable: true,
    scope: "personal",
    isRunner: false,
    ...patch,
  });

  it("prefers the AI account connector for Gmail, then export", () => {
    const choice = choosePath(byId("gmail"), context());
    expect(choice.chosen?.kind).toBe("native");
    expect(choice.options.map((option) => option.kind)).toEqual(["native", "csv"]);
  });

  it("SmartBill: Zapier only once Zapier is connected, else the export", () => {
    expect(choosePath(byId("smartbill"), context()).chosen?.kind).toBe("csv");
    expect(choosePath(byId("smartbill"), context()).options[0]?.block).toBe("needs-automation");
    expect(choosePath(byId("smartbill"), context({ hasAutomation: true })).chosen?.kind).toBe(
      "automation",
    );
  });

  it("company scope and enterprise apps need the runner for machine paths", () => {
    const horeca = choosePath(byId("horecaos"), context({ scope: "company" }));
    expect(horeca.options.find((option) => option.kind === "local-mcp")?.block).toBe(
      "needs-runner",
    );
    expect(horeca.chosen?.kind).toBe("csv");
    expect(
      choosePath(byId("horecaos"), context({ scope: "company", isRunner: true })).chosen?.kind,
    ).toBe("native");
  });

  it("without Claude Code a local MCP is blocked, the preferred kind wins when available", () => {
    expect(choosePath(byId("notion"), context({ claudeCli: false })).options[1]?.block).toBe(
      "no-claude",
    );
    expect(choosePath(byId("notion"), context(), "local-mcp").chosen?.kind).toBe("local-mcp");
    expect(
      choosePath(byId("notion"), context({ claudeCli: false }), "local-mcp").chosen?.kind,
    ).toBe("native");
  });

  it("a server that needs the person's own key is offered but never chosen first", () => {
    const choice = choosePath(byId("elevenlabs"), context({ hasAutomation: true }));
    expect(choice.options[0]?.manual).toBe(true);
    expect(choice.chosen?.kind).toBe("automation");
    const path = byId("elevenlabs").paths[0]!;
    expect(manualMcpCommand(byId("elevenlabs"), path.mcp!)).toBe(
      "claude mcp add --scope user elevenlabs -e ELEVENLABS_API_KEY=<ELEVENLABS_API_KEY> -- uvx elevenlabs-mcp",
    );
  });

  it("builds `claude mcp add` without keys or headers", () => {
    const path = byId("horecaos").paths.find((candidate) => candidate.kind === "local-mcp")!;
    expect(claudeMcpAddArgs(byId("horecaos"), path.mcp!, "user")).toEqual([
      "mcp",
      "add",
      "--transport",
      "http",
      "--scope",
      "user",
      "horecaos",
      "https://app.horecaos.org/api/mcp",
    ]);
  });
});

const MCP_LIST = `Checking MCP server health…

claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai HorecaOS: https://app.horecaos.org/api/mcp - ✔ Connected
claude.ai WordPress.com: https://public-api.wordpress.com/wpcom/v2/mcp/v1 - ! Needs authentication
claude.ai Salarizare: https://salarizare.example/api/mcp - ! Connected · tools fetch failed — Invalid result
plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected
Railway: npx -y @railway/mcp-server - ✘ Failed to connect — -32001: rejected
notion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication
deepwiki: https://mcp.deepwiki.com/mcp (HTTP) - ✔ Connected
`;

describe("provider state", () => {
  it("parses `claude mcp list`", () => {
    const servers = parseClaudeMcpList(MCP_LIST);
    expect(servers.map((server) => [server.name, server.origin, server.health])).toEqual([
      ["claude.ai Gmail", "account", "connected"],
      ["claude.ai HorecaOS", "account", "connected"],
      ["claude.ai WordPress.com", "account", "needs-auth"],
      ["claude.ai Salarizare", "account", "connected"],
      ["plugin:playwright:playwright", "plugin", "connected"],
      ["Railway", "local", "failed"],
      ["notion", "local", "needs-auth"],
      ["deepwiki", "local", "connected"],
    ]);
    expect(servers[6]?.target).toBe("https://mcp.notion.com/mcp");
  });

  it("maps servers to catalog apps by host, then by name", () => {
    const servers = parseClaudeMcpList(MCP_LIST);
    expect(catalogEntryForServer(servers[0]!, entries)?.id).toBe("gmail");
    expect(catalogEntryForServer(servers[1]!, entries)?.id).toBe("horecaos");
    expect(catalogEntryForServer(servers[6]!, entries)?.id).toBe("notion");
    expect(catalogEntryForServer(servers[7]!, entries)).toBeNull();
    expect(
      catalogEntryForServer(
        { name: "claude.ai Trello", target: "https://other.example/x" },
        entries,
      )?.id,
    ).toBe("trello");
  });
});

describe("Claude Code sign-in", () => {
  const LOGIN_OUTPUT =
    'Starting authentication for "horecaos"…\r\nIf the browser didn\'t open, visit:\r\n  \u001b]8;;https://app.horecaos.org/oauth/authorize?response_type=code&client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A50540%2Fcallback&state=abc\u0007https://app.horecaos.org/oauth/authorize?...\u001b]8;;\u0007\r\nWaiting for authorization…\r\n';

  it("finds the link and the callback port", () => {
    expect(parseLoginOutput(LOGIN_OUTPUT)).toEqual({
      url: "https://app.horecaos.org/oauth/authorize?response_type=code&client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A50540%2Fcallback&state=abc",
      port: 50540,
    });
    expect(parseLoginOutput("no link here")).toBeNull();
  });

  it("only hands localhost callbacks for that port to Claude Code", () => {
    expect(callbackTarget("http://localhost:50540/callback?code=c&state=s", 50540)).toBe(
      "http://127.0.0.1:50540/callback?code=c&state=s",
    );
    expect(callbackTarget("http://localhost:50541/callback?code=c&state=s", 50540)).toBeNull();
    expect(callbackTarget("https://evil.example/callback?code=c&state=s", 50540)).toBeNull();
    expect(callbackTarget("http://localhost:50540/other?code=c&state=s", 50540)).toBeNull();
    expect(callbackTarget("http://localhost:50540/callback?code=c", 50540)).toBeNull();
  });

  it("runs under a pseudo-terminal where one exists", () => {
    expect(loginCommand("claude", "horecaos", "linux")).toEqual({
      command: "script",
      args: ["-qfec", "'claude' mcp login 'horecaos'", "/dev/null"],
    });
    expect(loginCommand("claude", "x", "darwin").args.slice(0, 2)).toEqual(["-q", "/dev/null"]);
  });
});

describe("zen-connect MCP server", () => {
  it("signs thread tokens", () => {
    const secret = Buffer.alloc(32, 7);
    const token = signThreadToken(secret, "thread-1");
    expect(verifyThreadToken(secret, `Bearer ${token}`)).toBe("thread-1");
    expect(verifyThreadToken(secret, `Bearer ${token}x`)).toBeNull();
    expect(verifyThreadToken(Buffer.alloc(32, 8), `Bearer ${token}`)).toBeNull();
    expect(verifyThreadToken(secret, undefined)).toBeNull();
  });

  it("answers MCP over HTTP for signed threads only", async () => {
    const gateway = await startGateway(
      [
        {
          name: "echo",
          description: "echo",
          inputSchema: { type: "object" },
          readOnly: true,
          run: async (threadId, args) => `${threadId}:${JSON.stringify(args)}`,
        },
      ],
      "Use me.",
    );
    try {
      const post = (body: unknown, auth?: string) =>
        fetch(gateway.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
          body: JSON.stringify(body),
        });
      expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(401);
      const auth = `Bearer ${gateway.tokenFor("t-9")}`;
      const init: any = await (
        await post(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18" },
          },
          auth,
        )
      ).json();
      expect(init.result.instructions).toBe("Use me.");
      expect(init.result.protocolVersion).toBe("2025-06-18");
      expect(
        (await post({ jsonrpc: "2.0", method: "notifications/initialized" }, auth)).status,
      ).toBe(202);
      const call: any = await (
        await post(
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "echo", arguments: { a: 1 } },
          },
          auth,
        )
      ).json();
      expect(call.result.content[0].text).toBe('t-9:{"a":1}');
    } finally {
      await gateway.close();
    }
  });

  it("unknown tools and methods are errors", async () => {
    expect(
      await handleMcpMessage(
        { id: 1, method: "tools/call", params: { name: "nope" } },
        "t",
        [],
        "",
      ),
    ).toMatchObject({ error: { code: -32602 } });
    expect(await handleMcpMessage({ id: 1, method: "resources/list" }, "t", [], "")).toMatchObject({
      error: { code: -32601 },
    });
  });

  it("every Claude thread gets zen-connect, pre-approved, and the URL follows the version", () => {
    expect(withZenConnectorMcp("t", { allowedTools: ["Read"] })).toEqual({
      allowedTools: ["Read"],
    });
    let version = 1;
    setZenConnectorThreadResolver((threadId) => ({
      url: `http://127.0.0.1:9/mcp?v=${version}`,
      authorization: `Bearer ${threadId}`,
    }));
    const first = withZenConnectorMcp<{
      allowedTools?: ReadonlyArray<string>;
      mcpServers?: Record<string, unknown>;
    }>("t", { mcpServers: { "t3-code": { type: "http" } } });
    expect(first.allowedTools).toEqual(["mcp__zen-connect__*"]);
    expect(Object.keys(first.mcpServers ?? {})).toEqual(["t3-code", "zen-connect"]);
    version = 2;
    expect(JSON.stringify(withZenConnectorMcp("t", {}))).not.toBe(JSON.stringify(first));
  });

  it("ships the Conectare skill as the server instructions", () => {
    const markdown = NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "skill", "SKILL.md"),
      "utf8",
    );
    expect(CONECTARE_SKILL).toBe(markdown);
    expect(CONECTARE_SKILL).toMatch(/name: conectare/);
    expect(CONECTARE_SKILL).toMatch(/never keeps passwords, API keys or tokens/i);
  });
});

/** A fake `claude` CLI: records calls, keeps its own server list. */
function fakeClaude(initial: string[] = []) {
  const servers = new Map<string, { target: string; health: string }>();
  for (const line of initial) {
    const [name, target, health] = line.split("|") as [string, string, string];
    servers.set(name, { target, health });
  }
  const calls: string[][] = [];
  const run: RunClaude = async (args) => {
    calls.push([...args]);
    if (args[0] === "--version") return { code: 0, stdout: "2.1.319 (Claude Code)\n", stderr: "" };
    if (args[1] === "list") {
      const lines = [...servers].map(
        ([name, server]) => `${name}: ${server.target} - ${server.health}`,
      );
      return {
        code: 0,
        stdout: `Checking MCP server health…\n\n${lines.join("\n")}\n`,
        stderr: "",
      };
    }
    if (args[1] === "get") {
      const server = servers.get(args[2]!);
      return server
        ? {
            code: 0,
            stdout: `${args[2]}:\n  Status: ${server.health}\n  URL: ${server.target}\n`,
            stderr: "",
          }
        : { code: 1, stdout: "", stderr: `No MCP server named "${args[2]}".` };
    }
    if (args[1] === "add") {
      const name = args.at(-2)!;
      const url = args.at(-1)!;
      servers.set(name, {
        target: `${url} (HTTP)`,
        health: url.includes("deepwiki") ? "✔ Connected" : "! Needs authentication",
      });
      return { code: 0, stdout: `Added HTTP MCP server ${name}\n`, stderr: "" };
    }
    if (args[1] === "remove") {
      servers.delete(args[2]!);
      return { code: 0, stdout: "Removed", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unknown" };
  };
  return { run, calls, servers };
}

function makeManager(home: string, run: RunClaude, bin = "claude-not-installed") {
  return new ConnectorsManager({
    zenHome: home,
    stateDir: NodePath.join(home, "state"),
    workflowsAssetsDir: null,
    cli: { bin, env: { ...process.env }, platform: HostProcess.Platform.defaultValue() },
    run,
    cwd: home,
    mcpScope: "user",
    browserAvailable: false,
  });
}

/** Every file Zen wrote under its home, with contents. */
function filesUnder(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const name of NodeFS.readdirSync(dir, { recursive: true }) as string[]) {
    const file = NodePath.join(dir, name);
    if (NodeFS.statSync(file).isFile()) out.push([name, NodeFS.readFileSync(file, "utf8")]);
  }
  return out;
}

describe("manager", () => {
  it("lists connections from Claude Code and links them to apps and workflows", async () => {
    const home = tempDir();
    const workflow = NodePath.join(home, "workflows", "inbox-digest");
    NodeFS.mkdirSync(workflow, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(workflow, "workflow.json"),
      JSON.stringify({
        id: "inbox-digest",
        name: "Inbox digest",
        requires: { connectors: [{ id: "gmail" }] },
      }),
    );
    const fake = fakeClaude([
      "claude.ai Gmail|https://gmailmcp.googleapis.com/mcp/v1|✔ Connected",
      "deepwiki|https://mcp.deepwiki.com/mcp (HTTP)|✔ Connected",
    ]);
    const manager = makeManager(home, fake.run);
    const overview = await manager.overview(true);
    expect(overview.provider).toMatchObject({ claudeCli: true, version: "2.1.319" });
    expect(
      overview.connections.map((connection) => [
        connection.name,
        connection.appId,
        connection.removable,
        connection.usedBy,
      ]),
    ).toEqual([
      ["claude.ai Gmail", "gmail", false, ["Inbox digest"]],
      ["deepwiki", null, true, []],
    ]);
    await expect(manager.remove("claude.ai Gmail")).rejects.toThrow(
      /claude\.ai > Settings > Connectors/,
    );
    await manager.remove("deepwiki");
    expect(fake.calls.at(-1)).toEqual(["mcp", "remove", "deepwiki"]);
  });

  it("cards: one per message, deduplicated, dismissable", () => {
    const manager = makeManager(tempDir(), fakeClaude().run);
    const first = manager.createRequest({
      threadId: "th1",
      appId: "gmail",
      source: "chat",
      messageId: "m1",
    });
    expect(manager.createRequest({ threadId: "th1", appId: "gmail", source: "agent" }).id).toBe(
      first.id,
    );
    expect(
      manager.createRequest({
        threadId: "th1",
        appId: "smartbill",
        source: "chat",
        messageId: "m2",
      }).scope,
    ).toBe("personal");
    expect(manager.listRequests("th1")).toHaveLength(2);
    // Switching the scope on a card opens a new card (the old one is then dismissed).
    expect(
      manager.createRequest({ threadId: "th1", appId: "gmail", source: "chat", scope: "company" })
        .id,
    ).not.toBe(first.id);
    manager.updateRequest(
      manager.listRequests("th1").find((request) => request.scope === "company")!.id,
      { state: "dismissed" },
    );
    manager.updateRequest(first.id, { state: "dismissed" });
    expect(manager.listRequests("th1").map((request) => request.appId)).toEqual(["smartbill"]);
    expect(() => manager.createRequest({ threadId: "th1", appId: "nope", source: "chat" })).toThrow(
      /catalog/,
    );
  });

  it("adds a public MCP by address and closes the card when it answers", async () => {
    const fake = fakeClaude();
    const manager = makeManager(tempDir(), fake.run);
    const request = manager.createRequest({
      threadId: "th",
      source: "agent",
      customUrl: "https://mcp.deepwiki.com/mcp",
    });
    const result = await dispatch(manager, "connect.custom", {
      url: "https://mcp.deepwiki.com/mcp",
      requestId: request.id,
    });
    expect(result).toMatchObject({ server: "deepwiki", login: null });
    expect(fake.calls).toContainEqual([
      "mcp",
      "add",
      "--transport",
      "http",
      "--scope",
      "user",
      "deepwiki",
      "https://mcp.deepwiki.com/mcp",
    ]);
    expect(manager.listRequests("th")[0]?.state).toBe("connected");
    expect(manager.version).toBeGreaterThan(1);
  });

  it("refuses custom addresses that are local, plain http or carry a key", () => {
    expect(() => checkCustomUrl("http://mcp.example.com/mcp")).toThrow(/https/);
    expect(() => checkCustomUrl("https://127.0.0.1/mcp")).toThrow(/public/);
    expect(() => checkCustomUrl("https://x.example.com/mcp?api_key=abc")).toThrow(/key/);
    expect(serverNameForUrl("https://mcp.deepwiki.com/mcp")).toBe("deepwiki");
  });

  it("company connections and enterprise apps need the runner and a grant", async () => {
    const home = tempDir();
    const manager = makeManager(home, fakeClaude().run);
    await expect(manager.add({ appId: "horecaos", scope: "company" })).rejects.toThrow(
      /always-on server/,
    );
    expect(manager.enterpriseLock(byId("efactura-anaf"))).toMatch(/always-on server/);
    NodeFS.mkdirSync(NodePath.join(home, "toolchains"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(home, "toolchains", "state.json"),
      JSON.stringify({ settings: { companyRunner: true } }),
    );
    expect(manager.enterpriseLock(byId("efactura-anaf"))).toMatch(/admin/);
    expect(() =>
      manager.grant({ appId: "efactura-anaf", user: "local", adminConfirmed: false }),
    ).toThrow(/admin/);
    manager.grant({ appId: "efactura-anaf", user: "local", adminConfirmed: true });
    expect(manager.enterpriseLock(byId("efactura-anaf"))).toBeNull();
  });

  it("support requests are kept locally and refuse secrets", () => {
    const manager = makeManager(tempDir(), fakeClaude().run);
    const record = manager.createSupport({
      appId: "smartbill",
      note: "Vrem facturile lunare în raport.",
    });
    expect(record).toMatchObject({ appName: "SmartBill", delivery: "local" });
    expect(() =>
      manager.createSupport({ appId: "smartbill", note: "tokenul e sk_live_abcdefghijklmnop1234" }),
    ).toThrow(/passwords or keys/);
    expect(looksLikeSecret("parola: Secret123!")).toBe(true);
    expect(looksLikeSecret("Vreau raportul pe octombrie, mulțumesc")).toBe(false);
  });
});

describe("no connector credential is ever kept by Zen", () => {
  it.skipIf(
    HostProcess.Platform.defaultValue() !== "linux" || !NodeFS.existsSync("/usr/bin/script"),
  )(
    "a full sign-in through Claude Code leaves only cards, support and grants on disk",
    async () => {
      const home = tempDir();
      // A fake `claude` whose login prints a sign-in link and listens for the callback, like
      // Claude Code does; it exits 0 when the callback arrives.
      const bin = NodePath.join(home, "fake-claude.mjs");
      NodeFS.writeFileSync(
        bin,
        `#!/usr/bin/env node
import * as http from "node:http";
const server = http.createServer((req, res) => { res.end("ok"); server.close(); console.log("Authentication successful"); process.exit(0); });
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log("If the browser didn't open, visit:");
  console.log("  https://app.horecaos.org/oauth/authorize?state=STATE-XYZ&redirect_uri=" + encodeURIComponent("http://localhost:" + port + "/callback"));
});
`,
        { mode: 0o755 },
      );
      const fake = fakeClaude();
      const manager = makeManager(home, fake.run, bin);
      const request = manager.createRequest({
        threadId: "th",
        appId: "horecaos",
        source: "chat",
        scope: "personal",
      });
      const added = (await dispatch(manager, "connect.add", {
        appId: "horecaos",
        scope: "personal",
        requestId: request.id,
      })) as {
        login: { id: string };
      };
      // `connect.add` waits until Claude Code printed its link.
      const view = manager.loginStatus(added.login.id);
      expect(view.authorizeUrl).toMatch(/^https:\/\/app\.horecaos\.org\/oauth\/authorize/);
      await expect(
        manager.finishLogin(view.id, "https://evil.example/?code=x&state=y"),
      ).rejects.toThrow(/localhost/);
      const done = await manager.finishLogin(
        view.id,
        `http://localhost:${view.callbackPort}/callback?code=ONE-TIME-CODE-123&state=STATE-XYZ`,
      );
      expect(done.state).toBe("done");
      // The agent's tools and the support log see no secret either.
      const tools = agentTools(manager);
      const listed = await tools.find((tool) => tool.name === "list_connections")!.run("th", {});
      manager.createSupport({ appId: "horecaos", note: "Ajutor la conectare" });
      const files = filesUnder(home).filter(([name]) => name !== "fake-claude.mjs");
      expect(files.map(([name]) => name).toSorted()).toEqual([
        "connectors/requests.json",
        "connectors/support.json",
      ]);
      for (const [, content] of [...files, ["tool", listed] as [string, string]]) {
        expect(content).not.toContain("ONE-TIME-CODE-123");
        expect(content).not.toContain("STATE-XYZ");
        expect(content).not.toContain("oauth/authorize");
        expect(content).not.toMatch(/vault|token"|secret"/i);
      }
    },
  );

  it("the agent's start_connection never asks for keys and its card holds none", async () => {
    const home = tempDir();
    const manager = makeManager(home, fakeClaude().run);
    const tools = agentTools(manager);
    const text = await tools
      .find((tool) => tool.name === "start_connection")!
      .run("th", { app: "smartbill" });
    expect(text).toMatch(/do not ask for keys or passwords/);
    const custom = await tools
      .find((tool) => tool.name === "start_connection")!
      .run("th2", { app: "deepwiki", mcp_url: "https://mcp.deepwiki.com/mcp" });
    expect(custom).toMatch(/mcp\.deepwiki\.com/);
    expect(manager.listRequests("th2")[0]).toMatchObject({
      appId: null,
      customUrl: "https://mcp.deepwiki.com/mcp",
    });
    const found = await tools
      .find((tool) => tool.name === "find_connector")!
      .run("th", { query: "SmartBill" });
    expect(JSON.parse(found)[0]).toMatchObject({ id: "smartbill", bestPath: "csv" });
    expect(
      Object.keys(
        JSON.parse(NodeFS.readFileSync(NodePath.join(home, "connectors", "requests.json"), "utf8"))
          .requests[0],
      ).toSorted(),
    ).toEqual([
      "appId",
      "candidates",
      "category",
      "createdAt",
      "customUrl",
      "id",
      "messageId",
      "preferredKind",
      "scope",
      "source",
      "state",
      "threadId",
    ]);
  });
});

// Type check: the catalog entries satisfy the contract type.
const _typed: ReadonlyArray<ZenConnectorEntry> = entries;
void _typed;
