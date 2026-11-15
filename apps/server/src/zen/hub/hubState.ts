// @effect-diagnostics nodeBuiltinImport:off -- Promise boundary shared with the runner socket callbacks.
// Zen Staff hub: what this machine remembers about its hub. Saved to
// `<state dir>/zen/hub.json`, mode 0600 (it holds the session token and the runner credential).
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ZenHubAccess } from "@t3tools/contracts/zenHub";

import type { DeviceIdentity } from "./hubCrypto.ts";
import type { HubAccessLedger, HubRole } from "./hubBridge.ts";
import { emptyTrustStore, type TrustStore } from "./relayTrust.ts";

export interface LocalShare {
  /** Shared thread on THIS machine. */
  readonly threadId: string;
  readonly kind: "personal" | "company" | "handover";
  readonly companyId: string;
}

export interface HubState {
  readonly version: 1;
  readonly hubUrl: string | null;
  readonly session: {
    readonly token: string;
    readonly user: { readonly id: string; readonly email: string; readonly name: string };
  } | null;
  readonly pendingLogin: {
    readonly email: string;
    readonly requestId: string;
    readonly pollSecret: string;
    readonly machineName: string;
  } | null;
  readonly environment: {
    readonly id: string;
    readonly credential: string;
    readonly name: string;
    /** The hub account this machine was registered with. */
    readonly userId: string;
    /** Runner keys (sign + box), published to the hub; kept while the environment lives. */
    readonly keys?: DeviceIdentity | null;
  } | null;
  /**
   * The hub companies this machine is the runner of (hub v9: one machine, one login and one
   * service may serve several companies; each keeps its own AI account, staff, memory scope and
   * sealing context). `runnerCompanyId` is the first one, written for older readers of hub.json.
   */
  readonly runnerCompanyIds: ReadonlyArray<string>;
  readonly runnerCompanyId: string | null;
  /** Local company id (companies feature) -> hub company id. */
  readonly links: Readonly<Record<string, string>>;
  /**
   * The runner-side allow-list: hub share id -> thread. Written only when the owner shares from
   * this machine. A relay request for any other share or thread is refused here, whatever the hub
   * says, so a compromised hub cannot read chats nobody shared.
   */
  readonly shares: Readonly<Record<string, LocalShare>>;
  /** This machine's device keys, created at sign-in (private halves never leave this file). */
  readonly device: DeviceIdentity | null;
  /** Devices and runners this machine trusts (relayTrust.ts). */
  readonly trust: TrustStore;
  /** Last answers from the hub, so a short hub outage changes nothing on this machine. */
  readonly cache: {
    readonly roles: Readonly<Record<string, HubRole>>;
    readonly settings: Readonly<
      Record<string, { readonly url: string | null; readonly saveConversations: boolean }>
    >;
    /** Hosted company memory per hub company (hub v13; absent on older hubs). */
    readonly hosted?: Readonly<
      Record<
        string,
        {
          readonly available: boolean;
          readonly activated: boolean;
          readonly active: boolean;
          readonly url: string | null;
        }
      >
    >;
    /** The signed-in person's own memory (hub v17; absent on older hubs). */
    readonly personalMemory?: {
      readonly available: boolean;
      readonly active: boolean;
      readonly url: string | null;
    } | null;
    /** Verified Enterprise ledger of the first company this machine runs for (older readers). */
    readonly ledger: HubAccessLedger | null;
    readonly ledgerRefused: ReadonlyArray<{ id: string; packId: string; reason: string }>;
    /**
     * Verified Enterprise ledger of every company this machine runs for (hub company id ->
     * ledger). Each company's runs are checked against its own grants only.
     */
    readonly ledgers?: Readonly<Record<string, HubAccessLedger>>;
    /**
     * Hub v9: my permissions in each of my hub companies (team-scoped grants already expanded to
     * their projects by the hub), for the checks this machine makes for me (agent edits,
     * approvals on the runner). Absent: an older hub or not synced yet (role defaults apply).
     */
    readonly access?: Readonly<Record<string, ZenHubAccess>>;
    /** Names of my hub companies (for screens on this machine that pick one). */
    readonly names?: Readonly<Record<string, string>>;
  };
  /**
   * Which AI account this runner uses for each company's agents (hub company id -> account; the
   * key is in the vault under that company).
   */
  readonly companyAis: Readonly<Record<string, CompanyAiAccount>>;
}

