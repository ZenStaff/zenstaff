// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off globalFetch:off -- One small owner-only state file and one POST a day.
// Zen Staff anonymous statistics (`zen.telemetry.call {op, input}`). Replaces upstream's PostHog
// telemetry: `layer` provides upstream's AnalyticsService too, so the events upstream already
// records (a chat started, a message sent, an approval) become counters here and nothing ever
// goes to upstream's ingest. Nothing is counted or sent before the person chooses "on"
// (first-run screen, the one-time question after an update, Settings > Privacy). Once a day
// the finished day goes to our endpoint as one report (contracts/zenTelemetry.ts). ZEN.md,
// "Updates and telemetry".
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZEN_TELEMETRY_FILE,
  ZEN_TELEMETRY_URL,
  ZEN_TELEMETRY_URL_ENV,
  ZEN_TELEMETRY_WS_METHODS,
  ZenTelemetryError,
  zenTelemetryEdition,
  zenTelemetryLocale,
  zenTelemetryOs,
  type ZenTelemetryCallInput,
  type ZenTelemetryErrorType,
  type ZenTelemetryStatus,
  ZEN_TELEMETRY_ERROR_TYPES,
} from "@t3tools/contracts/zenTelemetry";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import packageJson from "../../../package.json" with { type: "json" };
import * as ServerConfig from "../../config.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import { AnalyticsService } from "../../telemetry/AnalyticsService.ts";
import registry from "../workflows/registry.json" with { type: "json" };
import {
  applyChoice,
  applyEvent,
  emptyTelemetryFile,
  parseTelemetryFile,
  reportablePackId,
  rollDay,
  utcDay,
  type TelemetryEvent,
  type TelemetryFile,
  type TelemetryHost,
} from "./telemetryState.ts";

export class ZenTelemetry extends Context.Service<
  ZenTelemetry,
  {
    readonly call: (input: ZenTelemetryCallInput) => Effect.Effect<unknown, ZenTelemetryError>;
    readonly record: (event: TelemetryEvent) => Effect.Effect<void>;
    /** Rolls the day, saves and sends what is due (the background loop runs it every minute). */
    readonly tick: Effect.Effect<void>;
  }
>()("t3/zen/telemetry/ZenTelemetry") {}

const isTelemetryError = Schema.is(ZenTelemetryError);
const fail = (reason: ZenTelemetryError["reason"], detail: string) =>
  new ZenTelemetryError({ reason, detail });

const OFFICIAL_PACK_IDS: ReadonlySet<string> = new Set(
  (registry as { entries: ReadonlyArray<{ id: string; kind?: string }> }).entries
    .filter((entry) => entry.kind === "builtin" || entry.kind === "pack")
    .map((entry) => entry.id),
);

const TICK = "60 seconds";
const SEND_TIMEOUT_MS = 10_000;
const RETRY_AFTER_MS = 15 * 60_000;

