// @effect-diagnostics nodeBuiltinImport:off - the job runner is plain async Node code.
// Zen Staff "Conectează-ți AI-ul" service (`zen.aiConnect.call {op, input}`): installs Claude
// Code or Codex with the official script and runs their browser sign-in as a background job
// (jobs.ts), so the Office edition never shows a terminal. Google (Antigravity) uses upstream's
// managed install and sign-in RPCs from the web. ZEN.md, "Connect your AI".
import * as NodePath from "node:path";

import {
  ZEN_AI_CONNECT_WS_METHODS,
  ZenAiConnectError,
  isAiConnectCliProvider,
  type ZenAiConnectCallInput,
} from "@t3tools/contracts/zenCompanies";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../../config.ts";
import { AiConnectJobs } from "./jobs.ts";

export class ZenAiConnect extends Context.Service<
  ZenAiConnect,
  {
    readonly call: (input: ZenAiConnectCallInput) => Effect.Effect<unknown, ZenAiConnectError>;
  }
>()("t3/zen/aiConnect/ZenAiConnect") {}

const isAiConnectError = Schema.is(ZenAiConnectError);
const fail = (reason: ZenAiConnectError["reason"], detail: string) =>
  new ZenAiConnectError({ reason, detail });

type Json = Record<string, unknown>;
const asInput = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};
const stringOf = (input: Json, key: string): string => {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 1024)
    throw fail("invalid-input", `${key} is not valid.`);
  return value;
};

/** The pure dispatcher (tested without the Effect runtime). */
export function aiConnectDispatch(jobs: AiConnectJobs, op: string, raw: unknown): unknown {
  const input = asInput(raw);
  switch (op) {
    case "status":
      return { jobs: jobs.status() };
    case "start": {
      const provider = input.provider;
      if (!isAiConnectCliProvider(provider)) throw fail("invalid-input", "Unknown AI provider.");
      const mode = input.mode === "signin" ? "signin" : "connect";
      return { job: jobs.start(provider, mode) };
    }
    case "submitCode":
      return { job: jobs.submitCode(stringOf(input, "jobId"), stringOf(input, "code")) };
    case "cancel":
      return { job: jobs.cancel(stringOf(input, "jobId")) };
    default:
      throw fail("invalid-input", "Unknown operation.");
  }
}

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  const jobs = new AiConnectJobs({
    platform,
    env: process.env,
    workDir: NodePath.join(serverConfig.stateDir, "zen-ai-connect"),
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => jobs.dispose()));

  const call = (input: ZenAiConnectCallInput) =>
    Effect.try({
      try: () => aiConnectDispatch(jobs, input.op, input.input),
      catch: (cause) =>
        isAiConnectError(cause)
          ? cause
          : fail("unavailable", cause instanceof Error ? cause.message : "The AI setup failed."),
    });

  return ZenAiConnect.of({ call });
});

export const layer = Layer.effect(ZenAiConnect, make);

/** RPC handler for ws.ts; optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenAiConnect["Service"]>) => ({
  [ZEN_AI_CONNECT_WS_METHODS.call]: (input: ZenAiConnectCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(fail("unavailable", "Connecting an AI is not available on this server.")),
});
