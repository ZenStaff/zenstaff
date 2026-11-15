// @effect-diagnostics nodeBuiltinImport:off globalDate:off extendsNativeError:off globalFetch:off - plain async code at the hub boundary (wrapped by ZenOffice.ts, like the intake engine).
// Zen Staff: the community library ("Bibliotecă"). Free packs people publish to the hub, reviewed
// by the Zen team before they are public (zen-hub `src/routes/library.ts`).
//
// - Catalog: the hub serves a registry index at `/v1/library/catalog` (same entries as
//   registry.json, plus a `community` block with the author, installs and the "Verificat de Zen"
//   badge, and `withdrawn` for packs we took down). It is merged after the built-in registry: a
//   community pack never replaces a Zen Staff pack (the hub also refuses their ids). Installing one
//   is the remote-registry install (download, sha256 check, unpack, load), then the hub counts it.
// - Publish: one workflow folder (the person's own workflow, or their customized copy of a pack)
//   is packaged in the registry format under a new pack id, signed with this device's hub key and
//   uploaded as a submission. The hub runs its automatic checks and the review queue.
// - Community packs are never Enterprise and never get secrets: they run with the normal toolchain
//   sandbox and approvals. ZEN.md, "Community library".
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ZenRegistryIndex,
  workflowIdFromName,
  type ZenRegistryEntry,
  type ZenWorkflow,
} from "@t3tools/contracts/zenOffice";
import * as Schema from "effect/Schema";

import { canonicalJson, statementMessage } from "../hub/hubCrypto.ts";
import { fetchLimited, REMOTE_REGISTRY_LIMITS, resolveDownloadUrl } from "./remoteRegistry.ts";

const decodeIndex = Schema.decodeUnknownOption(ZenRegistryIndex);

export interface CommunityCatalog {
  /** Community packs, with download and image addresses made absolute. */
  readonly entries: ReadonlyArray<ZenRegistryEntry>;
  /** Packs the library took down: installed copies show the reason. */
  readonly withdrawn: ReadonlyArray<{ readonly id: string; readonly reason: string | null }>;
}

const absolute = (base: string, url: string) => {
  const resolved = resolveDownloadUrl(base, url);
  return "ok" in resolved ? resolved.ok : null;
};

/**
 * Reads the hub's catalog. Keeps only community packs with an archive (never builtins, never
 * coming-soon), tags them "community" and resolves relative addresses against the catalog URL.
 */
export function parseCommunityCatalog(text: string, catalogUrl: string): CommunityCatalog | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const index = decodeIndex(raw);
  if (index._tag === "None") return null;
  const entries: Array<ZenRegistryEntry> = [];
  for (const entry of index.value.entries) {
    if (entry.kind !== "pack" || entry.download === undefined || entry.community === undefined)
      continue;
    const download = absolute(catalogUrl, entry.download.url);
    if (download === null) continue;
    const community = entry.community;
    entries.push({
      ...entry,
      tags: [...new Set([...(entry.tags ?? []), "community"])],
      download: { ...entry.download, url: download },
      community: {
        ...community,
        screenshots: (community.screenshots ?? [])
          .map((shot) => absolute(catalogUrl, shot))
          .filter((shot): shot is string => shot !== null),
      },
    });
  }
  const withdrawnRaw = (raw as { withdrawn?: unknown }).withdrawn;
  const withdrawn = Array.isArray(withdrawnRaw)
    ? withdrawnRaw.flatMap((item) => {
        const value = item as { id?: unknown; reason?: unknown };
        return typeof value?.id === "string"
          ? [{ id: value.id, reason: typeof value.reason === "string" ? value.reason : null }]
          : [];
      })
    : [];
  return { entries, withdrawn };
}

/**
 * The registry entries with the community ones after them. An id already in the registry (a Zen
 * Staff pack or workflow) always wins: a community pack can never stand in for one of ours.
 */
export function mergeCommunityEntries<T extends { readonly entry: ZenRegistryEntry }>(
  registry: ReadonlyArray<T>,
  community: ReadonlyArray<ZenRegistryEntry>,
  wrap: (entry: ZenRegistryEntry) => T,
): Array<T> {
  const taken = new Set<string>();
  for (const item of registry) {
    taken.add(item.entry.id);
    for (const id of item.entry.workflows ?? []) taken.add(id);
  }
  const merged = [...registry];
  for (const entry of community) {
    if (taken.has(entry.id) || (entry.workflows ?? []).some((id) => taken.has(id))) continue;
    taken.add(entry.id);
    merged.push(wrap(entry));
  }
  return merged;
}

/** Files the app writes itself (install markers, customization state, backups): never published. */
const SKIPPED = new Set([
  ".zen-pack.json",
  ".zen-custom.json",
  ".zen-custom",
  ".zen-custom-backups",
  ".git",
  "node_modules",
  ".DS_Store",
  "Thumbs.db",
  "checks.json",
]);