export interface CompanyAiAccount {
  readonly provider: "claude" | "codex";
  readonly mode: "seat" | "api-key";
  readonly label: string;
}

const isAiAccount = (value: unknown): value is CompanyAiAccount =>
  isRecord(value) &&
  (value.provider === "claude" || value.provider === "codex") &&
  (value.mode === "seat" || value.mode === "api-key") &&
  typeof value.label === "string";

/** Per company; a file from before hub v9 has one `companyAi` for its one runner company. */
function normalizeCompanyAis(raw: Record<string, unknown>): Record<string, CompanyAiAccount> {
  const out: Record<string, CompanyAiAccount> = {};
  if (isRecord(raw.companyAis)) {
    for (const [id, value] of Object.entries(raw.companyAis)) {
      if (isAiAccount(value))
        out[id] = { provider: value.provider, mode: value.mode, label: value.label };
    }
  } else if (isAiAccount(raw.companyAi) && typeof raw.runnerCompanyId === "string") {
    out[raw.runnerCompanyId] = {
      provider: raw.companyAi.provider,
      mode: raw.companyAi.mode,
      label: raw.companyAi.label,
    };
  }
  return out;
}

/** Whether this machine is the runner of that hub company. */
export const isRunnerOf = (
  state: Pick<HubState, "runnerCompanyIds">,
  hubCompanyId: string | null,
) => hubCompanyId !== null && state.runnerCompanyIds.includes(hubCompanyId);

/** The list and its legacy first entry, always set together. */
export const withRunnerCompanies = (ids: ReadonlyArray<string>) => {
  const runnerCompanyIds = [...new Set(ids)];
  return { runnerCompanyIds, runnerCompanyId: runnerCompanyIds[0] ?? null };
};

export const emptyHubCache = (): HubState["cache"] => ({
  roles: {},
  settings: {},
  ledger: null,
  ledgerRefused: [],
  ledgers: {},
});

const EMPTY_LEDGER: HubAccessLedger = { grants: [], approvals: [] };

/**
 * The Enterprise ledger that decides for a run on this runner (null: not a hub runner, the local
 * ledger file applies). A local company linked to a company this machine serves gets that
 * company's grants only; linked to a company it does not serve: none. Without a company (or an
 * unlinked one), the first served company's, as before several companies.
 */
export function runnerLedgerFor(
  state: Pick<HubState, "session" | "runnerCompanyIds" | "links" | "cache">,
  localCompanyId?: string | null,
): HubAccessLedger | null {
  if (state.session === null || state.runnerCompanyIds.length === 0) return null;
  const first = state.runnerCompanyIds[0]!;
  const linked =
    localCompanyId === undefined || localCompanyId === null
      ? undefined
      : state.links[localCompanyId];
  const hubCompanyId = linked ?? first;
  if (!state.runnerCompanyIds.includes(hubCompanyId)) return EMPTY_LEDGER;
  const ledger =
    state.cache.ledgers?.[hubCompanyId] ?? (hubCompanyId === first ? state.cache.ledger : null);
  return ledger ?? EMPTY_LEDGER;
}

/**
 * The hub company an Enterprise action on this server is for: the one asked for (when served),
 * else the local company's linked one (when served), else the first served company. Null when
 * this machine is not a hub runner, or the company asked for is not one it serves.
 */
export function runnerCompanyFor(
  state: Pick<HubState, "session" | "runnerCompanyIds" | "links">,
  scope: { readonly hubCompanyId?: string | null; readonly localCompanyId?: string | null } = {},
): string | null {
  if (state.session === null || state.runnerCompanyIds.length === 0) return null;
  if (scope.hubCompanyId != null) {
    return state.runnerCompanyIds.includes(scope.hubCompanyId) ? scope.hubCompanyId : null;
  }
  const linked = scope.localCompanyId == null ? undefined : state.links[scope.localCompanyId];
  if (linked !== undefined) return state.runnerCompanyIds.includes(linked) ? linked : null;
  return state.runnerCompanyIds[0]!;
}

