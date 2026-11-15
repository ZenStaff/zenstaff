// @effect-diagnostics nodeBuiltinImport:off -- node:crypto hashes the daily id; pure functions otherwise.
// Zen Staff anonymous statistics: the state file and the day's counters as pure functions, so the
// service (ZenTelemetry.ts) only does I/O. Nothing is counted while the choice is not "on".
import * as NodeCrypto from "node:crypto";

import {
  ZEN_TELEMETRY_ERROR_TYPES,
  ZEN_TELEMETRY_MAX_KEYS,
  ZEN_TELEMETRY_METRICS,
  ZEN_TELEMETRY_OTHER_PACK,
  ZEN_TELEMETRY_REPORT_VERSION,
  isZenTelemetryPackId,
  parseZenTelemetryReport,
  zenTelemetryEdition,
  zenTelemetryLocale,
  type ZenTelemetryChoice,
  type ZenTelemetryEdition,
  type ZenTelemetryErrorType,
  type ZenTelemetryLocale,
  type ZenTelemetryMetric,
  type ZenTelemetryOs,
  type ZenTelemetryReport,
} from "@t3tools/contracts/zenTelemetry";

/** Reports kept while the endpoint cannot be reached (older ones are dropped). */
const MAX_PENDING_REPORTS = 7;

export interface TelemetryDay {
  readonly day: string;
  readonly counts: Readonly<Record<ZenTelemetryMetric, number>>;
  readonly packs: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, number>>;
}

export interface TelemetryFile {
  readonly v: 1;
  readonly choice: ZenTelemetryChoice | null;
  readonly decidedAt: string | null;
  /** Random, made on this machine when the person says yes; deleted when they say no. */
  readonly installId: string | null;
  readonly locale: ZenTelemetryLocale;
  readonly edition: ZenTelemetryEdition;
  /** The day being counted (only while the choice is "on"). */
  readonly current: TelemetryDay | null;
  /** Finished days waiting to be sent. */
  readonly pending: ReadonlyArray<ZenTelemetryReport>;
}

export interface TelemetryHost {
  readonly version: string;
  readonly os: ZenTelemetryOs;
  readonly arch: string;
}

export const emptyTelemetryFile = (): TelemetryFile => ({
  v: 1,
  choice: null,
  decidedAt: null,
  installId: null,
  locale: "unknown",
  edition: "unknown",
  current: null,
  pending: [],
});

const zeroCounts = (): Record<ZenTelemetryMetric, number> =>
  Object.fromEntries(ZEN_TELEMETRY_METRICS.map((metric) => [metric, 0])) as Record<
    ZenTelemetryMetric,
    number
  >;

const newDay = (day: string): TelemetryDay => ({
  day,
  counts: zeroCounts(),
  packs: {},
  errors: {},
});

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function dailyId(installId: string, day: string): string {
  return NodeCrypto.createHash("sha256").update(`${installId}:${day}`).digest("hex").slice(0, 32);
}

const INSTALL_ID = /^[0-9a-f-]{36}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseCounts(value: unknown, keys: ReadonlyArray<string> | null): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (keys !== null && !keys.includes(key)) continue;
    if (keys === null && !isZenTelemetryPackId(key)) continue;
    if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) out[key] = raw;
  }
  return out;
}

/** Reads the file leniently: anything unexpected falls back to "not asked". */
export function parseTelemetryFile(raw: unknown): TelemetryFile {
  if (typeof raw !== "object" || raw === null) return emptyTelemetryFile();
  const value = raw as Record<string, unknown>;
  const choice = value.choice === "on" || value.choice === "off" ? value.choice : null;
  const installId =
    choice === "on" && typeof value.installId === "string" && INSTALL_ID.test(value.installId)
      ? value.installId
      : null;
  const current = value.current as Record<string, unknown> | null | undefined;
  const pending = Array.isArray(value.pending)
    ? value.pending
        .map(parseZenTelemetryReport)
        .filter((report): report is ZenTelemetryReport => report !== null)
    : [];
  return {
    v: 1,
    choice,
    decidedAt: typeof value.decidedAt === "string" ? value.decidedAt : null,
    installId,
    locale: zenTelemetryLocale(value.locale),
    edition: zenTelemetryEdition(value.edition),
    current:
      choice === "on" &&
      installId !== null &&
      current &&
      typeof current.day === "string" &&
      DAY.test(current.day)
        ? {
            day: current.day,
            counts: { ...zeroCounts(), ...parseCounts(current.counts, ZEN_TELEMETRY_METRICS) },
            packs: parseCounts(current.packs, null),
            errors: parseCounts(current.errors, ZEN_TELEMETRY_ERROR_TYPES),
          }
        : null,
    pending: choice === "on" ? pending.slice(-MAX_PENDING_REPORTS) : [],
  };
}

