// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off - plain async code that runs outside the Effect runtime (wrapped by ZenMemory.ts).
// Zen Staff: the HTTP client for a zen-memory server (README "Client contract"). Every call sends
// the company's API key as a Bearer token; responses are mapped from the server's snake_case to
// the app's camelCase shapes (`@t3tools/contracts/zenMemory`). No Effect here so the MCP server
// and the queue can call it directly.
import type {
  ZenMemoryEntity,
  ZenMemoryFact,
  ZenMemoryQuota,
  ZenMemorySource,
} from "@t3tools/contracts/zenMemory";

export interface MemoryConnection {
  readonly url: string;
  readonly apiKey: string;
}

export type MemoryFailureKind =
  | "unauthorized"
  /** 403: the key is valid but may not do this (an admin-only action, another person's key). */
  | "forbidden"
  | "quota"
  | "not-found"
  | "too-large"
  | "invalid"
  | "server"
  | "network";

export type MemoryCallResult<T> =
  | { readonly ok: true; readonly status: number; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: MemoryFailureKind;
      readonly status: number | null;
      /** 429: how long to wait (Retry-After, retry_after_seconds or resets_at). */
      readonly retryAfterMs: number | null;
      readonly detail: string;
    };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 20_000;

/** A usable base URL (http/https, no credentials, no query), without a trailing slash; else null. */
export function normalizeMemoryUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return null;
  }
  return url.toString().replace(/\/+$/, "");
}

