// @effect-diagnostics nodeBuiltinImport:off -- Pure, synchronous path math, also used by the adapter hook.
// Pure company store logic: no I/O, so it is tested directly. The service persists the state.
import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  ZEN_COMPANY_COLORS,
  ZEN_PERSONAL_COMPANY_ID,
  ZenCompaniesError,
  type ZenCompany,
  type ZenCompaniesListResult,
  type ZenCompanyCreateInput,
  type ZenCompanyUpdateInput,
} from "@t3tools/contracts/zenCompanies";
import * as NodePath from "node:path";

export const STORE_FILE_VERSION = 1;

export interface StoredCompany {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  /** User-chosen directory as typed (may start with `~/`); null uses the default. */
  readonly memoryDirectory: string | null;
  readonly createdAt: string;
}

export interface CompaniesState {
  readonly companies: ReadonlyArray<StoredCompany>;
  /** projectId -> companyId; the default company is never stored here. */
  readonly projects: Readonly<Record<string, string>>;
  /**
   * threadId -> companyId for threads started while a company was chosen, in a project no company
   * owns ("No project"). The company may exist only on another machine (the switcher merges them),
   * so the id is not checked against `companies`; Personal is never stored.
   */
  readonly threads: Readonly<Record<string, string>>;
}

/** Oldest thread tags are dropped past this, so the file cannot grow without bound. */
export const MAX_THREAD_TAGS = 20_000;

const COMPANY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface StorePaths {
  /** Zen home (server base dir); default memory lives in `<home>/companies/<id>/memory`. */
  readonly zenHome: string;
  /** The user's home, for `~/` paths. */
  readonly userHome: string;
}

const storeError = (reason: ZenCompaniesError["reason"], detail: string) =>
  new ZenCompaniesError({ reason, detail });

function personalCompany(createdAt: string): StoredCompany {
  return {
    id: ZEN_PERSONAL_COMPANY_ID,
    name: "Personal",
    color: "#475569",
    icon: "user",
    memoryDirectory: null,
    createdAt,
  };
}

export function emptyState(createdAt: string): CompaniesState {
  return { companies: [personalCompany(createdAt)], projects: {}, threads: {} };
}

/** Lowercase ASCII slug; diacritics folded (`Ăla Bălă` -> `ala-bala`). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length === 0 ? "company" : slug;
}

export function uniqueCompanyId(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function expandHome(value: string, userHome: string): string {
  if (value === "~") return userHome;
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return NodePath.join(userHome, value.slice(2));
  return value;
}

/** Trims; empty means "use the default". Relative paths are refused: they depend on the cwd. */
function normalizeMemoryDirectory(
  value: string | null | undefined,
  userHome: string,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return null;
  const expanded = expandHome(trimmed, userHome);
  if (!NodePath.isAbsolute(expanded)) {
    throw storeError(
      "invalid-input",
      "The memory directory must be an absolute path or start with ~/.",
    );
  }
  return NodePath.normalize(expanded);
}

function defaultMemoryDirectory(companyId: string, zenHome: string): string {
  return NodePath.join(zenHome, "companies", companyId, "memory");
}

/**
 * The directory Claude Code should use for a company, or null to leave Claude Code's own
 * setting alone. Personal has no default so projects nobody assigned keep their current memory.
 */
export function resolveCompanyMemoryDirectory(
  company: StoredCompany,
  paths: StorePaths,
): string | null {
  if (company.memoryDirectory !== null) return company.memoryDirectory;
  if (company.id === ZEN_PERSONAL_COMPANY_ID) return null;
  return defaultMemoryDirectory(company.id, paths.zenHome);
}

export function companyOfProject(state: CompaniesState, projectId: string): StoredCompany {
  const companyId = state.projects[projectId] ?? ZEN_PERSONAL_COMPANY_ID;
  return (
    state.companies.find((company) => company.id === companyId) ??
    state.companies.find((company) => company.id === ZEN_PERSONAL_COMPANY_ID) ??
    personalCompany("1970-01-01T00:00:00.000Z")
  );
}

export function memoryDirectoryForProject(
  state: CompaniesState,
  projectId: string,
  paths: StorePaths,
): string | null {
  return resolveCompanyMemoryDirectory(companyOfProject(state, projectId), paths);
}

function requireCompany(state: CompaniesState, id: string): StoredCompany {
  const company = state.companies.find((candidate) => candidate.id === id);
  if (company === undefined) throw storeError("not-found", "This company no longer exists.");
  return company;
}

export function createCompany(
  state: CompaniesState,
  input: ZenCompanyCreateInput,
  paths: StorePaths,
  createdAt: string,
): { state: CompaniesState; company: StoredCompany } {
  const name = input.name.trim();
  const taken = new Set(state.companies.map((company) => company.id));
  const company: StoredCompany = {
    id: uniqueCompanyId(name, taken),
    name,
    color: input.color ?? ZEN_COMPANY_COLORS[state.companies.length % ZEN_COMPANY_COLORS.length]!,
    icon: input.icon ?? "building",
    memoryDirectory: normalizeMemoryDirectory(input.memoryDirectory, paths.userHome),
    createdAt,
  };
  return { state: { ...state, companies: [...state.companies, company] }, company };
}