function reportOf(
  file: TelemetryFile,
  day: TelemetryDay,
  host: TelemetryHost,
): ZenTelemetryReport | null {
  if (file.installId === null) return null;
  return parseZenTelemetryReport({
    v: ZEN_TELEMETRY_REPORT_VERSION,
    day: day.day,
    dailyId: dailyId(file.installId, day.day),
    version: host.version,
    os: host.os,
    arch: host.arch,
    edition: file.edition,
    locale: file.locale,
    counts: day.counts,
    packs: day.packs,
    errors: day.errors,
  });
}

/**
 * Moves a finished day to `pending` and starts `today`. A day is reported only when the app was
 * used (any count, or the app opened: `hello`), which is what "daily active" means.
 */
export function rollDay(file: TelemetryFile, today: string, host: TelemetryHost): TelemetryFile {
  if (file.choice !== "on" || file.installId === null) return file;
  if (file.current === null || file.current.day === today) return file;
  const report = reportOf(file, file.current, host);
  return {
    ...file,
    current: null,
    pending: report === null ? file.pending : [...file.pending, report].slice(-MAX_PENDING_REPORTS),
  };
}

export type TelemetryEvent =
  | { readonly kind: "active" }
  | { readonly kind: "metric"; readonly metric: ZenTelemetryMetric }
  | { readonly kind: "pack"; readonly packId: string }
  | { readonly kind: "error"; readonly type: ZenTelemetryErrorType };

const bump = (
  map: Readonly<Record<string, number>>,
  key: string,
): Readonly<Record<string, number>> =>
  key in map || Object.keys(map).length < ZEN_TELEMETRY_MAX_KEYS
    ? { ...map, [key]: (map[key] ?? 0) + 1 }
    : map;

/** Adds one event to today's counters; a no-op unless the person said yes. */
export function applyEvent(
  file: TelemetryFile,
  today: string,
  host: TelemetryHost,
  event: TelemetryEvent,
): TelemetryFile {
  if (file.choice !== "on" || file.installId === null) return file;
  const rolled = rollDay(file, today, host);
  const day = rolled.current ?? newDay(today);
  const next: TelemetryDay =
    event.kind === "metric"
      ? { ...day, counts: { ...day.counts, [event.metric]: day.counts[event.metric] + 1 } }
      : event.kind === "pack"
        ? { ...day, packs: bump(day.packs, event.packId) }
        : event.kind === "error"
          ? { ...day, errors: bump(day.errors, event.type) }
          : day;
  return { ...rolled, current: next };
}

/** Saying no deletes the install id, today's counters and anything not sent yet. */
export function applyChoice(
  file: TelemetryFile,
  choice: ZenTelemetryChoice,
  input: { readonly now: Date; readonly newInstallId: () => string },
): TelemetryFile {
  if (choice === "off") {
    return {
      ...file,
      choice,
      decidedAt: input.now.toISOString(),
      installId: null,
      current: null,
      pending: [],
    };
  }
  return {
    ...file,
    choice,
    decidedAt: input.now.toISOString(),
    installId: file.installId ?? input.newInstallId(),
  };
}

/**
 * Only ids of packs and built-ins we ship (the bundled registry) are reported; a custom
 * workflow, a community pack or a private registry's pack could carry a company's name.
 */
export function reportablePackId(packId: unknown, officialIds: ReadonlySet<string>): string {
  return isZenTelemetryPackId(packId) && officialIds.has(packId)
    ? packId
    : ZEN_TELEMETRY_OTHER_PACK;
}