/** The verified Enterprise ledger of one company this machine serves (empty for any other). */
export function runnerLedgerOfHub(
  state: Pick<HubState, "session" | "runnerCompanyIds" | "cache">,
  hubCompanyId: string,
): HubAccessLedger {
  if (state.session === null || !state.runnerCompanyIds.includes(hubCompanyId)) return EMPTY_LEDGER;
  const first = state.runnerCompanyIds[0];
  return (
    state.cache.ledgers?.[hubCompanyId] ??
    (hubCompanyId === first ? state.cache.ledger : null) ??
    EMPTY_LEDGER
  );
}

/**
 * Whether an Enterprise pack may be installed on this server for one company: only that
 * company's admins' install approval counts, never another served company's. Null: this machine
 * is not a hub runner (the local ledger file decides).
 */
export function runnerInstallApproved(
  state: Pick<HubState, "session" | "runnerCompanyIds" | "links" | "cache">,
  packId: string,
  scope: { readonly hubCompanyId?: string | null; readonly localCompanyId?: string | null } = {},
): boolean | null {
  if (state.session === null || state.runnerCompanyIds.length === 0) return null;
  const hubCompanyId = runnerCompanyFor(state, scope);
  if (hubCompanyId === null) return false;
  return runnerLedgerOfHub(state, hubCompanyId).approvals.some(
    (approval) => approval.packId === packId,
  );
}

export const emptyHubState = (): HubState => ({
  version: 1,
  hubUrl: null,
  session: null,
  pendingLogin: null,
  environment: null,
  runnerCompanyIds: [],
  runnerCompanyId: null,
  links: {},
  shares: {},
  device: null,
  trust: emptyTrustStore(),
  cache: emptyHubCache(),
  companyAis: {},
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeHubState(raw: unknown): HubState {
  const base = emptyHubState();
  if (!isRecord(raw) || raw.version !== 1) return base;
  const links: Record<string, string> = {};
  if (isRecord(raw.links)) {
    for (const [key, value] of Object.entries(raw.links)) {
      if (typeof value === "string") links[key] = value;
    }
  }
  const shares: Record<string, LocalShare> = {};
  if (isRecord(raw.shares)) {
    for (const [key, value] of Object.entries(raw.shares)) {
      if (
        isRecord(value) &&
        typeof value.threadId === "string" &&
        typeof value.companyId === "string" &&
        (value.kind === "personal" || value.kind === "company" || value.kind === "handover")
      ) {
        shares[key] = { threadId: value.threadId, kind: value.kind, companyId: value.companyId };
      }
    }
  }
  return {
    ...base,
    hubUrl: typeof raw.hubUrl === "string" ? raw.hubUrl : null,
    session: isRecord(raw.session) ? (raw.session as unknown as HubState["session"]) : null,
    pendingLogin: isRecord(raw.pendingLogin)
      ? (raw.pendingLogin as unknown as HubState["pendingLogin"])
      : null,
    environment: isRecord(raw.environment)
      ? (raw.environment as unknown as HubState["environment"])
      : null,
    // Files from before hub v9 have one runner company and one AI account.
    ...withRunnerCompanies(
      Array.isArray(raw.runnerCompanyIds)
        ? raw.runnerCompanyIds.filter((id): id is string => typeof id === "string")
        : typeof raw.runnerCompanyId === "string"
          ? [raw.runnerCompanyId]
          : [],
    ),
    companyAis: normalizeCompanyAis(raw),
    links,
    shares,
    device:
      isRecord(raw.device) && typeof raw.device.keyId === "string"
        ? (raw.device as unknown as DeviceIdentity)
        : null,
    trust: isRecord(raw.trust)
      ? {
          devices: isRecord(raw.trust.devices) ? (raw.trust.devices as TrustStore["devices"]) : {},
          revoked: Array.isArray(raw.trust.revoked)
            ? raw.trust.revoked.filter((item): item is string => typeof item === "string")
            : [],
          rejected: Array.isArray(raw.trust.rejected)
            ? raw.trust.rejected.filter((item): item is string => typeof item === "string")
            : [],
          runners: isRecord(raw.trust.runners) ? (raw.trust.runners as TrustStore["runners"]) : {},
        }
      : emptyTrustStore(),
    cache: isRecord(raw.cache)
      ? { ...emptyHubCache(), ...(raw.cache as Partial<HubState["cache"]>) }
      : emptyHubCache(),
  };
}

/**
 * Hub URLs must be https, except a hub on this machine (http://localhost, 127.0.0.1, [::1]) for
 * development and single-machine self-hosting.
 */
export function normalizeHubUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username !== "" || url.password !== "") return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export async function loadHubState(file: string): Promise<HubState> {
  try {
    return normalizeHubState(JSON.parse(await NodeFSP.readFile(file, "utf8")));
  } catch {
    return emptyHubState();
  }
}

export async function saveHubState(file: string, state: HubState): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await NodeFSP.rename(temporary, file);
}

