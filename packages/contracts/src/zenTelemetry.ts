// Zen Staff anonymous usage statistics, only after the person says yes: counts per day, never
// content, names, paths or IPs, sent to our own Worker (never upstream's PostHog). The RPC rides
// on ZEN_COMPANIES_RPCS. ZEN.md, "Updates and telemetry".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "./auth.ts";

/** Where reports go. Env override `ZEN_TELEMETRY_URL` (tests, a staging Worker). */
export const ZEN_TELEMETRY_URL = "https://releases.zed-zen.com/v1/telemetry";
export const ZEN_TELEMETRY_URL_ENV = "ZEN_TELEMETRY_URL";
/** Server state file (in the server's state folder). */
export const ZEN_TELEMETRY_FILE = "zen-telemetry.json";
/** Report format version; the Worker rejects others. */
export const ZEN_TELEMETRY_REPORT_VERSION = 1;

export const ZEN_TELEMETRY_WS_METHODS = {
  call: "zen.telemetry.call",
} as const;

/** null: not asked yet (nothing is counted or sent). */
export const ZenTelemetryChoice = Schema.Literals(["on", "off"]);
export type ZenTelemetryChoice = typeof ZenTelemetryChoice.Type;

/** Counters of the day. */
export const ZEN_TELEMETRY_METRICS = ["chats", "messages", "approvals", "workflows"] as const;
export type ZenTelemetryMetric = (typeof ZEN_TELEMETRY_METRICS)[number];

/** Error types: a closed list, so no message or path can ever reach a report. */
export const ZEN_TELEMETRY_ERROR_TYPES = [
  "turn.failed",
  "workflow.start_failed",
  "workflow.prepare_failed",
] as const;
export type ZenTelemetryErrorType = (typeof ZEN_TELEMETRY_ERROR_TYPES)[number];

const ZEN_TELEMETRY_EDITIONS = ["office", "code", "unknown"] as const;
export type ZenTelemetryEdition = (typeof ZEN_TELEMETRY_EDITIONS)[number];
const ZEN_TELEMETRY_LOCALES = ["ro", "en", "unknown"] as const;
export type ZenTelemetryLocale = (typeof ZEN_TELEMETRY_LOCALES)[number];
const ZEN_TELEMETRY_OSES = ["win", "linux", "mac", "other"] as const;
export type ZenTelemetryOs = (typeof ZEN_TELEMETRY_OSES)[number];

/** A pack id that is not one of ours (custom, community, a private registry) is sent as this. */
export const ZEN_TELEMETRY_OTHER_PACK = "other";
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.]{1,32})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_ID = /^[0-9a-f]{32}$/;
/** Packs and error types per report (the Worker drops the rest). */
export const ZEN_TELEMETRY_MAX_KEYS = 60;
const MAX_COUNT = 100_000;

const ZEN_TELEMETRY_OPS = ["status", "hello", "setChoice", "count"] as const;
export type ZenTelemetryOp = (typeof ZEN_TELEMETRY_OPS)[number];

export const ZenTelemetryCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_TELEMETRY_OPS),
  input: Schema.Unknown,
});
export type ZenTelemetryCallInput = typeof ZenTelemetryCallInput.Type;

