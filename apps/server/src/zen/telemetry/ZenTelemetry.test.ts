// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- temporary state folders.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { parseZenTelemetryReport, ZEN_TELEMETRY_FILE } from "@t3tools/contracts/zenTelemetry";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { commandFeatureUsage } from "../../telemetry/FeatureUsage.ts";
import { eventFromUpstream, makeZenTelemetry } from "./ZenTelemetry.ts";
import {
  applyEvent,
  dailyId,
  emptyTelemetryFile,
  parseTelemetryFile,
  reportablePackId,
} from "./telemetryState.ts";

const host = { version: "0.2.4", os: "linux" as const, arch: "x64" };
const dirs: string[] = [];
const tempDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-telemetry-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

interface Sent {
  readonly url: string;
  readonly body: unknown;
}

function setup(options: { blockedByPolicy?: boolean; status?: number; stateDir?: string } = {}) {
  const stateDir = options.stateDir ?? tempDir();
  let clock = new Date("2026-11-09T10:00:00Z");
  const sent: Sent[] = [];
  let status = options.status ?? 204;
  const telemetry = makeZenTelemetry({
    stateDir,
    endpoint: "https://stats.test/v1/telemetry",
    blockedByPolicy: options.blockedByPolicy ?? false,
    host,
    now: () => clock,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(null, { status });
    }) as unknown as typeof fetch,
  });
  return {
    telemetry,
    sent,
    stateDir,
    file: NodePath.join(stateDir, ZEN_TELEMETRY_FILE),
    setClock: (iso: string) => {
      clock = new Date(iso);
    },
    setStatus: (next: number) => {
      status = next;
    },
  };
}

describe("Zen telemetry (anonymous statistics with consent)", () => {
  it("counts and sends nothing before the person chooses", async () => {
    const { telemetry, sent, file, setClock } = setup();
    expect(telemetry.run("status", {})).toMatchObject({ choice: null });
    telemetry.run("hello", { locale: "ro-RO", edition: "office" });
    telemetry.record({ kind: "metric", metric: "chats" });
    telemetry.run("count", { kind: "workflow", packId: "horeca-kit" });
    setClock("2026-11-10T10:00:00Z");
    await telemetry.tick();
    expect(sent).toEqual([]);
    expect(telemetry.snapshot().current).toBeNull();
    expect(telemetry.snapshot().installId).toBeNull();
    // Only the language and edition the app reported were kept (in memory and on disk).
    const saved = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    expect(saved).toMatchObject({ choice: null, installId: null, current: null, pending: [] });
  });

  it("after yes: counts the day, sends one report the next day, with no identifying data", async () => {
    const { telemetry, sent, file, setClock } = setup();
    telemetry.run("setChoice", { choice: "on", locale: "ro", edition: "office" });
    const installId = telemetry.snapshot().installId!;
    expect(installId).toMatch(/^[0-9a-f-]{36}$/);
    telemetry.record({ kind: "metric", metric: "chats" });
    telemetry.record({ kind: "metric", metric: "chats" });
    telemetry.record({ kind: "metric", metric: "approvals" });
    telemetry.run("count", { kind: "workflow", packId: "horeca-kit" });
    telemetry.run("count", { kind: "workflow", packId: "acme-srl-oferte" });
    telemetry.run("count", { kind: "error", type: "workflow.start_failed" });
    await telemetry.tick();
    expect(sent).toEqual([]); // the day is not over

    setClock("2026-11-10T08:00:00Z");
    await telemetry.tick();
    expect(sent).toHaveLength(1);
    const report = sent[0]!.body as Record<string, unknown>;
    expect(sent[0]!.url).toBe("https://stats.test/v1/telemetry");
    expect(parseZenTelemetryReport(report)).not.toBeNull();
    expect(report).toEqual({
      v: 1,
      day: "2026-11-09",
      dailyId: dailyId(installId, "2026-11-09"),
      version: "0.2.4",
      os: "linux",
      arch: "x64",
      edition: "office",
      locale: "ro",
      counts: { chats: 2, messages: 0, approvals: 1, workflows: 2 },
      // A pack that is not ours (it could carry a company name) is "other".
      packs: { "horeca-kit": 1, other: 1 },
      errors: { "workflow.start_failed": 1 },
    });
    // The install id itself never leaves the machine.
    expect(JSON.stringify(sent)).not.toContain(installId);
    expect(JSON.parse(NodeFS.readFileSync(file, "utf8")).pending).toEqual([]);
  });

  it("keeps a report when the endpoint is down and retries later; drops one it rejects", async () => {
    const { telemetry, sent, setClock, setStatus } = setup({ status: 503 });
    telemetry.run("setChoice", { choice: "on", locale: "en", edition: "code" });
    setClock("2026-11-10T08:00:00Z");
    await telemetry.tick();
    expect(sent).toHaveLength(1);
    expect(telemetry.snapshot().pending).toHaveLength(1);
    setStatus(204);
    setClock("2026-11-10T08:05:00Z");
    await telemetry.tick();
    expect(sent).toHaveLength(1); // waits 15 minutes
    setClock("2026-11-10T08:20:00Z");
    await telemetry.tick();
    expect(sent).toHaveLength(2);
    expect(telemetry.snapshot().pending).toHaveLength(0);

    telemetry.run("hello", {});
    setStatus(400);
    setClock("2026-11-11T08:00:00Z");
    await telemetry.tick();
    expect(sent).toHaveLength(3);
    expect(telemetry.snapshot().pending).toHaveLength(0);
  });

  it("no deletes the install id, the counters and anything not sent", async () => {
    const { telemetry, sent, file, setClock } = setup({ status: 503 });
    telemetry.run("setChoice", { choice: "on" });
    telemetry.record({ kind: "metric", metric: "messages" });
    setClock("2026-11-10T08:00:00Z");
    await telemetry.tick();
    telemetry.record({ kind: "metric", metric: "messages" });
    expect(telemetry.snapshot().pending).toHaveLength(1);
    telemetry.run("setChoice", { choice: "off" });
    const saved = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    expect(saved).toMatchObject({ choice: "off", installId: null, current: null, pending: [] });
    setClock("2026-11-12T08:00:00Z");
    await telemetry.tick();
    expect(sent).toHaveLength(1); // only the failed attempt from before
    // Saying yes again starts with a new install id.
    telemetry.run("setChoice", { choice: "on" });
    expect(telemetry.snapshot().installId).not.toBeNull();
  });

  it("keeps the choice across restarts", () => {
    const first = setup();
    first.telemetry.run("setChoice", { choice: "off" });
    const second = setup({ stateDir: first.stateDir });
    expect(second.telemetry.run("status", {})).toMatchObject({ choice: "off" });
  });

  it("a managed policy that turns telemetry off wins: no choice, no file, nothing sent", async () => {
    const { telemetry, sent, file, setClock } = setup({ blockedByPolicy: true });
    expect(telemetry.run("status", {})).toMatchObject({ choice: "off", blockedByPolicy: true });
    expect(() => telemetry.run("setChoice", { choice: "on" })).toThrow(/organization/);
    telemetry.record({ kind: "metric", metric: "chats" });
    setClock("2026-11-10T08:00:00Z");
    await telemetry.tick();
    expect(sent).toEqual([]);
    expect(NodeFS.existsSync(file)).toBe(false);
  });

  it("rejects counts outside the closed lists", () => {
    const { telemetry } = setup();
    telemetry.run("setChoice", { choice: "on" });
    expect(() =>
      telemetry.run("count", { kind: "error", type: "/home/alex/secret.txt" }),
    ).toThrow();
    expect(() => telemetry.run("count", { kind: "prompt", text: "hello" })).toThrow();
    expect(() => telemetry.run("setChoice", { choice: "maybe" })).toThrow();
  });
});

