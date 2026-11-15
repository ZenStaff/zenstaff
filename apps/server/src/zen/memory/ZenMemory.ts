// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off processEnvInEffect:off globalDate:off -- The memory client is a promise boundary: the queue timer and the MCP server call back outside any fiber.
// Zen Staff: hosted company memory (zen-memory). Per company: a server URL, an API key in the
// vault and a "save conversations" switch. When a thread in a company project settles (its run
// completed and nothing happened for ZEN_MEMORY_SETTLE_SECONDS), one redacted summary of the new
// part is written by Haiku and queued for POST /v1/episodes. Agents ask through the `zen-memory`
// MCP server (mcpServer.ts), wired into Claude Code sessions by companyMemoryMcp.ts. See ZEN.md.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";

import { ProviderInstanceId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import {
  ZEN_MEMORY_SUMMARY_MODEL,
  ZEN_MEMORY_WS_METHODS,
  ZenMemoryError,
  type ZenMemoryCompanyInput,
  type ZenMemoryConfigureInput,
  type ZenMemoryDecideRuleInput,
  type ZenMemoryFactActionInput,
  type ZenMemoryFactActionResult,
  type ZenMemoryFactsInput,
  type ZenMemoryForgetPersonInput,
  type ZenMemoryForgetPersonResult,
  type ZenMemoryPendingRulesResult,
  type ZenMemoryZonesResult,
  type ZenMemoryEntityInput,
  type ZenMemoryEntityResult,
  type ZenMemoryForgetInput,
  type ZenMemoryForgetResult,
  type ZenMemoryLastSave,
  type ZenMemoryListInput,
  type ZenMemoryListResult,
  type ZenMemorySearchInput,
  type ZenMemorySearchResult,
  type ZenMemorySetThreadSkipInput,
  type ZenMemorySettings,
  type ZenMemoryTestInput,
  type ZenMemoryTestResult,
  type ZenMemoryThreadInput,
  type ZenMemoryThreadState,
} from "@t3tools/contracts/zenMemory";
import { isHubManager, zenHubBridge } from "../hub/hubBridge.ts";
import { setZenMemoryWriter } from "./memoryWriter.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { SecretVault } from "../toolchains/vault.ts";
import {
  projectForCwd,
  setZenMemoryMcpResolver,
  setZenMemoryProjectByCwd,
} from "./companyMemoryMcp.ts";
import { makeHostedKeys } from "./hostedKeys.ts";
import { formatFacts, formatList, startMemoryMcpServer } from "./mcpServer.ts";
import {
  listOf,
  memoryRequest,
  nextCursorOf,
  normalizeMemoryUrl,
  numberField,
  stringField,
  toEntity,
  toFact,
  toGraphCounts,
  toQuotas,
  type EpisodeBody,
  type MemoryCallResult,
  type MemoryConnection,
} from "./memoryClient.ts";
import {
  afterSend,
  dueItems,
  enqueue,
  expiredItems,
  nextWakeAt,
  type QueuedEpisode,
} from "./memoryQueue.ts";
import {
  DEFAULT_COMPANY_CONFIG,
  DEFAULT_THREAD_STATE,
  loadMemoryState,
  minIntervalMs,
  nextSummaryAt,
  readCompaniesFile,
  saveMemoryState,
  settleDelayMs,
  threadsToCatchUp,
  type CompanyMemoryConfig,
  type MemoryState,
  type ThreadMemoryState,
} from "./memoryState.ts";
import {
  buildSummaryPrompt,
  buildTranscript,
  episodeIdempotencyKey,
  finalizeSummary,
  MAX_TRANSCRIPT_CHARS,
  newMessagesSince,
  parseSummaryOutput,
  skipReason,
  type TranscriptMessage,
} from "./summary.ts";

const PERSONAL = "personal";

/** One imported chat's memory summary, as the import page shows it. */
export interface ZenMemoryImportPreview {
  readonly status: "ready" | "nothing" | "skipped" | "off" | "queued" | "failed";
  readonly companyId: string | null;
  readonly summary: string | null;
  readonly redacted: ReadonlyArray<string>;
  readonly detail: string | null;
}
const VAULT_SCOPE = "company-memory";

const isZenMemoryError = Schema.is(ZenMemoryError);
const redactionNote = (item: QueuedEpisode): string | null =>
  item.redacted !== undefined && item.redacted.length > 0
    ? `redacted before sending: ${item.redacted.join(", ")}`
    : null;
const fail = (reason: ZenMemoryError["reason"], detail: string) =>
  new ZenMemoryError({ reason, detail });

function fromCallFailure(
  result: Extract<MemoryCallResult<unknown>, { ok: false }>,
): ZenMemoryError {
  switch (result.kind) {
    case "unauthorized":
      return fail("unauthorized", "The memory server refused the API key.");
    case "forbidden":
      return fail("admin-required", result.detail);
    case "quota":
      return fail("quota", result.detail);
    case "not-found":
      return fail("not-found", "Not found in company memory.");
    case "network":
      return fail("unreachable", result.detail);
    case "server":
      return fail("server", result.detail);
    default:
      return fail("invalid-input", result.detail);
  }
}

export class ZenMemory extends Context.Service<
  ZenMemory,
  {
    readonly settings: (
      input: ZenMemoryCompanyInput,
    ) => Effect.Effect<ZenMemorySettings, ZenMemoryError>;
    readonly configure: (
      input: ZenMemoryConfigureInput,
    ) => Effect.Effect<ZenMemorySettings, ZenMemoryError>;
    readonly test: (
      input: ZenMemoryTestInput,
    ) => Effect.Effect<ZenMemoryTestResult, ZenMemoryError>;
    readonly search: (
      input: ZenMemorySearchInput,
    ) => Effect.Effect<ZenMemorySearchResult, ZenMemoryError>;
    readonly decisions: (
      input: ZenMemoryListInput,
    ) => Effect.Effect<ZenMemoryListResult, ZenMemoryError>;
    readonly promises: (
      input: ZenMemoryListInput,
    ) => Effect.Effect<ZenMemoryListResult, ZenMemoryError>;
    readonly entity: (
      input: ZenMemoryEntityInput,
    ) => Effect.Effect<ZenMemoryEntityResult, ZenMemoryError>;
    readonly forget: (
      input: ZenMemoryForgetInput,
    ) => Effect.Effect<ZenMemoryForgetResult, ZenMemoryError>;
    readonly threadState: (
      input: ZenMemoryThreadInput,
    ) => Effect.Effect<ZenMemoryThreadState, ZenMemoryError>;
    readonly setThreadSkip: (
      input: ZenMemorySetThreadSkipInput,
    ) => Effect.Effect<ZenMemoryThreadState, ZenMemoryError>;
    readonly zones: (
      input: ZenMemoryCompanyInput,
    ) => Effect.Effect<ZenMemoryZonesResult, ZenMemoryError>;
    readonly facts: (
      input: ZenMemoryFactsInput,
    ) => Effect.Effect<ZenMemoryListResult, ZenMemoryError>;
    readonly factAction: (
      input: ZenMemoryFactActionInput,
    ) => Effect.Effect<ZenMemoryFactActionResult, ZenMemoryError>;
    readonly pendingRules: (
      input: ZenMemoryCompanyInput,
    ) => Effect.Effect<ZenMemoryPendingRulesResult, ZenMemoryError>;
    readonly decideRule: (
      input: ZenMemoryDecideRuleInput,
    ) => Effect.Effect<ZenMemoryPendingRulesResult, ZenMemoryError>;
    readonly forgetPerson: (
      input: ZenMemoryForgetPersonInput,
    ) => Effect.Effect<ZenMemoryForgetPersonResult, ZenMemoryError>;
    /** Summarize and queue a thread now (the settle timer calls it; exposed for tests). */
    readonly saveThread: (threadId: string) => Effect.Effect<ZenMemoryLastSave | null>;
    /** Imported chats: the summary that would be sent, kept until `sendImported` confirms it. */
    readonly previewImported: (
      threadId: string,
    ) => Effect.Effect<ZenMemoryImportPreview, ZenMemoryError>;
    readonly sendImported: (
      threadId: string,
    ) => Effect.Effect<ZenMemoryImportPreview, ZenMemoryError>;
  }
>()("t3/zen/memory/ZenMemory") {}

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const zenDir = NodePath.join(serverConfig.stateDir, "zen");
  const stateFile = NodePath.join(zenDir, "memory.json");
  const companiesFile = NodePath.join(zenDir, "companies.json");
  const hubFile = NodePath.join(zenDir, "hub.json");
  const vault = new SecretVault(
    NodePath.join(zenDir, "memory-vault"),
    platform,
    process.env.ZEN_MEMORY_KEYCHAIN !== "0",
  );
  const settleMs = settleDelayMs();
  const intervalMs = minIntervalMs();

  let state: MemoryState = loadMemoryState(stateFile);
  const update = (change: (current: MemoryState) => MemoryState) => {
    state = change(state);
    saveMemoryState(stateFile, state);
  };
  // A company linked to a hub company takes its address and save switch from the hub (set by its
  // owners/admins); the key is still this machine's own.
  const companyConfig = (companyId: string): CompanyMemoryConfig => {
    const local = state.companies[companyId] ?? DEFAULT_COMPANY_CONFIG;
    const fromHub = zenHubBridge()?.memorySettings(companyId) ?? null;
    return fromHub === null
      ? local
      : { ...local, url: fromHub.url, saveConversations: fromHub.saveConversations };
  };
  const threadMemory = (threadId: string): ThreadMemoryState =>
    state.threads[threadId] ?? DEFAULT_THREAD_STATE;
  const setCompany = (companyId: string, next: Partial<CompanyMemoryConfig>) =>
    update((current) => ({
      ...current,
      companies: { ...current.companies, [companyId]: { ...companyConfig(companyId), ...next } },
    }));
  const setThread = (threadId: string, next: Partial<ThreadMemoryState>) =>
    update((current) => ({
      ...current,
      threads: { ...current.threads, [threadId]: { ...threadMemory(threadId), ...next } },
    }));

  const apiKeyOf = (companyId: string) => vault.get(VAULT_SCOPE, companyId);

  // The person's own memory ("Memoria mea", zen-memory v4, hub v17): companyId "personal", its URL
  // from the hub (or set by hand for a self-hosted memory), this device's key in the same vault.
  const personalStatus = () => zenHubBridge()?.personalMemory?.() ?? null;
  const personalUrl = (): string | null => {
    const fromHub = personalStatus();
    if (fromHub !== null && fromHub.active && fromHub.url !== null)
      return normalizeMemoryUrl(fromHub.url);
    return state.companies[PERSONAL]?.url ?? null;
  };
  let personalIssuing: Promise<void> | null = null;
  let personalError: string | null = null;
  const ensurePersonalKey = (): Promise<void> => {
    const status = personalStatus();
    const issue = zenHubBridge()?.issuePersonalMemoryKey;
    if (
      status === null ||
      !status.active ||
      issue === undefined ||
      vault.has(VAULT_SCOPE, PERSONAL)
    ) {
      return Promise.resolve();
    }
    personalIssuing ??= issue()
      .then((issued) => {
        vault.set(VAULT_SCOPE, PERSONAL, issued.apiKey);
        personalError = null;
        if (companyConfig(PERSONAL).connectedAt === undefined)
          setCompany(PERSONAL, { connectedAt: nowIso() });
        scheduleFlush(0);
      })
      .catch((error: unknown) => {
        personalError =
          error instanceof Error ? error.message : "The hub did not give this device a key.";
      })
      .finally(() => {
        personalIssuing = null;
      });
    return personalIssuing;
  };
  const renewPersonalKey = async (): Promise<boolean> => {
    if (personalStatus()?.active !== true) return false;
    vault.remove(VAULT_SCOPE, PERSONAL);
    await ensurePersonalKey();
    return vault.has(VAULT_SCOPE, PERSONAL);
  };
  /** X-Zen-Personal-Key for a company call, when this person's own memory is connected. */
  const personalHeader = (): Record<string, string> => {
    const key = personalUrl() === null ? null : apiKeyOf(PERSONAL);
    return key === null ? {} : { "X-Zen-Personal-Key": key };
  };
  // The zones each company key may read (GET /v1/me, refreshed with the hosted keys).
  const zonesSeen = new Map<string, ReadonlyArray<string>>();
  const refreshZones = async (companyId: string) => {
    const connection = connectionFor(companyId);
    if (connection === null || companyId === PERSONAL) return;
    const me = await memoryRequest(connection, "GET", "/v1/me", { timeoutMs: 10_000 });
    if (me.ok && Array.isArray((me.value as { zones?: unknown }).zones)) {
      zonesSeen.set(
        companyId,
        ((me.value as { zones: Array<{ ref?: unknown }> }).zones ?? [])
          .map((zone) => zone.ref)
          .filter((ref): ref is string => typeof ref === "string"),
      );
    }
  };
  /** A chat in a project that is a memory zone on the hub writes there; else to the whole company. */
  const zoneForProject = (companyId: string, projectId: string): string | undefined => {
    const seen = zonesSeen.get(companyId);
    if (seen === undefined) return undefined;
    return seen.includes(`project:${projectId}`) ? `project:${projectId}` : "company";
  };

  // Hosted memory (hub v13, hostedKeys.ts): this machine's own key comes from the hub.
  const hostedOf = (companyId: string) =>
    companyId === PERSONAL ? null : (zenHubBridge()?.hostedMemory?.(companyId) ?? null);
  const hostedKeys = makeHostedKeys({
    hosted: hostedOf,
    url: (companyId) => companyConfig(companyId).url,
    hasKey: (companyId) => vault.has(VAULT_SCOPE, companyId),
    setKey: (companyId, key) => vault.set(VAULT_SCOPE, companyId, key),
    removeKey: (companyId) => vault.remove(VAULT_SCOPE, companyId),
    get issue() {
      return zenHubBridge()?.issueMemoryKey;
    },
    onKey: (companyId) => {
      if (companyConfig(companyId).connectedAt === undefined) {
        setCompany(companyId, { connectedAt: nowIso() });
      }
      scheduleFlush(0);
    },
  });
  const isHosted = hostedKeys.isHosted;
  const ensureHostedKey = hostedKeys.ensure;
  const renewHostedKey = hostedKeys.renew;
  const connectionFor = (companyId: string): MemoryConnection | null => {
    if (companyId === PERSONAL) {
      const url = personalUrl();
      const apiKey = url === null ? null : apiKeyOf(PERSONAL);
      return url === null || apiKey === null ? null : { url, apiKey };
    }
    const url = companyConfig(companyId).url;
    const apiKey = url === null ? null : apiKeyOf(companyId);
    return url === null || apiKey === null ? null : { url, apiKey };
  };
  const requireConnection = (companyId: string): MemoryConnection => {
    const connection = connectionFor(companyId);
    if (companyId === PERSONAL && connection === null) {
      throw fail(
        "personal",
        "Your own memory is not on yet. Turn it on in Settings > Memoria mea.",
      );
    }
    if (connection === null) {
      throw fail(
        "not-configured",
        "Company memory is not connected. Add its address and API key in Settings.",
      );
    }
    return connection;
  };
  const companyOfProject = (projectId: string): string =>
    readCompaniesFile(companiesFile).projects[projectId] ?? PERSONAL;
  const companyName = (companyId: string): string =>
    companyId === PERSONAL
      ? `the personal memory of ${userName()}`
      : (readCompaniesFile(companiesFile).names[companyId] ?? companyId);
  const companyExists = (companyId: string) =>
    companyId !== PERSONAL && readCompaniesFile(companiesFile).names[companyId] !== undefined;
  const savingFor = (companyId: string) =>
    connectionFor(companyId) !== null && companyConfig(companyId).saveConversations;

  const nowIso = () => new Date().toISOString();
  const userName = (): string => {
    try {
      const raw = JSON.parse(NodeFS.readFileSync(hubFile, "utf8")) as {
        session?: { user?: { email?: unknown } } | null;
      };
      const email = raw.session?.user?.email;
      if (typeof email === "string" && email !== "") return email;
    } catch {
      // No hub account: the machine's user name.
    }
    try {
      return NodeOS.userInfo().username;
    } catch {
      return "unknown";
    }
  };

  const settingsOf = (companyId: string): ZenMemorySettings => {
    const config = companyConfig(companyId);
    const hasKey = vault.has(VAULT_SCOPE, companyId);
    const personal = companyId === PERSONAL ? personalStatus() : null;
    const pending = state.queue.filter((item) => item.companyId === companyId);
    const hold = state.holds[companyId] ?? 0;
    const wake = nextWakeAt(pending, state.holds);
    return {
      companyId,
      available: companyId !== PERSONAL || personal?.available === true || config.url !== null,
      url: companyId === PERSONAL ? personalUrl() : config.url,
      hasKey,
      keyStore: hasKey ? vault.keyStore : null,
      connected: (companyId === PERSONAL ? personalUrl() : config.url) !== null && hasKey,
      saveConversations: config.saveConversations,
      managedBy: zenHubBridge()?.memorySettings(companyId) == null ? null : "hub",
      hubRole: zenHubBridge()?.roleForLocalCompany(companyId) ?? null,
      hosted:
        companyId === PERSONAL
          ? personal === null
            ? null
            : {
                available: personal.available,
                activated: personal.active,
                active: personal.active,
                url: personal.url,
              }
          : hostedOf(companyId),
      hostedError:
        companyId === PERSONAL
          ? personal?.active === true && !hasKey
            ? personalError
            : null
          : isHosted(companyId) && !hasKey
            ? hostedKeys.errorOf(companyId)
            : null,
      pendingCount: pending.length,
      nextRetryAt:
        wake !== null && wake > Date.now() ? new Date(Math.max(wake, hold)).toISOString() : null,
      lastSave: config.lastSave,
    };
  };

  const configurePersonal = async (input: ZenMemoryConfigureInput): Promise<ZenMemorySettings> => {
    if (input.activateHosted === true) {
      const activate = zenHubBridge()?.activatePersonalMemory;
      if (activate === undefined) {
        throw fail(
          "invalid-input",
          "Your own memory needs a hub account (Echipă > intră în cont).",
        );
      }
      await activate().catch((error: unknown) => {
        throw fail(
          "unavailable",
          error instanceof Error ? error.message : "The hub could not turn on your memory.",
        );
      });
      await ensurePersonalKey();
    }
    if (input.url !== undefined) {
      const url = input.url.trim() === "" ? null : normalizeMemoryUrl(input.url);
      if (input.url.trim() !== "" && url === null) {
        throw fail("invalid-input", "Use an http:// or https:// address without a password in it.");
      }
      setCompany(PERSONAL, { url });
    }
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      if (key === "") vault.remove(VAULT_SCOPE, PERSONAL);
      else vault.set(VAULT_SCOPE, PERSONAL, key);
    }
    if (input.saveConversations !== undefined)
      setCompany(PERSONAL, { saveConversations: input.saveConversations });
    if (connectionFor(PERSONAL) !== null && companyConfig(PERSONAL).connectedAt === undefined) {
      setCompany(PERSONAL, { connectedAt: nowIso() });
    }
    scheduleFlush(0);
    return settingsOf(PERSONAL);
  };

  const configure = async (input: ZenMemoryConfigureInput): Promise<ZenMemorySettings> => {
    if (input.companyId === PERSONAL) return configurePersonal(input);
    if (!companyExists(input.companyId)) throw fail("not-found", "This company no longer exists.");
    const bridge = zenHubBridge();
    if (input.activateHosted === true) {
      const activate = bridge?.activateHostedMemory;
      if (activate === undefined || hostedOf(input.companyId) === null) {
        throw fail(
          "invalid-input",
          "Hosted memory needs this company to be linked to a hub company.",
        );
      }
      if (!isHubManager(bridge?.roleForLocalCompany(input.companyId))) {
        throw fail(
          "admin-required",
          "Only the company's owners and admins turn on company memory.",
        );
      }
      await activate(input.companyId, input.saveConversations ?? true).catch((error: unknown) => {
        throw fail(
          "unavailable",
          error instanceof Error ? error.message : "The hub could not turn on company memory.",
        );
      });
      await ensureHostedKey(input.companyId);
      return settingsOf(input.companyId);
    }
    if (
      bridge?.memorySettings(input.companyId) != null &&
      (input.url !== undefined || input.saveConversations !== undefined)
    ) {
      // Hub-managed: only the company's owners/admins change the address or the switch, on the hub.
      if (!isHubManager(bridge.roleForLocalCompany(input.companyId))) {
        throw fail("admin-required", "Your company's admins set the memory address on the hub.");
      }
      const current = companyConfig(input.companyId);
      const url =
        input.url === undefined
          ? current.url
          : input.url.trim() === ""
            ? null
            : normalizeMemoryUrl(input.url);
      if (input.url !== undefined && input.url.trim() !== "" && url === null) {
        throw fail("invalid-input", "Use an http:// or https:// address without a password in it.");
      }
      await bridge
        .setMemorySettings(input.companyId, {
          url,
          saveConversations: input.saveConversations ?? current.saveConversations,
        })
        .catch((error: unknown) => {
          throw fail(
            "invalid-input",
            error instanceof Error ? error.message : "The hub refused the change.",
          );
        });
    }
    if (input.url !== undefined) {
      if (input.url.trim() === "") {
        setCompany(input.companyId, { url: null });
      } else {
        const url = normalizeMemoryUrl(input.url);
        if (url === null) {
          throw fail(
            "invalid-input",
            "Use an http:// or https:// address without a password in it.",
          );
        }
        setCompany(input.companyId, { url });
      }
    }
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      if (key === "") vault.remove(VAULT_SCOPE, input.companyId);
      else vault.set(VAULT_SCOPE, input.companyId, key);
    }
    if (input.saveConversations !== undefined) {
      setCompany(input.companyId, { saveConversations: input.saveConversations });
    }
    if (
      connectionFor(input.companyId) !== null &&
      companyConfig(input.companyId).connectedAt === undefined
    ) {
      setCompany(input.companyId, { connectedAt: nowIso() });
    }
    scheduleFlush(0);
    return settingsOf(input.companyId);
  };

  const test = async (input: ZenMemoryTestInput): Promise<ZenMemoryTestResult> => {
    const url =
      input.url !== undefined && input.url.trim() !== ""
        ? normalizeMemoryUrl(input.url)
        : input.companyId === PERSONAL
          ? personalUrl()
          : companyConfig(input.companyId).url;
    const apiKey =
      input.apiKey !== undefined && input.apiKey.trim() !== ""
        ? input.apiKey.trim()
        : apiKeyOf(input.companyId);
    const empty = { ok: false, companyName: null, graph: {}, quotas: [] };
    if (url === null) return { ...empty, error: "Add the memory server address first." };
    if (apiKey === null) return { ...empty, error: "Add the company's API key first." };
    const result = await memoryRequest({ url, apiKey }, "GET", "/v1/me", { timeoutMs: 10_000 });
    if (!result.ok) return { ...empty, error: fromCallFailure(result).detail };
    const body = result.value as { graph?: unknown; quotas?: unknown };
    return {
      ok: true,
      companyName: stringField(result.value, "name"),
      graph: toGraphCounts(body.graph),
      quotas: toQuotas(body.quotas),
      error: null,
    };
  };

  const renewKey = (companyId: string) =>
    companyId === PERSONAL ? renewPersonalKey() : renewHostedKey(companyId);
  const call = async (
    companyId: string,
    method: "GET" | "POST" | "DELETE" | "PATCH",
    path: string,
    options?: Parameters<typeof memoryRequest>[3] & { readonly withPersonal?: boolean },
  ) => {
    const send = (personal: boolean) =>
      memoryRequest(requireConnection(companyId), method, path, {
        ...options,
        headers: {
          ...options?.headers,
          ...(personal && companyId !== PERSONAL ? personalHeader() : {}),
        },
      });
    const wantPersonal = options?.withPersonal === true && Object.keys(personalHeader()).length > 0;
    let result = await send(wantPersonal);
    if (!result.ok && result.kind === "unauthorized" && (await renewKey(companyId))) {
      result = await send(wantPersonal);
    }
    // A company key made before the hub bound keys to people cannot be paired with the personal key:
    // the company part still works on its own.
    if (!result.ok && result.kind === "forbidden" && wantPersonal) result = await send(false);
    if (!result.ok) throw fromCallFailure(result);
    return result.value;
  };

  const search = async (input: ZenMemorySearchInput): Promise<ZenMemorySearchResult> => {
    const body = await call(input.companyId, "GET", "/v1/search", {
      query: { q: input.q, limit: input.limit ?? 10, include_superseded: true, zones: input.zone },
      withPersonal: input.includePersonal !== false && input.zone === undefined,
    });
    return {
      facts: listOf(body, "facts").map(toFact),
      entities: listOf(body, "entities").map(toEntity),
    };
  };
  const decisions = async (input: ZenMemoryListInput): Promise<ZenMemoryListResult> => {
    const body = await call(input.companyId, "GET", "/v1/decisions", {
      query: {
        limit: 50,
        include_superseded: input.includeSuperseded ?? false,
        cursor: input.cursor,
      },
    });
    return { items: listOf(body, "decisions").map(toFact), nextCursor: nextCursorOf(body) };
  };
  const promises = async (input: ZenMemoryListInput): Promise<ZenMemoryListResult> => {
    const body = await call(input.companyId, "GET", "/v1/promises", {
      query: { limit: 50, status: input.status ?? "all", cursor: input.cursor },
    });
    return { items: listOf(body, "promises").map(toFact), nextCursor: nextCursorOf(body) };
  };
  const entity = async (input: ZenMemoryEntityInput): Promise<ZenMemoryEntityResult> => {
    const body = await call(
      input.companyId,
      "GET",
      `/v1/entities/${encodeURIComponent(input.entityId)}`,
    );
    return {
      entity: toEntity(body),
      timeline: listOf(body, "timeline").map(toFact),
    };
  };
  const forget = async (input: ZenMemoryForgetInput): Promise<ZenMemoryForgetResult> => {
    // Without a hub, the admin is whoever holds the company's key on this machine and confirms.
    // A company linked to a hub company also needs the hub's owner or admin role.
    if (input.adminConfirmed !== true)
      throw fail("admin-required", "A company admin must confirm this.");
    const hubRole = zenHubBridge()?.roleForLocalCompany(input.companyId);
    if (hubRole !== undefined && !isHubManager(hubRole)) {
      throw fail(
        "admin-required",
        "Only the company's owners and admins on the hub can erase memory.",
      );
    }
    const body = await call(
      input.companyId,
      "DELETE",
      `/v1/entities/${encodeURIComponent(input.entityId)}`,
    );
    return {
      factsDeleted: numberField(body, "facts_deleted"),
      factsRewritten: numberField(body, "facts_rewritten"),
      summariesRewritten: numberField(body, "summaries_rewritten"),
      episodesRedacted: numberField(body, "episodes_redacted"),
    };
  };

  const zones = async (input: ZenMemoryCompanyInput): Promise<ZenMemoryZonesResult> => {
    const body = (await call(input.companyId, "GET", "/v1/zones")) as {
      zones?: Array<Record<string, unknown>>;
      admin?: unknown;
      rules?: { auto_promote_decisions?: unknown; sensitive_policy?: unknown } | null;
    };
    const kinds = ["company", "team", "project", "personal"] as const;
    return {
      zones: (body.zones ?? []).flatMap((zone) => {
        const kind = kinds.find((candidate) => candidate === zone.kind);
        if (kind === undefined || typeof zone.ref !== "string") return [];
        const counts = (zone.counts ?? {}) as { facts?: unknown };
        return [
          {
            ref: zone.ref,
            kind,
            name: typeof zone.name === "string" ? zone.name : zone.ref,
            archived: zone.archived === true,
            parentRef: typeof zone.parent_ref === "string" ? zone.parent_ref : null,
            facts: typeof counts.facts === "number" ? counts.facts : 0,
            ...(Array.isArray(zone.readers)
              ? {
                  readers: zone.readers.filter(
                    (reader): reader is string => typeof reader === "string",
                  ),
                }
              : {}),
          },
        ];
      }),
      admin: body.admin === true,
      rules:
        body.rules == null
          ? null
          : {
              autoPromoteDecisions: body.rules.auto_promote_decisions === true,
              sensitivePolicy: body.rules.sensitive_policy === "drop" ? "drop" : "personal",
            },
    };
  };

  const facts = async (input: ZenMemoryFactsInput): Promise<ZenMemoryListResult> => {
    const body = await call(input.companyId, "GET", "/v1/facts", {
      query: { limit: 50, include_superseded: true, cursor: input.cursor, zone: input.zone },
    });
    return { items: listOf(body, "facts").map(toFact), nextCursor: nextCursorOf(body) };
  };

  const factAction = async (
    input: ZenMemoryFactActionInput,
  ): Promise<ZenMemoryFactActionResult> => {
    const path = `/v1/facts/${encodeURIComponent(input.factId)}`;
    const query = { zone: input.zone };
    switch (input.action) {
      case "correct": {
        if (input.text === undefined) throw fail("invalid-input", "Write the corrected text.");
        const body = await call(input.companyId, "PATCH", path, {
          query,
          body: { fact: input.text },
        });
        return { ok: true, fact: toFact(body), detail: null };
      }
      case "wrong":
        await call(input.companyId, "POST", `${path}/wrong`, { query });
        return { ok: true, fact: null, detail: null };
      case "delete": {
        if (input.companyId !== PERSONAL) {
          const hubRole = zenHubBridge()?.roleForLocalCompany(input.companyId);
          if (hubRole !== undefined && !isHubManager(hubRole)) {
            throw fail(
              "admin-required",
              "Only the company's owners and admins delete company facts. Mark it wrong instead.",
            );
          }
        }
        await call(input.companyId, "DELETE", path, { query });
        return { ok: true, fact: null, detail: null };
      }
      case "promote": {
        if (input.companyId !== PERSONAL)
          throw fail("invalid-input", "Only items of your own memory are sent to a company.");
        if (input.consent !== true)
          throw fail("invalid-input", "Confirm that you send this item to the company.");
        const target = input.targetCompanyId;
        const company = target === undefined ? null : connectionFor(target);
        if (target === undefined || company === null) {
          throw fail("not-configured", "That company's memory is not connected on this computer.");
        }
        const body = await call(PERSONAL, "POST", `${path}/promote`, {
          body: {
            consent: true,
            ...(input.targetZone === undefined ? {} : { zone: input.targetZone }),
            user: userName(),
          },
          headers: { "X-Zen-Company-Key": company.apiKey },
        });
        return { ok: true, fact: null, detail: stringField(body, "consent_id") };
      }
    }
  };

  const pendingRules = async (
    input: ZenMemoryCompanyInput,
  ): Promise<ZenMemoryPendingRulesResult> => {
    const body = await call(input.companyId, "GET", "/v1/rules/pending");
    return {
      rules: listOf(body, "rules").flatMap((raw) => {
        const rule = raw as Record<string, unknown>;
        if (typeof rule.id !== "string" || typeof rule.text !== "string") return [];
        return [
          {
            id: rule.id,
            zone: typeof rule.zone === "string" ? rule.zone : "company",
            text: rule.text,
            threadId: typeof rule.thread_id === "string" ? rule.thread_id : null,
            title: typeof rule.title === "string" ? rule.title : null,
            createdAt: typeof rule.created_at === "string" ? rule.created_at : null,
          },
        ];
      }),
    };
  };

  const decideRule = async (
    input: ZenMemoryDecideRuleInput,
  ): Promise<ZenMemoryPendingRulesResult> => {
    await call(
      input.companyId,
      "POST",
      `/v1/rules/${encodeURIComponent(input.ruleId)}/${input.decision}`,
    );
    return pendingRules({ companyId: input.companyId });
  };

  const forgetPerson = async (
    input: ZenMemoryForgetPersonInput,
  ): Promise<ZenMemoryForgetPersonResult> => {
    const hubRole = zenHubBridge()?.roleForLocalCompany(input.companyId);
    if (hubRole !== undefined && !isHubManager(hubRole)) {
      throw fail(
        "admin-required",
        "Only the company's owners and admins erase a person from memory.",
      );
    }
    const body = (await call(input.companyId, "POST", "/v1/forget-person", {
      body: { name: input.name },
    })) as {
      entities?: Array<{ zone?: unknown; facts_deleted?: unknown }>;
    };
    const entities = body.entities ?? [];
    return {
      zones: [...new Set(entities.map((entity) => String(entity.zone ?? "company")))],
      factsDeleted: entities.reduce(
        (sum, entity) =>
          sum + (typeof entity.facts_deleted === "number" ? entity.facts_deleted : 0),
        0,
      ),
    };
  };

  const threadShell = (threadId: string) =>
    runPromise(
      orchestrator.getThreadShell(ThreadId.make(threadId)).pipe(Effect.orElseSucceed(() => null)),
    );

  const threadStateOf = async (threadId: string): Promise<ZenMemoryThreadState> => {
    const shell = await threadShell(threadId);
    const companyId = shell === null ? PERSONAL : companyOfProject(shell.projectId);
    const memory = threadMemory(threadId);
    return {
      threadId,
      // "personal" when the person's own memory is on (Personal projects save there)
      companyId: connectionFor(companyId) === null ? null : companyId,
      saving: savingFor(companyId) && !memory.skip,
      skip: memory.skip,
      lastSave: memory.lastSave,
    };
  };

  const summarize = (prompt: string) =>
    runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Providers run in a working directory; the summary must not read a checkout.
          const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-memory-" });
          const generated = yield* textGeneration.generateTranscriptionPostProcessing({
            cwd,
            prompt,
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: ZEN_MEMORY_SUMMARY_MODEL,
            } as ModelSelection,
          });
          return generated.transcription;
        }),
      ),
    );

  const recordSave = (threadId: string, companyId: string | null, save: ZenMemoryLastSave) => {
    setThread(threadId, { lastSave: save });
    if (companyId !== null) setCompany(companyId, { lastSave: save });
  };

  type PreparedEpisode =
    | { readonly kind: "none"; readonly detail: string }
    | { readonly kind: "off"; readonly companyId: string | null }
    /** The thread had a summary recently: summarize what is new at `until` (epoch ms). */
    | { readonly kind: "wait"; readonly until: number }
    | {
        readonly kind: "skipped" | "nothing";
        readonly companyId: string;
        readonly lastMessageId: string;
        readonly detail: string;
      }
    | { readonly kind: "item"; readonly companyId: string; readonly item: QueuedEpisode };

  /** The episode a thread's new messages would make, without saving anything. */
  const prepareEpisode = async (
    threadId: string,
    options: { readonly respectInterval?: boolean } = {},
  ): Promise<PreparedEpisode> => {
    const records = await runPromise(
      orchestrator.getThreadRecords(ThreadId.make(threadId), ["messages", "runs"]).pipe(
        Effect.asSome,
        Effect.orElseSucceed(() => Option.none()),
      ),
    );
    if (Option.isNone(records)) return { kind: "none", detail: "chat not found" };
    const { thread, messages, runs } = records.value;
    if (thread.deletedAt !== null) return { kind: "none", detail: "chat deleted" };
    if (runs.some(ThreadManagementService.isActiveRun)) {
      return { kind: "none", detail: "chat still running" };
    }
    // A subagent's or side chat's work is summarized with its parent conversation.
    if (thread.lineage.relationshipToParent === "subagent" || thread.lineage.sideChat === true) {
      return { kind: "none", detail: "part of another chat" };
    }
    const companyId = companyOfProject(thread.projectId);
    if (!savingFor(companyId)) {
      return { kind: "off", companyId: companyId === PERSONAL ? null : companyId };
    }
    const memory = threadMemory(threadId);
    if (memory.skip) return { kind: "off", companyId };
    const transcriptMessages: ReadonlyArray<TranscriptMessage> = messages
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          !message.streaming &&
          message.idleCompaction === undefined &&
          message.text.trim() !== "",
      )
      .toSorted(
        (left, right) =>
          DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
      )
      .map((message) => ({
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        text: message.text,
        createdAt: DateTime.formatIso(message.createdAt),
      }));
    const fresh = newMessagesSince(transcriptMessages, memory.lastMessageId);
    const last = fresh.at(-1);
    if (last === undefined) return { kind: "none", detail: "nothing new" };
    const skip = skipReason(fresh);
    if (skip !== null) {
      return { kind: "skipped", companyId, lastMessageId: last.id, detail: skip };
    }
    const project = await runPromise(
      projects.getShell(thread.projectId).pipe(
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      ),
    );
    const projectTitle = project?.title ?? null;
    const transcript = buildTranscript(fresh);
    if (options.respectInterval === true) {
      // One summary per thread per interval: the next one covers everything said since, so the
      // memory server runs one extraction instead of one per pause (see memoryState.settleDelayMs).
      const until = nextSummaryAt(
        memory,
        transcript.text.length,
        Date.now(),
        intervalMs,
        Math.floor(MAX_TRANSCRIPT_CHARS * 0.6),
      );
      if (until !== null) return { kind: "wait", until };
    }
    const output = await summarize(
      buildSummaryPrompt(transcript.text, {
        title: thread.title,
        project: projectTitle,
        company: companyName(companyId),
        finishedAt: last.createdAt,
        continuation: memory.lastMessageId !== null,
      }),
    );
    const summary = parseSummaryOutput(output);
    if (summary === null) {
      return { kind: "nothing", companyId, lastMessageId: last.id, detail: "no business content" };
    }
    const finalized = finalizeSummary(summary);
    const body: EpisodeBody = {
      summary: finalized.text,
      source: {
        thread_id: threadId,
        timestamp: last.createdAt,
        user: userName(),
        machine: NodeOS.hostname(),
        ...(projectTitle === null ? {} : { project: projectTitle }),
        title: thread.title,
        app: "zen-staff",
      },
      idempotency_key: episodeIdempotencyKey(threadId, last.id),
    };
    const zone = companyId === PERSONAL ? undefined : zoneForProject(companyId, thread.projectId);
    const now = Date.now();
    return {
      kind: "item",
      companyId,
      item: {
        id: `${threadId}:${last.id}`,
        companyId,
        threadId,
        lastMessageId: last.id,
        body: zone === undefined ? body : { ...body, zone },
        withPersonal: companyId !== PERSONAL,
        attempts: 0,
        enqueuedAt: now,
        notBefore: now,
        redacted: [...new Set([...transcript.redacted, ...finalized.redacted])],
      },
    };
  };

  const commitEpisode = async (item: QueuedEpisode): Promise<ZenMemoryLastSave | null> => {
    update((current) => ({ ...current, queue: enqueue(current.queue, item) }));
    setThread(item.threadId, { lastEpisodeAt: nowIso() });
    const save = { at: nowIso(), status: "queued", detail: redactionNote(item) };
    recordSave(item.threadId, item.companyId, save);
    await flush();
    return threadMemory(item.threadId).lastSave;
  };

  const saving = new Set<string>();
  /** Summarize and queue now; with `respectInterval` (the settle timer), returns the wait instead when it is too soon. */
  const saveThreadWhenDue = async (
    threadId: string,
    respectInterval: boolean,
  ): Promise<{ readonly save: ZenMemoryLastSave | null; readonly waitUntil: number | null }> => {
    if (saving.has(threadId)) return { save: null, waitUntil: null };
    saving.add(threadId);
    try {
      const prepared = await prepareEpisode(threadId, { respectInterval });
      if (prepared.kind === "wait") return { save: null, waitUntil: prepared.until };
      if (prepared.kind === "none" || prepared.kind === "off") return { save: null, waitUntil: null };
      if (prepared.kind !== "item") {
        const save = {
          at: nowIso(),
          status: "nothing",
          detail: prepared.detail,
        };
        setThread(threadId, { lastMessageId: prepared.lastMessageId, lastSave: save });
        return { save, waitUntil: null };
      }
      return { save: await commitEpisode(prepared.item), waitUntil: null };
    } finally {
      saving.delete(threadId);
    }
  };
  const saveThread = async (threadId: string): Promise<ZenMemoryLastSave | null> =>
    (await saveThreadWhenDue(threadId, false)).save;

  // Imported chats (zen/imports) have no runs, so the settle timer never sees them: their summary
  // is made on request, shown to the person, and queued only after they confirm.
  const previewed = new Map<string, QueuedEpisode>();
  const previewImported = async (threadId: string): Promise<ZenMemoryImportPreview> => {
    const prepared = await prepareEpisode(threadId);
    switch (prepared.kind) {
      case "item":
        previewed.set(threadId, prepared.item);
        return {
          status: "ready",
          companyId: prepared.companyId,
          summary: prepared.item.body.summary,
          redacted: prepared.item.redacted ?? [],
          detail: null,
        };
      case "off":
        return {
          status: "off",
          companyId: prepared.companyId,
          summary: null,
          redacted: [],
          detail: null,
        };
      case "none":
        return {
          status: "skipped",
          companyId: null,
          summary: null,
          redacted: [],
          detail: prepared.detail,
        };
      case "wait": // only the settle timer asks for the interval; a preview never waits
        return {
          status: "skipped",
          companyId: null,
          summary: null,
          redacted: [],
          detail: "summarized recently",
        };
      default:
        return {
          status: prepared.kind,
          companyId: prepared.companyId,
          summary: null,
          redacted: [],
          detail: prepared.detail,
        };
    }
  };
  const sendImported = async (threadId: string): Promise<ZenMemoryImportPreview> => {
    const item = previewed.get(threadId);
    if (item === undefined) {
      return {
        status: "failed",
        companyId: null,
        summary: null,
        redacted: [],
        detail: "preview first",
      };
    }
    // The switch may have been turned off between the preview and the confirmation.
    if (!savingFor(item.companyId) || threadMemory(threadId).skip) {
      previewed.delete(threadId);
      return {
        status: "off",
        companyId: item.companyId,
        summary: null,
        redacted: [],
        detail: null,
      };
    }
    previewed.delete(threadId);
    const save = await commitEpisode(item);
    return {
      status: "queued",
      companyId: item.companyId,
      summary: item.body.summary,
      redacted: item.redacted ?? [],
      detail: save?.status ?? null,
    };
  };

  let flushing = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlush = (delayMs: number) => {
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(
      () => {
        wakeTimer = null;
        void flush();
      },
      Math.min(Math.max(delayMs, 0), 60 * 60_000),
    );
    wakeTimer.unref?.();
  };

  const flush = async (): Promise<void> => {
    if (flushing) return;
    flushing = true;
    try {
      const now = Date.now();
      for (const expired of expiredItems(state.queue, now)) {
        update((current) => ({
          ...current,
          queue: current.queue.filter((item) => item.id !== expired.id),
        }));
        recordSave(expired.threadId, expired.companyId, {
          at: nowIso(),
          status: "failed",
          detail: "not sent within 7 days",
        });
      }
      for (const item of dueItems(state.queue, now, state.holds)) {
        if ((state.holds[item.companyId] ?? 0) > Date.now()) continue;
        const connection = connectionFor(item.companyId);
        if (connection === null) continue; // Kept until the company is connected again.
        const extra = item.withPersonal === true ? personalHeader() : {};
        let outcome = await memoryRequest(connection, "POST", "/v1/episodes", {
          body: item.body,
          headers: extra,
        });
        if (!outcome.ok && outcome.kind === "forbidden" && Object.keys(extra).length > 0) {
          // The company key is not paired with this person (made before v4): send the company part only.
          outcome = await memoryRequest(connection, "POST", "/v1/episodes", { body: item.body });
        }
        if (
          !outcome.ok &&
          outcome.kind === "unauthorized" &&
          (isHosted(item.companyId) || item.companyId === PERSONAL)
        ) {
          // Hosted key revoked or replaced: keep the summary and send it with the new key.
          void renewKey(item.companyId);
          continue;
        }
        const decision = afterSend(item, outcome, Date.now());
        if (decision.action === "retry") {
          update((current) => ({
            ...current,
            queue: current.queue.map((queued) => (queued.id === item.id ? decision.item : queued)),
            holds:
              decision.holdCompanyUntil === null
                ? current.holds
                : { ...current.holds, [item.companyId]: decision.holdCompanyUntil },
          }));
          recordSave(item.threadId, item.companyId, {
            at: nowIso(),
            status: "queued",
            detail: decision.detail,
          });
          continue;
        }
        update((current) => ({
          ...current,
          queue: current.queue.filter((queued) => queued.id !== item.id),
        }));
        if (decision.action === "done") {
          setThread(item.threadId, { lastMessageId: item.lastMessageId });
        }
        recordSave(item.threadId, item.companyId, {
          at: nowIso(),
          status: decision.status,
          detail:
            [decision.detail, redactionNote(item)].filter((part) => part !== null).join(" · ") ||
            null,
        });
      }
    } finally {
      flushing = false;
      const wake = nextWakeAt(
        state.queue.filter((item) => connectionFor(item.companyId) !== null),
        state.holds,
      );
      if (wake !== null) scheduleFlush(wake - Date.now());
    }
  };

  const mcp = yield* Effect.promise(() =>
    startMemoryMcpServer(
      (companyId) => {
        if (connectionFor(companyId) === null) return null;
        return {
          companyName: companyName(companyId),
          call: async (tool, args) => {
            const text = (key: string) =>
              typeof args[key] === "string" ? (args[key] as string) : undefined;
            switch (tool) {
              case "memory_search": {
                const query = text("query") ?? "";
                if (query.trim() === "") throw new Error("query is required.");
                const limit =
                  typeof args.limit === "number"
                    ? Math.min(Math.max(Math.round(args.limit), 1), 50)
                    : 10;
                const body = await call(companyId, "GET", "/v1/search", {
                  query: {
                    q: query.slice(0, 500),
                    limit,
                    include_superseded: args.include_history !== false,
                  },
                  // the starter's own memory too (preferences, their notes), each fact labelled
                  withPersonal: true,
                });
                const facts = listOf(body, "facts").map(toFact);
                const entities = listOf(body, "entities").map(toEntity);
                const entityLines = entities.map(
                  (item) =>
                    `- ${item.name} (${item.types.join(", ") || "entity"}, id: ${item.id})${item.summary ? `: ${item.summary}` : ""}`,
                );
                return [
                  formatFacts(`Memory results for "${query}"`, facts),
                  ...(entityLines.length > 0 ? ["Entities:", ...entityLines] : []),
                ].join("\n");
              }
              case "memory_decisions":
                return formatList(
                  "Decisions",
                  await decisions({
                    companyId,
                    includeSuperseded: args.include_superseded === true,
                    ...(text("cursor") === undefined ? {} : { cursor: text("cursor")! }),
                  }),
                );
              case "memory_promises": {
                const status = text("status");
                const valid = [
                  "open",
                  "overdue",
                  "done",
                  "cancelled",
                  "superseded",
                  "all",
                ] as const;
                const chosen = valid.find((candidate) => candidate === status) ?? "all";
                return formatList(
                  `Promises (${chosen})`,
                  await promises({
                    companyId,
                    status: chosen,
                    ...(text("cursor") === undefined ? {} : { cursor: text("cursor")! }),
                  }),
                );
              }
              case "memory_entity": {
                const entityId = text("entity_id");
                if (entityId === undefined) throw new Error("entity_id is required.");
                const result = await entity({ companyId, entityId });
                return [
                  `${result.entity.name} (${result.entity.types.join(", ") || "entity"})${result.entity.summary ? `: ${result.entity.summary}` : ""}`,
                  formatFacts("Timeline, oldest first", result.timeline),
                ].join("\n");
              }
              default:
                throw new Error(`Unknown tool ${tool}.`);
            }
          },
        };
      },
      Number(process.env.ZEN_MEMORY_MCP_PORT ?? 0) || 0,
    ),
  );

  // Documents from other Zen features (the onboarding company profile) take the same queue.
  setZenMemoryWriter({
    connected: (companyId) => connectionFor(companyId) !== null,
    saveDocument: async (companyId, document) => {
      const finalized = finalizeSummary(document.text);
      const threadId = `zen-doc:${document.key}`.slice(0, 120);
      const now = Date.now();
      const item: QueuedEpisode = {
        id: `${threadId}:${now}`,
        companyId,
        threadId,
        lastMessageId: String(now),
        body: {
          summary: finalized.text,
          source: {
            thread_id: threadId,
            timestamp: new Date(now).toISOString(),
            user: userName(),
            machine: NodeOS.hostname(),
            title: document.title,
            app: "zen-staff",
          },
          idempotency_key: `${threadId}:${NodeCrypto.createHash("sha256").update(finalized.text).digest("hex").slice(0, 16)}`,
        },
        attempts: 0,
        enqueuedAt: now,
        notBefore: now,
        redacted: finalized.redacted,
      };
      update((current) => ({ ...current, queue: enqueue(current.queue, item) }));
      recordSave(threadId, companyId, {
        at: nowIso(),
        status: "queued",
        detail: redactionNote(item),
      });
      await flush();
      return threadMemory(threadId).lastSave ?? { status: "queued", detail: null };
    },
  });
  setZenMemoryMcpResolver((projectId) => {
    const companyId = companyOfProject(projectId);
    if (connectionFor(companyId) === null) return null;
    return { url: mcp.urlFor(companyId), token: mcp.tokenFor(companyId) };
  });
  // Codex threads are matched by working folder: keep the project roots fresh (every minute).
  let projectRoots: ReadonlyArray<{ root: string; projectId: string }> = [];
  const refreshRoots = () =>
    runPromise(
      projects.listShells().pipe(
        Effect.map((shells) =>
          shells.flatMap((shell) => {
            const root = (shell as { readonly workspaceRoot?: unknown }).workspaceRoot;
            return typeof root === "string" ? [{ root, projectId: shell.id }] : [];
          }),
        ),
        Effect.orElseSucceed(() => projectRoots),
      ),
    ).then((roots) => {
      projectRoots = roots;
    });
  void refreshRoots();
  // Hosted memory: machines of hub companies get their key without opening the Memory tab.
  const ensureAllHosted = () => {
    for (const companyId of Object.keys(readCompaniesFile(companiesFile).names)) {
      void ensureHostedKey(companyId)
        .then(() => refreshZones(companyId))
        .catch(() => undefined);
    }
    void ensurePersonalKey();
  };
  const hostedTimer = setInterval(ensureAllHosted, 60_000);
  hostedTimer.unref();
  const firstHosted = setTimeout(ensureAllHosted, 10_000);
  firstHosted.unref();
  const rootsTimer = setInterval(() => void refreshRoots(), 60_000);
  rootsTimer.unref();
  setZenMemoryProjectByCwd((cwd) => projectForCwd(cwd, projectRoots));
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      setZenMemoryMcpResolver(null);
      setZenMemoryWriter(null);
      setZenMemoryProjectByCwd(null);
      clearInterval(rootsTimer);
      clearInterval(hostedTimer);
      clearTimeout(firstHosted);
      if (wakeTimer !== null) clearTimeout(wakeTimer);
      await mcp.close();
    }),
  );

  const timers = yield* FiberMap.make<ThreadId>();
  // Settled: summarize now, or, when the thread had a summary less than the interval ago, wait
  // until then (still in this fiber, so a new run interrupts the wait) and summarize what is new.
  const saveWhenDue = (threadId: ThreadId): Effect.Effect<void> =>
    Effect.promise(() => saveThreadWhenDue(threadId, true)).pipe(
      Effect.flatMap(({ waitUntil }) =>
        waitUntil === null
          ? Effect.void
          : Effect.sleep(Duration.millis(Math.max(waitUntil - Date.now(), 1_000))).pipe(
              Effect.andThen(Effect.suspend(() => saveWhenDue(threadId))),
            ),
      ),
    );
  const settleThenSave = (threadId: ThreadId) =>
    Effect.sleep(Duration.millis(settleMs)).pipe(
      Effect.andThen(saveWhenDue(threadId)),
      Effect.catchCause((cause) =>
        Effect.logWarning("company memory save skipped", { threadId, cause }),
      ),
      Effect.asVoid,
    );
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
      if (event.type !== "run.updated") return Effect.void;
      // A new run interrupts the wait; a completed one (re)starts it.
      return event.payload.status === "completed"
        ? FiberMap.run(timers, event.threadId, settleThenSave(event.threadId)).pipe(Effect.asVoid)
        : FiberMap.remove(timers, event.threadId);
    }),
  );
  // Summaries left in the queue by the last run of the server.
  scheduleFlush(5_000);
  // Settle timers live in memory: threads that finished while the server was down, or just
  // before it stopped, are summarized once at startup (only those since the company connected).
  const catchUp = Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(Math.min(settleMs, 30_000)));
    const snapshot = yield* orchestrator.getShellSnapshot();
    const candidates = threadsToCatchUp(
      snapshot.threads.map((shell) => ({
        id: String(shell.id),
        companyId: companyOfProject(shell.projectId),
        latestRunCompletedAt:
          shell.latestRunCompletedAt === undefined || shell.latestRunCompletedAt === null
            ? null
            : DateTime.toEpochMillis(shell.latestRunCompletedAt),
      })),
      (companyId: string) => {
        const since = companyConfig(companyId).connectedAt;
        return savingFor(companyId) && since !== undefined ? Date.parse(since) : null;
      },
      yield* Clock.currentTimeMillis,
    );
    for (const threadId of candidates) {
      yield* Effect.promise(() => saveThread(threadId)).pipe(Effect.ignore);
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("company memory catch-up skipped", { cause })),
  );
  yield* forkParked(catchUp);

  const wrap =
    <I, A>(run: (input: I) => Promise<A>, fallback: string) =>
    (input: I) =>
      Effect.tryPromise({
        try: () => run(input),
        catch: (cause) =>
          isZenMemoryError(cause)
            ? cause
            : fail(
                "unavailable",
                cause instanceof Error ? `${fallback} ${cause.message}` : fallback,
              ),
      });

  return ZenMemory.of({
    settings: wrap(async (input: ZenMemoryCompanyInput) => {
      if (input.companyId === PERSONAL) await ensurePersonalKey();
      else await ensureHostedKey(input.companyId);
      return settingsOf(input.companyId);
    }, "Could not read the memory settings."),
    zones: wrap(zones, "Could not list the memory zones."),
    facts: wrap(facts, "Could not list what memory knows."),
    factAction: wrap(factAction, "Could not change this item."),
    pendingRules: wrap(pendingRules, "Could not list the rules waiting for confirmation."),
    decideRule: wrap(decideRule, "Could not save your answer."),
    forgetPerson: wrap(forgetPerson, "Could not erase this person."),
    configure: wrap(configure, "Could not save the memory settings."),
    test: wrap(test, "Could not test the connection."),
    search: wrap(search, "Could not search company memory."),
    decisions: wrap(decisions, "Could not list decisions."),
    promises: wrap(promises, "Could not list promises."),
    entity: wrap(entity, "Could not read this entry."),
    forget: wrap(forget, "Could not erase this entry."),
    threadState: wrap(
      (input: ZenMemoryThreadInput) => threadStateOf(input.threadId),
      "Could not read the chat's memory state.",
    ),
    setThreadSkip: wrap(async (input: ZenMemorySetThreadSkipInput) => {
      setThread(input.threadId, { skip: input.skip });
      if (input.skip) {
        // Also drop a summary of this chat that is still waiting to be sent.
        update((current) => ({
          ...current,
          queue: current.queue.filter((item) => item.threadId !== input.threadId),
        }));
      }
      return threadStateOf(input.threadId);
    }, "Could not change the chat's memory setting."),
    saveThread: Effect.fn("ZenMemory.saveThread")((threadId: string) =>
      Effect.promise(() => saveThread(threadId)).pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      ),
    ),
    previewImported: wrap(previewImported, "Could not summarize the imported chat."),
    sendImported: wrap(sendImported, "Could not queue the summary."),
  });
});