export class ZenTelemetryError extends Schema.TaggedError<ZenTelemetryError>()(
  "ZenTelemetryError",
  {
    reason: Schema.Literals(["invalid-input", "unavailable"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ZenTelemetryCallRpc = Rpc.make(ZEN_TELEMETRY_WS_METHODS.call, {
  payload: ZenTelemetryCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenTelemetryError, EnvironmentAuthorizationError]),
});

/** Spread into ZEN_COMPANIES_RPCS (so rpc.ts needs no new line). */
export const ZEN_TELEMETRY_RPCS = [ZenTelemetryCallRpc] as const;
export const ZEN_TELEMETRY_RPC_SCOPES = {
  [ZEN_TELEMETRY_WS_METHODS.call]: AuthOrchestrationOperateScope,
} as const;
export const ZEN_TELEMETRY_RPC_AGGREGATES = {
  [ZEN_TELEMETRY_WS_METHODS.call]: "zen",
} as const;

/** What `status`, `hello` and `setChoice` answer. */
export interface ZenTelemetryStatus {
  readonly choice: ZenTelemetryChoice | null;
  /** A managed policy turned telemetry off: the choice is not offered. */
  readonly blockedByPolicy: boolean;
  readonly endpoint: string;
}

/** One install's day, exactly what is sent. */
export interface ZenTelemetryReport {
  readonly v: typeof ZEN_TELEMETRY_REPORT_VERSION;
  /** UTC day the counts belong to. */
  readonly day: string;
  /**
   * sha256(installId + ":" + day), first 32 hex characters: tells two reports of the same
   * install on the same day apart from two installs, and changes every day, so days cannot be
   * linked. The install id itself never leaves the machine.
   */
  readonly dailyId: string;
  readonly version: string;
  readonly os: ZenTelemetryOs;
  readonly arch: string;
  readonly edition: ZenTelemetryEdition;
  readonly locale: ZenTelemetryLocale;
  readonly counts: Readonly<Record<ZenTelemetryMetric, number>>;
  readonly packs: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, number>>;
}

export function zenTelemetryOs(platform: string): ZenTelemetryOs {
  if (platform === "win32") return "win";
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "mac";
  return "other";
}

export function zenTelemetryEdition(value: unknown): ZenTelemetryEdition {
  return value === "office" || value === "code" ? value : "unknown";
}

export function zenTelemetryLocale(value: unknown): ZenTelemetryLocale {
  if (typeof value !== "string") return "unknown";
  const language = value.toLowerCase().split(/[-_]/)[0];
  return language === "ro" || language === "en" ? language : "unknown";
}

const ARCH = /^[a-z0-9_]{1,16}$/;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT
    ? value
    : null;

function countMap(
  value: unknown,
  allowKey: (key: string) => boolean,
): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > ZEN_TELEMETRY_MAX_KEYS) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of entries) {
    const n = count(raw);
    if (!allowKey(key) || n === null) return null;
    if (n > 0) out[key] = n;
  }
  return out;
}

/**
 * The single check of a report, shared by the sender (what it may build) and the Worker
 * (what it accepts). Unknown fields, free text and long values make the whole report invalid.
 */
export function parseZenTelemetryReport(value: unknown): ZenTelemetryReport | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "v",
    "day",
    "dailyId",
    "version",
    "os",
    "arch",
    "edition",
    "locale",
    "counts",
    "packs",
    "errors",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  if (raw.v !== ZEN_TELEMETRY_REPORT_VERSION) return null;
  if (typeof raw.day !== "string" || !DAY.test(raw.day)) return null;
  if (typeof raw.dailyId !== "string" || !DAILY_ID.test(raw.dailyId)) return null;
  if (typeof raw.version !== "string" || !VERSION.test(raw.version)) return null;
  if (!(ZEN_TELEMETRY_OSES as ReadonlyArray<unknown>).includes(raw.os)) return null;
  if (typeof raw.arch !== "string" || !ARCH.test(raw.arch)) return null;
  if (!(ZEN_TELEMETRY_EDITIONS as ReadonlyArray<unknown>).includes(raw.edition)) return null;
  if (!(ZEN_TELEMETRY_LOCALES as ReadonlyArray<unknown>).includes(raw.locale)) return null;
  const counts = countMap(raw.counts, (key) =>
    (ZEN_TELEMETRY_METRICS as ReadonlyArray<string>).includes(key),
  );
  const packs = countMap(raw.packs, (key) => PACK_ID.test(key));
  const errors = countMap(raw.errors, (key) =>
    (ZEN_TELEMETRY_ERROR_TYPES as ReadonlyArray<string>).includes(key),
  );
  if (counts === null || packs === null || errors === null) return null;
  return {
    v: ZEN_TELEMETRY_REPORT_VERSION,
    day: raw.day,
    dailyId: raw.dailyId,
    version: raw.version,
    os: raw.os as ZenTelemetryOs,
    arch: raw.arch,
    edition: raw.edition as ZenTelemetryEdition,
    locale: raw.locale as ZenTelemetryLocale,
    counts: Object.fromEntries(
      ZEN_TELEMETRY_METRICS.map((metric) => [metric, counts[metric] ?? 0]),
    ) as Record<ZenTelemetryMetric, number>,
    packs,
    errors,
  };
}

export function isZenTelemetryPackId(value: unknown): value is string {
  return typeof value === "string" && PACK_ID.test(value);
}