/** Reads a workflow folder for publishing: relative paths with "/", skipping the app's own files. */
export async function readPackFolder(dir: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const walk = async (folder: string, prefix: string) => {
    for (const item of await NodeFSP.readdir(folder, { withFileTypes: true })) {
      if (SKIPPED.has(item.name)) continue;
      const relative = prefix === "" ? item.name : `${prefix}/${item.name}`;
      const full = NodePath.join(folder, item.name);
      if (item.isDirectory()) await walk(full, relative);
      else if (item.isFile()) files.set(relative, new Uint8Array(await NodeFSP.readFile(full)));
      // Links and special files are left out (the hub would refuse them anyway).
    }
  };
  await walk(dir, "");
  return files;
}

/** A pack id for the library from a title: the hub refuses Zen Staff ids, so a taken one gets a suffix. */
export function suggestPackId(title: string, reserved: ReadonlySet<string>): string {
  const base = workflowIdFromName(title) || "flux";
  const short = base.slice(0, 52).replace(/-+$/, "");
  return reserved.has(short) ? `${short}-comunitate` : short;
}

/**
 * The files of one workflow folder as a library pack: workflow.json gets the new pack id and
 * version (a customized copy keeps its original's id on this machine), everything else as is.
 */
export function packageForLibrary(
  files: ReadonlyMap<string, Uint8Array>,
  input: { readonly packId: string; readonly version: string; readonly author?: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, bytes] of files) {
    if (path === "workflow.json") {
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      const next = {
        ...manifest,
        id: input.packId,
        version: input.version,
        ...(input.author ? { author: input.author } : {}),
      };
      out[path] = Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString("base64");
    } else {
      out[path] = Buffer.from(bytes).toString("base64");
    }
  }
  return out;
}

export interface LibraryMeta {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly icon: string;
  readonly licence: string;
  readonly language: string;
  readonly changelog: string;
  readonly sampleOutput: string;
}

export interface LibraryScreenshot {
  readonly name: string;
  readonly mime: string;
  readonly data: string;
}

/** SHA-256 (base64url) over the canonical JSON of the submission; the hub computes the same. */
export function submissionDigest(input: {
  readonly packId: string;
  readonly version: string;
  readonly meta: LibraryMeta;
  readonly files: Record<string, string>;
  readonly screenshots: ReadonlyArray<LibraryScreenshot>;
}): string {
  return NodeCrypto.createHash("sha256").update(canonicalJson(input)).digest("base64url");
}

/** What the device signs (zen-hub `submissionStatement`). */
export function submissionStatementMessage(input: {
  readonly packId: string;
  readonly version: string;
  readonly digest: string;
  readonly by: string;
  readonly ts: number;
}): string {
  return statementMessage({
    kind: "zen-library-submission-v1",
    packId: input.packId,
    version: input.version,
    digest: input.digest,
    by: input.by,
    ts: input.ts,
  });
}

export class LibraryError extends Error {
  readonly reason: "invalid" | "not-found" | "unavailable" | "conflict" | "not-signed-in";
  readonly detail: unknown;
  constructor(reason: LibraryError["reason"], message: string, detail: unknown = null) {
    super(message);
    this.reason = reason;
    this.detail = detail;
  }
}