export const layer = Layer.effect(ZenMemory, make);

/** RPC handlers for ws.ts; the service is optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenMemory["Service"]>) => {
  const run = <A>(use: (memory: ZenMemory["Service"]) => Effect.Effect<A, ZenMemoryError>) =>
    Option.isSome(service)
      ? use(service.value)
      : Effect.fail(fail("unavailable", "Company memory is not available on this server."));
  return {
    [ZEN_MEMORY_WS_METHODS.settings]: (input: ZenMemoryCompanyInput) =>
      run((memory) => memory.settings(input)),
    [ZEN_MEMORY_WS_METHODS.configure]: (input: ZenMemoryConfigureInput) =>
      run((memory) => memory.configure(input)),
    [ZEN_MEMORY_WS_METHODS.test]: (input: ZenMemoryTestInput) =>
      run((memory) => memory.test(input)),
    [ZEN_MEMORY_WS_METHODS.search]: (input: ZenMemorySearchInput) =>
      run((memory) => memory.search(input)),
    [ZEN_MEMORY_WS_METHODS.decisions]: (input: ZenMemoryListInput) =>
      run((memory) => memory.decisions(input)),
    [ZEN_MEMORY_WS_METHODS.promises]: (input: ZenMemoryListInput) =>
      run((memory) => memory.promises(input)),
    [ZEN_MEMORY_WS_METHODS.entity]: (input: ZenMemoryEntityInput) =>
      run((memory) => memory.entity(input)),
    [ZEN_MEMORY_WS_METHODS.forget]: (input: ZenMemoryForgetInput) =>
      run((memory) => memory.forget(input)),
    [ZEN_MEMORY_WS_METHODS.threadState]: (input: ZenMemoryThreadInput) =>
      run((memory) => memory.threadState(input)),
    [ZEN_MEMORY_WS_METHODS.setThreadSkip]: (input: ZenMemorySetThreadSkipInput) =>
      run((memory) => memory.setThreadSkip(input)),
    [ZEN_MEMORY_WS_METHODS.zones]: (input: ZenMemoryCompanyInput) =>
      run((memory) => memory.zones(input)),
    [ZEN_MEMORY_WS_METHODS.facts]: (input: ZenMemoryFactsInput) =>
      run((memory) => memory.facts(input)),
    [ZEN_MEMORY_WS_METHODS.factAction]: (input: ZenMemoryFactActionInput) =>
      run((memory) => memory.factAction(input)),
    [ZEN_MEMORY_WS_METHODS.pendingRules]: (input: ZenMemoryCompanyInput) =>
      run((memory) => memory.pendingRules(input)),
    [ZEN_MEMORY_WS_METHODS.decideRule]: (input: ZenMemoryDecideRuleInput) =>
      run((memory) => memory.decideRule(input)),
    [ZEN_MEMORY_WS_METHODS.forgetPerson]: (input: ZenMemoryForgetPersonInput) =>
      run((memory) => memory.forgetPerson(input)),
  };
};