function readJson(file: string): unknown {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writePrivate(file: string, text: string) {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, text, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

type Json = Record<string, unknown>;
const asInput = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};

/** Upstream analytics events that become counters; every other event is dropped. */
export function eventFromUpstream(
  event: string,
  properties: Readonly<Record<string, unknown>> | undefined,
): TelemetryEvent | null {
  if (event === "client.thread.started") return { kind: "metric", metric: "chats" };
  if (event === "client.turn.requested") return { kind: "metric", metric: "messages" };
  if (
    event === "feature.used" &&
    properties?.feature === "approval.respond" &&
    typeof properties.variant === "string" &&
    properties.variant.startsWith("accept")
  ) {
    return { kind: "metric", metric: "approvals" };
  }
  if (event === "provider.request.completed" && properties?.terminalStatus === "failed") {
    return { kind: "error", type: "turn.failed" };
  }
  return null;
}

export interface ZenTelemetryOptions {
  readonly stateDir: string;
  readonly endpoint: string;
  readonly blockedByPolicy: boolean;
  readonly host: TelemetryHost;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
}

/** The service without Effect layers (tests build it directly). */
export function makeZenTelemetry(options: ZenTelemetryOptions) {
  const file = NodePath.join(options.stateDir, ZEN_TELEMETRY_FILE);
  const now = options.now ?? (() => new Date());
  const send = options.fetch ?? fetch;
  let state: TelemetryFile = options.blockedByPolicy
    ? emptyTelemetryFile()
    : parseTelemetryFile(readJson(file));
  let dirty = false;
  let sending = false;
  let retryAt = 0;

  const save = () => {
    if (!dirty || options.blockedByPolicy) return;
    writePrivate(file, `${JSON.stringify(state, null, 2)}\n`);
    dirty = false;
  };
  const update = (next: TelemetryFile) => {
    if (next !== state) {
      state = next;
      dirty = true;
    }
  };
  const status = (): ZenTelemetryStatus => ({
    choice: options.blockedByPolicy ? "off" : state.choice,
    blockedByPolicy: options.blockedByPolicy,
    endpoint: options.endpoint,
  });

  const record = (event: TelemetryEvent) => {
    if (options.blockedByPolicy || state.choice !== "on") return;
    update(applyEvent(state, utcDay(now()), options.host, event));
  };

  /** Sends the oldest pending report; a 4xx answer drops it (it would never be accepted). */
  const sendPending = async () => {
    if (sending || state.choice !== "on" || state.pending.length === 0) return;
    if (now().getTime() < retryAt) return;
    sending = true;
    const report = state.pending[0]!;
    const outcome = await send(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }).then(
      (response) =>
        response.ok || (response.status >= 400 && response.status < 500) ? "done" : "retry",
      () => "retry" as const,
    );
    sending = false;
    if (outcome === "retry") {
      retryAt = now().getTime() + RETRY_AFTER_MS;
      return;
    }
    // The person may have said no while the request was out.
    if (state.choice === "on" && state.pending[0] === report) {
      update({ ...state, pending: state.pending.slice(1) });
    }
    retryAt = 0;
  };

  const tick = async () => {
    update(rollDay(state, utcDay(now()), options.host));
    save();
    while (state.pending.length > 0 && now().getTime() >= retryAt) {
      const before = state.pending.length;
      await sendPending();
      save();
      if (state.pending.length === before) break;
    }
  };

  const run = (op: ZenTelemetryCallInput["op"], raw: unknown): ZenTelemetryStatus | null => {
    const input = asInput(raw);
    if (op === "status") return status();
    if (op === "hello") {
      // The app opened: remember its language and edition (both only ever sent as a closed
      // list) and count the day as active.
      if (!options.blockedByPolicy) {
        update({
          ...state,
          locale: zenTelemetryLocale(input.locale ?? state.locale),
          edition: input.edition === undefined ? state.edition : zenTelemetryEdition(input.edition),
        });
        record({ kind: "active" });
      }
      return status();
    }
    if (op === "setChoice") {
      if (input.choice !== "on" && input.choice !== "off")
        throw fail("invalid-input", "choice must be on or off.");
      if (options.blockedByPolicy)
        throw fail("unavailable", "Your organization turned usage statistics off.");
      update(
        applyChoice(
          {
            ...state,
            locale: zenTelemetryLocale(input.locale ?? state.locale),
            edition:
              input.edition === undefined ? state.edition : zenTelemetryEdition(input.edition),
          },
          input.choice,
          { now: now(), newInstallId: () => NodeCrypto.randomUUID() },
        ),
      );
      if (input.choice === "on") record({ kind: "active" });
      save();
      return status();
    }
    // op === "count": what only the app sees (a workflow started, or failed to).
    if (input.kind === "workflow") {
      record({ kind: "metric", metric: "workflows" });
      record({ kind: "pack", packId: reportablePackId(input.packId, OFFICIAL_PACK_IDS) });
      return null;
    }
    if (
      input.kind === "error" &&
      (ZEN_TELEMETRY_ERROR_TYPES as ReadonlyArray<unknown>).includes(input.type)
    ) {
      record({ kind: "error", type: input.type as ZenTelemetryErrorType });
      return null;
    }
    throw fail("invalid-input", "Unknown count.");
  };

  return {
    run,
    record,
    tick,
    status,
    save,
    /** For tests. */
    snapshot: () => state,
  };
}

const TelemetryConfig = Config.all({
  endpoint: Config.String(ZEN_TELEMETRY_URL_ENV).pipe(Config.withDefault(ZEN_TELEMETRY_URL)),
});

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const policy = yield* ManagedPolicy.ManagedPolicy;
  const { endpoint } = yield* TelemetryConfig;
  const telemetry = makeZenTelemetry({
    stateDir: config.stateDir,
    endpoint,
    // A managed policy can switch statistics off, never on (as upstream's telemetry).
    blockedByPolicy: ManagedPolicy.deniedBy(policy, "telemetry") !== undefined,
    host: {
      version: packageJson.version,
      os: zenTelemetryOs(yield* HostProcess.Platform),
      arch: yield* HostProcess.Architecture,
    },
  });

  const tick = Effect.promise(() => telemetry.tick()).pipe(Effect.ignore);
  yield* Effect.forever(Effect.sleep(TICK).pipe(Effect.andThen(tick)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);
  yield* Effect.addFinalizer(() => Effect.sync(() => telemetry.save()).pipe(Effect.ignore));

  const call = (input: ZenTelemetryCallInput) =>
    Effect.try({
      try: () => telemetry.run(input.op, input.input),
      catch: (cause) =>
        isTelemetryError(cause)
          ? cause
          : fail("unavailable", cause instanceof Error ? cause.message : "Statistics failed."),
    });

  return ZenTelemetry.of({
    call,
    record: Effect.fn("ZenTelemetry.record")(function* (event) {
      telemetry.record(event);
    }),
    tick,
  });
});

/** Upstream's AnalyticsService, backed by our counters (never PostHog). */
const analyticsLayer = Layer.effect(
  AnalyticsService,
  Effect.gen(function* () {
    const telemetry = yield* ZenTelemetry;
    return AnalyticsService.of({
      record: Effect.fn("ZenTelemetry.analytics.record")(function* (event, properties) {
        const mapped = eventFromUpstream(event, properties);
        if (mapped !== null) yield* telemetry.record(mapped);
      }),
      flush: telemetry.tick,
      // Upstream reports account owner ids here; we never send them.
      recordOwners: Effect.fn("ZenTelemetry.analytics.recordOwners")(function* () {
        yield* Effect.void;
      }),
    });
  }),
);

/** Provides ZenTelemetry and upstream's AnalyticsService (server.ts). */
export const layer = analyticsLayer.pipe(Layer.provideMerge(Layer.effect(ZenTelemetry, make)));

/** RPC handler for ws.ts; optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenTelemetry["Service"]>) => ({
  [ZEN_TELEMETRY_WS_METHODS.call]: (input: ZenTelemetryCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(fail("unavailable", "Usage statistics are not available on this server.")),
});