/** Reads the companies feature's project -> company map (its own file; read-only here). */
export async function readProjectCompanies(file: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await NodeFSP.readFile(file, "utf8")) as unknown;
    if (!isRecord(raw) || !isRecord(raw.projects)) return {};
    const result: Record<string, string> = {};
    for (const [projectId, companyId] of Object.entries(raw.projects)) {
      if (typeof companyId === "string") result[projectId] = companyId;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * A chat is a company chat when its project belongs to a local company linked to a hub company
 * and this machine is that company's runner. Everything else is personal.
 */
export function threadKind(input: {
  readonly projectId: string;
  readonly projectCompanies: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, string>>;
  readonly runnerCompanyIds: ReadonlyArray<string>;
}): { readonly kind: "personal" | "company"; readonly hubCompanyId: string | null } {
  const localCompanyId = input.projectCompanies[input.projectId] ?? "personal";
  const hubCompanyId = input.links[localCompanyId] ?? null;
  if (hubCompanyId !== null && input.runnerCompanyIds.includes(hubCompanyId)) {
    return { kind: "company", hubCompanyId };
  }
  return { kind: "personal", hubCompanyId };
}

/** Runner-side check of a relay request against the local allow-list. */
export function authorizeRelayRequest(
  state: HubState,
  request: {
    readonly op: string;
    readonly shareId: string;
    readonly threadId: string;
    readonly companyId: string;
    /** Hub v9: the asker's role and permissions in that company, as the hub computed them. */
    readonly actorAccess?: { readonly role: string } | null;
  },
  currentKind: "personal" | "company" | null,
): string | null {
  const local = state.shares[request.shareId];
  if (local === undefined || local.threadId !== request.threadId) {
    return "This chat is not shared from this machine.";
  }
  if (local.companyId !== request.companyId) return "This chat is not shared with that company.";
  switch (request.op) {
    case "thread.view":
    case "thread.meta":
    case "thread.export":
    case "thread.attachment":
      return null;
    case "thread.prompt":
      // A personal chat runs on its owner's own AI account: nobody else prompts it, ever.
      if (local.kind !== "company") return "Only company chats accept prompts from colleagues.";
      if (currentKind !== "company" || !state.runnerCompanyIds.includes(request.companyId)) {
        return "This chat no longer runs on the company runner.";
      }
      // Decision 08.11.2026: members do not write free chats on the company server; they give
      // tasks to the company's AI staff and follow them read-only. Owners and admins still write.
      if (
        request.actorAccess != null &&
        request.actorAccess.role !== "owner" &&
        request.actorAccess.role !== "admin"
      ) {
        return "Members do not write chats on the company server. Give the task to an AI employee and follow it from there.";
      }
      return null;
    case "thread.handedOver":
      return local.kind === "handover" ? null : "This chat was not handed over.";
    default:
      return "Unknown request.";
  }
}