export interface LibraryDeps {
  /** The hub the library lives on (the signed-in one, else the default hosted hub); null = off. */
  readonly hubUrl: () => string | null;
  /** The hub session token when signed in. */
  readonly token: () => string | null;
  readonly userId: () => string | null;
  /** Signs a statement with this machine's hub device key (registers it on first use). */
  readonly sign: (message: string) => Promise<string>;
  /** Where the last catalog is kept, for offline use and for packs taken down later. */
  readonly cacheFile: string;
  /** The person's workflows (own and customized copies), with the folder each lives in. */
  readonly sources: (
    companyId: string | null,
  ) => Promise<ReadonlyArray<{ workflow: ZenWorkflow; dir: string }>>;
  /** Ids a community pack may not take (Zen Staff packs and workflows). */
  readonly reservedIds: () => Promise<ReadonlySet<string>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

interface CachedCatalog {
  readonly url: string;
  readonly fetchedAt: string;
  readonly catalog: CommunityCatalog;
  /** Every community entry seen so far, by id (names for packs taken down later). */
  readonly known: Record<string, ZenRegistryEntry>;
}

export interface CommunityLoad {
  readonly catalogUrl: string | null;
  readonly catalog: CommunityCatalog;
  readonly known: Readonly<Record<string, ZenRegistryEntry>>;
  readonly available: boolean;
  readonly notice: string | null;
}

const EMPTY: CommunityCatalog = { entries: [], withdrawn: [] };
const LICENCES = ["MIT", "CC-BY-4.0", "Apache-2.0", "CC0-1.0"];
const REPORT_REASONS = ["unsafe", "broken", "secrets", "spam", "copyright", "other"];

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export class CommunityLibrary {
  private memo: { url: string; at: number; load: CommunityLoad } | null = null;
  private readonly deps: LibraryDeps;

  constructor(deps: LibraryDeps) {
    this.deps = deps;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  catalogUrl(): string | null {
    const hub = this.deps.hubUrl();
    return hub === null ? null : `${hub.replace(/\/$/, "")}/v1/library/catalog`;
  }

  private async readCache(): Promise<CachedCatalog | null> {
    try {
      return JSON.parse(await NodeFSP.readFile(this.deps.cacheFile, "utf8")) as CachedCatalog;
    } catch {
      return null;
    }
  }

  /** The community catalog: fetched at most once a minute, else the saved copy. Never throws. */
  async load(): Promise<CommunityLoad> {
    const url = this.catalogUrl();
    if (url === null)
      return { catalogUrl: null, catalog: EMPTY, known: {}, available: false, notice: null };
    const now = this.now();
    if (this.memo && this.memo.url === url && now - this.memo.at < (this.deps.ttlMs ?? 60_000)) {
      return this.memo.load;
    }
    const cached = await this.readCache();
    const sameHub = cached !== null && cached.url === url ? cached : null;
    let load: CommunityLoad;
    try {
      const bytes = await fetchLimited(url, {
        timeoutMs: REMOTE_REGISTRY_LIMITS.indexTimeoutMs,
        maxBytes: REMOTE_REGISTRY_LIMITS.indexBytes,
      });
      const catalog = parseCommunityCatalog(new TextDecoder().decode(bytes), url);
      if (catalog === null) throw new Error("the library list is not valid");
      const known = { ...sameHub?.known };
      for (const entry of catalog.entries) known[entry.id] = entry;
      const saved: CachedCatalog = { url, fetchedAt: new Date(now).toISOString(), catalog, known };
      await NodeFSP.mkdir(NodePath.dirname(this.deps.cacheFile), { recursive: true });
      await NodeFSP.writeFile(this.deps.cacheFile, JSON.stringify(saved)).catch(() => undefined);
      load = { catalogUrl: url, catalog, known, available: true, notice: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      load = sameHub
        ? {
            catalogUrl: url,
            catalog: sameHub.catalog,
            known: sameHub.known,
            available: false,
            notice: `The community library could not be reached (${reason}). Showing the copy saved on ${sameHub.fetchedAt.slice(0, 10)}.`,
          }
        : {
            catalogUrl: url,
            catalog: EMPTY,
            known: {},
            available: false,
            notice: `The community library could not be reached (${reason}).`,
          };
    }
    this.memo = { url, at: now, load };
    return load;
  }

  /** Tells the hub one more person installed a community pack (credit for the author). */
  async countInstall(entry: ZenRegistryEntry): Promise<void> {
    const hub = this.deps.hubUrl();
    const slug = entry.community?.slug;
    if (hub === null || slug === undefined) return;
    const token = this.deps.token();
    await (this.deps.fetch ?? fetch)(
      `${hub.replace(/\/$/, "")}/v1/library/packs/${encodeURIComponent(slug)}/install`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => undefined);
    this.memo = null;
  }

  private async hub(method: string, path: string, body?: unknown, timeoutMs = 30_000) {
    const hub = this.deps.hubUrl();
    const token = this.deps.token();
    if (hub === null || token === null) {
      throw new LibraryError(
        "not-signed-in",
        "Sign in to the hub (Team > Account) to publish to the library.",
      );
    }
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(`${hub.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new LibraryError("unavailable", "The hub cannot be reached. Check your connection.");
    }
    const json = record(await response.json().catch(() => null));
    if (!response.ok) {
      const message =
        typeof json.error === "string" ? json.error : `The hub answered ${response.status}.`;
      const reason =
        response.status === 409
          ? "conflict"
          : response.status === 401
            ? "not-signed-in"
            : response.status === 404
              ? "not-found"
              : "invalid";
      throw new LibraryError(reason, message, json.checks ?? null);
    }
    return json;
  }

  /** What the person can publish: their own workflows and their customized copies. */
  async sources(input: unknown) {
    const companyId =
      typeof record(input).companyId === "string" ? (record(input).companyId as string) : null;
    const items = await this.deps.sources(companyId);
    return items
      .filter(
        ({ workflow }) =>
          workflow.source !== "builtin" &&
          (workflow.packId === null || workflow.customization !== undefined),
      )
      .map(({ workflow }) => ({
        workflowId: workflow.manifest.id,
        name: workflow.manifest.name,
        description: workflow.manifest.description,
        category: workflow.manifest.category,
        icon: workflow.manifest.icon,
        version: workflow.manifest.version,
        kind: workflow.customization === undefined ? ("own" as const) : ("customized" as const),
        companyId: workflow.customization?.companyId ?? null,
        scope: workflow.source,
      }));
  }

  async mine() {
    if (this.deps.token() === null || this.deps.hubUrl() === null)
      return { signedIn: false, packs: [], author: null, reviewer: false };
    return { signedIn: true, ...(await this.hub("GET", "/v1/library/me")) };
  }

  async report(input: unknown) {
    const value = record(input);
    const slug = text(value.slug, 100);
    const reason = text(value.reason, 40);
    if (slug === "" || !REPORT_REASONS.includes(reason))
      throw new LibraryError("invalid", "Choose why you report this pack.");
    return this.hub("POST", `/v1/library/packs/${encodeURIComponent(slug)}/report`, {
      reason,
      detail: text(value.detail, 2000),
    });
  }

  /** Packages one workflow folder, signs it with this device's key and sends it for review. */
  async publish(input: unknown) {
    const value = record(input);
    const workflowId = text(value.workflowId, 64);
    const companyId = typeof value.companyId === "string" ? value.companyId : null;
    const sources = await this.deps.sources(companyId);
    const found = sources.find(
      ({ workflow }) =>
        workflow.manifest.id === workflowId &&
        workflow.source !== "builtin" &&
        (workflow.packId === null || workflow.customization !== undefined),
    );
    if (found === undefined)
      throw new LibraryError(
        "not-found",
        "Only your own workflows and your customized packs can be published.",
      );
    const meta = record(value.meta);
    const title = text(meta.title, 80) || found.workflow.manifest.name;
    const libraryMeta: LibraryMeta = {
      title,
      description: text(meta.description, 600) || found.workflow.manifest.description,
      category: text(meta.category, 20) || found.workflow.manifest.category,
      icon: text(meta.icon, 40) || found.workflow.manifest.icon,
      licence: LICENCES.includes(text(meta.licence, 20)) ? text(meta.licence, 20) : "MIT",
      language: ["ro", "en", "ro+en"].includes(text(meta.language, 5))
        ? text(meta.language, 5)
        : "ro",
      changelog: text(meta.changelog, 2000),
      sampleOutput: text(meta.sampleOutput, 1000),
    };
    const reserved = await this.deps.reservedIds();
    const packId = text(value.packId, 64) || suggestPackId(title, reserved);
    if (reserved.has(packId))
      throw new LibraryError(
        "invalid",
        `The id ${packId} belongs to a Zen Staff pack; choose another one.`,
      );
    const version = text(value.version, 20) || "1.0.0";
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version))
      throw new LibraryError("invalid", "The version looks like 1.0.0.");
    const screenshots = (Array.isArray(value.screenshots) ? value.screenshots : [])
      .slice(0, 4)
      .map((item, index) => {
        const shot = record(item);
        return {
          name: text(shot.name, 80) || `imagine-${index + 1}`,
          mime: text(shot.mime, 20),
          data: text(shot.data, 1_000_000),
        };
      });
    const authorName = text(value.authorName, 80);
    const files = packageForLibrary(await readPackFolder(found.dir), {
      packId,
      version,
      ...(authorName === "" ? {} : { author: authorName }),
    });
    const userId = this.deps.userId();
    if (userId === null)
      throw new LibraryError(
        "not-signed-in",
        "Sign in to the hub (Team > Account) to publish to the library.",
      );
    if (authorName !== "") {
      await this.hub("PUT", "/v1/library/me/author", {
        displayName: authorName,
        company: text(value.authorCompany, 80) || null,
      });
    }
    const ts = this.now();
    const digest = submissionDigest({ packId, version, meta: libraryMeta, files, screenshots });
    const signature = await this.deps.sign(
      submissionStatementMessage({ packId, version, digest, by: userId, ts }),
    );
    try {
      const result = await this.hub(
        "POST",
        "/v1/library/submissions",
        { packId, version, meta: libraryMeta, files, screenshots, ts, signature },
        120_000,
      );
      return { ...result, packId, version, refused: false };
    } catch (error) {
      // The automatic checks refused it: an answer, not a failure, so the dialog lists the reasons.
      if (error instanceof LibraryError && Array.isArray(error.detail)) {
        return { refused: true, error: error.message, checks: error.detail, packId, version };
      }
      throw error;
    }
  }

  async call(op: string, input: unknown): Promise<unknown> {
    switch (op) {
      case "sources":
        return { sources: await this.sources(input) };
      case "mine":
        return this.mine();
      case "publish":
        return this.publish(input);
      case "report":
        return this.report(input);
      default:
        throw new LibraryError("invalid", "Unknown library call.");
    }
  }
}