/** Milliseconds to wait after a 429: the Retry-After header, else the body's hints. */
export function retryAfterMs(
  header: string | null,
  body: unknown,
  now: number = Date.now(),
): number | null {
  if (header !== null && header.trim() !== "") {
    const seconds = Number(header.trim());
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  if (isRecord(body)) {
    const seconds = body.retry_after_seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
    if (typeof body.resets_at === "string") {
      const date = Date.parse(body.resets_at);
      if (Number.isFinite(date)) return Math.max(0, date - now);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

function failureDetail(status: number, body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.message === "string") return body.message;
    if (typeof body.detail === "string") return body.detail;
  }
  return `zen-memory answered ${status}.`;
}

function failureKind(status: number): MemoryFailureKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "quota";
  if (status === 404) return "not-found";
  if (status === 413) return "too-large";
  if (status >= 500) return "server";
  return "invalid";
}

export async function memoryRequest(
  connection: MemoryConnection,
  method: "GET" | "POST" | "DELETE" | "PATCH",
  path: string,
  options: {
    readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
    readonly body?: unknown;
    /** Extra headers (X-Zen-Personal-Key, X-Zen-Company-Key; zen-memory v4). */
    readonly headers?: Readonly<Record<string, string>>;
    readonly fetch?: FetchLike;
    readonly timeoutMs?: number;
    readonly now?: () => number;
  } = {},
): Promise<MemoryCallResult<unknown>> {
  const url = new URL(`${connection.url}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const doFetch = options.fetch ?? ((target, init) => fetch(target, init));
  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      kind: "network",
      status: null,
      retryAfterMs: null,
      detail: `Could not reach the memory server (${cause instanceof Error ? cause.message : "network error"}).`,
    };
  }
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  if (response.ok) return { ok: true, status: response.status, value: body };
  return {
    ok: false,
    kind: failureKind(response.status),
    status: response.status,
    retryAfterMs:
      response.status === 429
        ? retryAfterMs(response.headers.get("retry-after"), body, (options.now ?? Date.now)())
        : null,
    detail: failureDetail(response.status, body),
  };
}

// Mapping from the server's JSON.

function toSource(raw: unknown): ZenMemorySource {
  const source = isRecord(raw) ? raw : {};
  return {
    threadId: str(source.thread_id),
    title: str(source.title),
    user: str(source.user),
    machine: str(source.machine),
    project: str(source.project),
    at: str(source.reference_time) ?? str(source.timestamp),
  };
}

function toRef(raw: unknown): { readonly id: string; readonly name: string } | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  return id === null ? null : { id, name: str(raw.name) ?? id };
}

/** A fact, decision or promise from /v1/search, /v1/decisions, /v1/promises or a timeline. */
export function toFact(raw: unknown): ZenMemoryFact {
  const fact = isRecord(raw) ? raw : {};
  const attributes = isRecord(fact.attributes) ? fact.attributes : {};
  const type = str(fact.type) ?? "Fact";
  const owner =
    str(fact.owner) ??
    (type === "Promise" ? str(attributes.promised_by) : null) ??
    (type === "Decision" ? str(attributes.decided_by) : null);
  return {
    id: str(fact.id) ?? "",
    type,
    fact: typeof fact.fact === "string" ? fact.fact : "",
    validFrom: str(fact.valid_from),
    validTo: str(fact.valid_to),
    current: fact.current !== false,
    subject: toRef(fact.subject),
    object: toRef(fact.object),
    owner,
    promisedTo: str(fact.promised_to) ?? str(attributes.promised_to),
    dueDate: str(fact.due_date) ?? str(attributes.due_date),
    decisionDate: str(fact.decision_date) ?? str(attributes.decision_date),
    status: str(fact.status) ?? str(attributes.status),
    sources: Array.isArray(fact.sources) ? fact.sources.map(toSource) : [],
    zone: toZoneRef(fact.zone),
    trust: fact.trust === "untrusted" || fact.trust === "confirmed" ? fact.trust : "trusted",
    promotedTo: str(fact.promoted_to),
    markedWrong:
      str(attributes.zm_marked_wrong_at) !== null || str(attributes.zm_marked_wrong_by) !== null,
  };
}

function toZoneRef(raw: unknown): ZenMemoryFact["zone"] {
  if (!isRecord(raw)) return null;
  const ref = str(raw.ref);
  const kind = raw.kind;
  if (
    ref === null ||
    (kind !== "company" && kind !== "team" && kind !== "project" && kind !== "personal")
  )
    return null;
  return { ref, kind, name: str(raw.name) ?? ref };
}

export function toEntity(raw: unknown): ZenMemoryEntity {
  const entity = isRecord(raw) ? raw : {};
  return {
    id: str(entity.id) ?? "",
    name: str(entity.name) ?? "",
    types: Array.isArray(entity.types)
      ? entity.types.filter((type): type is string => typeof type === "string")
      : [],
    summary: str(entity.summary),
  };
}

export function toQuotas(raw: unknown): ReadonlyArray<ZenMemoryQuota> {
  if (!isRecord(raw)) return [];
  return Object.entries(raw)
    .filter(([, value]) => isRecord(value))
    .map(([name, value]) => {
      const quota = value as Record<string, unknown>;
      return {
        name,
        limit: typeof quota.limit === "number" ? quota.limit : 0,
        used: typeof quota.used === "number" ? quota.used : 0,
        resetsAt: str(quota.resets_at),
      };
    });
}

export function toGraphCounts(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") counts[key] = value;
  }
  return counts;
}

export function listOf(body: unknown, key: string): ReadonlyArray<unknown> {
  return isRecord(body) && Array.isArray(body[key]) ? (body[key] as ReadonlyArray<unknown>) : [];
}

export function nextCursorOf(body: unknown): string | null {
  return isRecord(body) ? str(body.next_cursor) : null;
}

export function numberField(body: unknown, key: string): number {
  return isRecord(body) && typeof body[key] === "number" ? (body[key] as number) : 0;
}

export function stringField(body: unknown, key: string): string | null {
  return isRecord(body) ? str(body[key]) : null;
}

/** The body of POST /v1/episodes. */
export interface EpisodeBody {
  readonly summary: string;
  readonly source: {
    readonly thread_id: string;
    readonly timestamp: string;
    readonly user?: string;
    readonly machine?: string;
    readonly project?: string;
    readonly title?: string;
    readonly app: "zen-staff";
  };
  readonly idempotency_key: string;
  /** v4: the zone of the chat's project ("company", "project:<id>"). */
  readonly zone?: string;
}
