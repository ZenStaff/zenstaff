// Zen Staff: the triage session sends users to ZED-ZEN support, never to upstream's GitHub.
import { assert, it } from "@effect/vitest";

import { ZEN_APP_BASE_NAME, ZEN_SUPPORT_EMAIL, ZEN_SUPPORT_URL } from "@t3tools/contracts/zen";

import {
  buildTriageContext,
  buildTriageLaunchPrompt,
  buildTriageSeedPrompt,
  TRIAGE_PLAYBOOK,
} from "../../triage/triagePrompt.ts";

// Built from pieces so scripts/zen-rebrand.ts does not rewrite the upstream names under test.
const T3 = "T3";
const UPSTREAM_SUPPORT = [
  `${T3} Code`,
  `\`${T3.toLowerCase()} `,
  "gh issue",
  "issues/new",
  "via-triage",
  "raw.githubusercontent.com",
  "app.t3.codes",
];

const context = buildTriageContext({
  generatedAt: "2026-11-14T00:00:00.000Z",
  entry: { kind: "app", client: "desktop" },
  os: "linux x64",
  nodeVersion: "v26.12.1",
  server: "running",
  paths: {
    stateDir: "/s",
    dbPath: "/s/state.sqlite",
    settingsPath: "/s/settings.json",
    logsDir: "/s/logs",
    serviceLogPath: "/s/logs/boot-service.log",
    desktopBackendLogGlob: "/s/logs/server-child*.log*",
    relayClientLogPath: "/s/logs/relay-client.ndjson",
    serverTracePath: "/s/logs/server.trace.ndjson",
    providerEventLogPath: "/s/logs/provider/events.log",
    terminalLogsDir: "/s/logs/terminals",
    providerStatusCacheDir: "/s/caches",
    secretsDir: "/s/secrets",
    sourceCacheDir: "/s/source",
  },
});

it("the triage playbook and prompts name Zen Staff and its support, not upstream's tracker", () => {
  const seed = buildTriageSeedPrompt({
    contextFilePath: "/s/context.md",
    entry: { kind: "cli", cliVersion: "0.2.7", launchedAs: "zen triage" },
  });
  for (const text of [TRIAGE_PLAYBOOK, seed, context, buildTriageLaunchPrompt("/s/p.md")]) {
    for (const upstream of UPSTREAM_SUPPORT) assert.notInclude(text, upstream);
    assert.include(text, ZEN_APP_BASE_NAME);
  }
  for (const text of [TRIAGE_PLAYBOOK, context]) {
    assert.include(text, ZEN_SUPPORT_EMAIL);
    assert.include(text, ZEN_SUPPORT_URL);
  }
  assert.notInclude(context, "github.com");
});