describe("upstream analytics events become counters, nothing else", () => {
  it("maps chats, messages, approvals and failed turns", () => {
    expect(eventFromUpstream("client.thread.started", { surface: "web" })).toEqual({
      kind: "metric",
      metric: "chats",
    });
    expect(eventFromUpstream("client.turn.requested", {})).toEqual({
      kind: "metric",
      metric: "messages",
    });
    expect(
      eventFromUpstream("feature.used", { feature: "approval.respond", variant: "accept" }),
    ).toEqual({ kind: "metric", metric: "approvals" });
    expect(
      eventFromUpstream("feature.used", { feature: "approval.respond", variant: "decline" }),
    ).toBeNull();
    expect(
      eventFromUpstream("provider.request.completed", { terminalStatus: "failed", model: "x" }),
    ).toEqual({ kind: "error", type: "turn.failed" });
    expect(eventFromUpstream("install.owner_observed", { ownerId: "u1" })).toBeNull();
    expect(eventFromUpstream("server.boot.heartbeat", {})).toBeNull();
  });

  it("an approval response is a tracked feature with its decision", () => {
    expect(
      commandFeatureUsage({
        type: "runtime-request.respond",
        commandId: "c1",
        threadId: "t1",
        requestId: "r1",
        decision: "acceptForSession",
      } as never),
    ).toEqual({ feature: "approval.respond", variant: "acceptForSession" });
  });
});

describe("telemetry state file", () => {
  it("reads a damaged or foreign file as not asked", () => {
    expect(parseTelemetryFile(null)).toEqual(emptyTelemetryFile());
    expect(parseTelemetryFile({ choice: "yes", installId: "x" }).choice).toBeNull();
    // Counters of an install that said no are never kept.
    const off = parseTelemetryFile({
      choice: "off",
      installId: "123e4567-e89b-12d3-a456-426614174000",
      current: { day: "2026-11-09", counts: { chats: 3 } },
    });
    expect(off.installId).toBeNull();
    expect(off.current).toBeNull();
  });

  it("caps the number of pack ids in a day", () => {
    let file = parseTelemetryFile({
      choice: "on",
      installId: "123e4567-e89b-12d3-a456-426614174000",
    });
    for (let index = 0; index < 100; index += 1) {
      file = applyEvent(file, "2026-11-09", host, { kind: "pack", packId: `pack-${index}` });
    }
    expect(Object.keys(file.current!.packs)).toHaveLength(60);
  });

  it("reports only our pack ids", () => {
    const official = new Set(["horeca-kit"]);
    expect(reportablePackId("horeca-kit", official)).toBe("horeca-kit");
    expect(reportablePackId("firma-mea", official)).toBe("other");
    expect(reportablePackId("../etc", official)).toBe("other");
    expect(reportablePackId(undefined, official)).toBe("other");
  });
});