export function updateCompany(
  state: CompaniesState,
  input: ZenCompanyUpdateInput,
  paths: StorePaths,
): { state: CompaniesState; company: StoredCompany } {
  const current = requireCompany(state, input.id);
  const company: StoredCompany = {
    ...current,
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.memoryDirectory === undefined
      ? {}
      : { memoryDirectory: normalizeMemoryDirectory(input.memoryDirectory, paths.userHome) }),
  };
  return {
    state: {
      ...state,
      companies: state.companies.map((candidate) =>
        candidate.id === company.id ? company : candidate,
      ),
    },
    company,
  };
}

/** Projects of a deleted company return to Personal. Memory files are left on disk. */
export function deleteCompany(
  state: CompaniesState,
  id: string,
): { state: CompaniesState; reassignedProjectCount: number } {
  if (id === ZEN_PERSONAL_COMPANY_ID) {
    throw storeError("default-company", "The Personal company cannot be deleted.");
  }
  requireCompany(state, id);
  const projects: Record<string, string> = {};
  let reassignedProjectCount = 0;
  for (const [projectId, companyId] of Object.entries(state.projects)) {
    if (companyId === id) reassignedProjectCount += 1;
    else projects[projectId] = companyId;
  }
  const threads: Record<string, string> = {};
  for (const [threadId, companyId] of Object.entries(state.threads)) {
    if (companyId !== id) threads[threadId] = companyId;
  }
  return {
    state: {
      companies: state.companies.filter((company) => company.id !== id),
      projects,
      threads,
    },
    reassignedProjectCount,
  };
}

export function assignProject(
  state: CompaniesState,
  projectId: string,
  companyId: string,
): CompaniesState {
  requireCompany(state, companyId);
  const projects = { ...state.projects };
  if (companyId === ZEN_PERSONAL_COMPANY_ID) delete projects[projectId];
  else projects[projectId] = companyId;
  return { ...state, projects };
}

/** Tags a thread with a company; Personal removes the tag. Newest tags are kept past the cap. */
export function assignThread(
  state: CompaniesState,
  threadId: string,
  companyId: string,
): CompaniesState {
  if (!COMPANY_ID_PATTERN.test(companyId)) {
    throw storeError("invalid-input", "This company id is not valid.");
  }
  const threads: Record<string, string> = { ...state.threads };
  delete threads[threadId];
  if (companyId !== ZEN_PERSONAL_COMPANY_ID) threads[threadId] = companyId;
  return { ...state, threads: capThreadTags(threads) };
}

function capThreadTags(threads: Record<string, string>): Record<string, string> {
  const entries = Object.entries(threads);
  if (entries.length <= MAX_THREAD_TAGS) return threads;
  return Object.fromEntries(entries.slice(entries.length - MAX_THREAD_TAGS));
}

/** Repairs a loaded file: Personal always exists, unknown company references are dropped. */
export function normalizeState(
  state: Omit<CompaniesState, "threads"> & {
    readonly threads?: CompaniesState["threads"] | undefined;
  },
  createdAt: string,
): CompaniesState {
  const seen = new Set<string>();
  const companies: StoredCompany[] = [];
  for (const company of state.companies) {
    if (seen.has(company.id)) continue;
    seen.add(company.id);
    companies.push(company);
  }
  if (!seen.has(ZEN_PERSONAL_COMPANY_ID)) {
    companies.unshift(personalCompany(createdAt));
    seen.add(ZEN_PERSONAL_COMPANY_ID);
  }
  const projects: Record<string, string> = {};
  for (const [projectId, companyId] of Object.entries(state.projects)) {
    if (seen.has(companyId) && companyId !== ZEN_PERSONAL_COMPANY_ID)
      projects[projectId] = companyId;
  }
  const threads: Record<string, string> = {};
  for (const [threadId, companyId] of Object.entries(state.threads ?? {})) {
    if (companyId !== ZEN_PERSONAL_COMPANY_ID && COMPANY_ID_PATTERN.test(companyId))
      threads[threadId] = companyId;
  }
  return { companies, projects, threads: capThreadTags(threads) };
}

export function toCompany(company: StoredCompany, paths: StorePaths): ZenCompany {
  return {
    id: company.id,
    name: company.name,
    color: company.color,
    icon: company.icon,
    memoryDirectory: resolveCompanyMemoryDirectory(company, paths),
    customMemoryDirectory: company.memoryDirectory,
    isDefault: company.id === ZEN_PERSONAL_COMPANY_ID,
    createdAt: company.createdAt,
  };
}

export function toListResult(state: CompaniesState, paths: StorePaths): ZenCompaniesListResult {
  return {
    companies: state.companies.map((company) => toCompany(company, paths)),
    projectCompanies: Object.entries(state.projects).map(([projectId, companyId]) => ({
      projectId: ProjectId.make(projectId),
      companyId,
    })),
    threadCompanies: Object.entries(state.threads).map(([threadId, companyId]) => ({
      threadId: ThreadId.make(threadId),
      companyId,
    })),
    defaultCompanyId: ZEN_PERSONAL_COMPANY_ID,
  };
}

const MARKDOWN_FILE = /\.(md|markdown)$/i;

/**
 * Resolves a memory file path the client sent; null when it leaves the directory or is not
 * markdown. The service also compares real paths, so a symlink cannot point outside.
 */
export function resolveMemoryFilePath(directory: string, relativePath: string): string | null {
  if (!MARKDOWN_FILE.test(relativePath)) return null;
  if (relativePath.includes("\0")) return null;
  const target = NodePath.resolve(directory, relativePath);
  const relative = NodePath.relative(directory, target);
  if (relative.length === 0 || relative.startsWith("..") || NodePath.isAbsolute(relative)) {
    return null;
  }
  return target;
}

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_FILE.test(name);
}
