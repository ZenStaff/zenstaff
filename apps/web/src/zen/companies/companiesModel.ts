// Pure company logic for the web app: merging companies across environments and filtering the
// sidebar by the selected company. Tested in companiesModel.test.ts.
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_PERSONAL_COMPANY_ID,
  type ZenCompaniesListResult,
  type ZenCompany,
} from "@t3tools/contracts/zenCompanies";

export interface EnvironmentCompanies {
  readonly environmentId: EnvironmentId;
  readonly data: ZenCompaniesListResult | null;
}

export interface CompanyIndex {
  /** Companies across environments, one per id, Personal first. */
  readonly companies: ReadonlyArray<ZenCompany>;
  /** `${environmentId}:${projectId}` -> company id, for explicit assignments only. */
  readonly projectCompany: ReadonlyMap<string, string>;
  /**
   * `${environmentId}:${threadId}` -> company id: threads started while a company was chosen,
   * in a project no company owns (the "No project" home). See `companyOfThread`.
   */
  readonly threadCompany: ReadonlyMap<string, string>;
  /** Whether every environment answered, so a missing selection can be cleared safely. */
  readonly ready: boolean;
}

const projectCompanyKey = (environmentId: string, projectId: string) =>
  `${environmentId}:${projectId}`;
const threadCompanyKey = projectCompanyKey;

/** Environments keep their own companies; the same id on two machines is one company. */
export function buildCompanyIndex(
  perEnvironment: ReadonlyArray<EnvironmentCompanies>,
): CompanyIndex {
  const companies = new Map<string, ZenCompany>();
  const projectCompany = new Map<string, string>();
  const threadCompany = new Map<string, string>();
  for (const { environmentId, data } of perEnvironment) {
    if (data === null) continue;
    for (const company of data.companies) {
      if (!companies.has(company.id)) companies.set(company.id, company);
    }
    for (const assignment of data.projectCompanies) {
      projectCompany.set(
        projectCompanyKey(environmentId, assignment.projectId),
        assignment.companyId,
      );
    }
    for (const tag of data.threadCompanies ?? []) {
      threadCompany.set(threadCompanyKey(environmentId, tag.threadId), tag.companyId);
    }
  }
  const ordered = [...companies.values()].toSorted((left, right) =>
    left.isDefault !== right.isDefault
      ? left.isDefault
        ? -1
        : 1
      : left.name.localeCompare(right.name),
  );
  return {
    companies: ordered,
    projectCompany,
    threadCompany,
    ready: perEnvironment.every(({ data }) => data !== null),
  };
}

export function companyOfProject(
  index: Pick<CompanyIndex, "projectCompany">,
  environmentId: string,
  projectId: string,
): string {
  return (
    index.projectCompany.get(projectCompanyKey(environmentId, projectId)) ?? ZEN_PERSONAL_COMPANY_ID
  );
}

/**
 * A thread's company: its assigned project's company, else its tag (a "No project" chat started
 * under a company), else Personal. A tag of a company no machine knows falls back. ZEN.md.
 */
export function companyOfThread(
  index: Pick<CompanyIndex, "projectCompany" | "threadCompany" | "companies" | "ready">,
  thread: { readonly environmentId: string; readonly id: string; readonly projectId: string },
): string {
  const ofProject = index.projectCompany.get(
    projectCompanyKey(thread.environmentId, thread.projectId),
  );
  if (ofProject !== undefined) return ofProject;
  const tagged = index.threadCompany.get(threadCompanyKey(thread.environmentId, thread.id));
  if (
    tagged !== undefined &&
    (!index.ready || index.companies.some((company) => company.id === tagged))
  ) {
    return tagged;
  }
  return ZEN_PERSONAL_COMPANY_ID;
}

/** The selection to apply: null (all companies) when the chosen company no longer exists. */
export function effectiveCompanyId(
  selected: string | null,
  index: Pick<CompanyIndex, "companies" | "ready">,
): string | null {
  if (selected === null) return null;
  if (index.companies.some((company) => company.id === selected)) return selected;
  // Until every environment answers, keep the choice so the list does not flash unfiltered.
  return index.ready ? null : selected;
}

export function filterThreadsByCompany<
  Thread extends {
    readonly environmentId: string;
    readonly id: string;
    readonly projectId: string;
  },
>(
  threads: ReadonlyArray<Thread>,
  companyId: string | null,
  index: CompanyIndex,
): ReadonlyArray<Thread> {
  if (companyId === null) return threads;
  return threads.filter((thread) => companyOfThread(index, thread) === companyId);
}

/**
 * The company to tag a thread with when it is created, or null for none: only a thread started
 * in a "No project" home while a company other than Personal is chosen. A thread in a real
 * project follows that project's company instead.
 */
export function companyTagForNewThread(input: {
  readonly selectedCompanyId: string | null;
  readonly projectIsScratch: boolean;
}): string | null {
  const { selectedCompanyId } = input;
  if (!input.projectIsScratch) return null;
  if (selectedCompanyId === null || selectedCompanyId === ZEN_PERSONAL_COMPANY_ID) return null;
  return selectedCompanyId;
}

/** Labels of the two orchestration commands that create a thread (client-runtime threadCommands). */
export const THREAD_CREATE_COMMAND_LABEL = "environment-data:commands:thread:create";
export const THREAD_START_TURN_COMMAND_LABEL = "environment-data:commands:thread:start-turn";

/**
 * The thread a command creates: `thread.create` (`{ threadId, projectId }`), or a turn start
 * with a `createThread` bootstrap (a new chat's first message). Anything else creates none.
 */
export function threadCreatedByCommand(
  commandLabel: string,
  input: unknown,
): { readonly threadId: string; readonly projectId: string } | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as {
    readonly threadId?: unknown;
    readonly projectId?: unknown;
    readonly bootstrap?: { readonly createThread?: { readonly projectId?: unknown } };
  };
  if (typeof record.threadId !== "string") return null;
  const projectId =
    commandLabel === THREAD_CREATE_COMMAND_LABEL
      ? record.projectId
      : commandLabel === THREAD_START_TURN_COMMAND_LABEL
        ? record.bootstrap?.createThread?.projectId
        : undefined;
  return typeof projectId === "string" ? { threadId: record.threadId, projectId } : null;
}

/**
 * A grouped project stays when any of its members (checkouts, machines) is in the company. The
 * "No project" home stays in every company: it holds each company's own No project chats (the
 * thread filter picks them), and folder mode needs it to list them.
 */
export function filterProjectGroupsByCompany<
  Group extends {
    readonly isScratch?: true | undefined;
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: string;
      readonly projectId: string;
    }>;
  },
>(
  groups: ReadonlyArray<Group>,
  companyId: string | null,
  index: CompanyIndex,
): ReadonlyArray<Group> {
  if (companyId === null) return groups;
  return groups.filter(
    (group) =>
      group.isScratch === true ||
      group.memberProjectRefs.some(
        (ref) => companyOfProject(index, ref.environmentId, ref.projectId) === companyId,
      ),
  );
}

/**
 * The projects the Settled shelf reads older threads from for the selected company, as
 * `${environmentId}:${projectId}` keys (null: every project). The server counts older threads per
 * project, so a "No project" home, shared by every company, is read but left out of the count
 * for a company other than Personal: its count is mostly Personal's chats.
 */
export function companySettledShelfScope(
  groups: ReadonlyArray<{
    readonly isScratch?: true | undefined;
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: string;
      readonly projectId: string;
    }>;
  }>,
  companyId: string | null,
  index: CompanyIndex,
): { readonly projectKeys: ReadonlySet<string> | null; readonly uncounted: ReadonlySet<string> } {
  const uncounted = new Set<string>();
  if (companyId === null) return { projectKeys: null, uncounted };
  const projectKeys = new Set<string>();
  for (const group of groups) {
    for (const ref of group.memberProjectRefs) {
      const key = projectCompanyKey(ref.environmentId, ref.projectId);
      if (group.isScratch === true) {
        projectKeys.add(key);
        if (companyId !== ZEN_PERSONAL_COMPANY_ID) uncounted.add(key);
      } else if (companyOfProject(index, ref.environmentId, ref.projectId) === companyId) {
        projectKeys.add(key);
      }
    }
  }
  return { projectKeys, uncounted };
}

/** Company the members of a grouped project share, or null when they differ. */
export function sharedCompanyOf(
  members: ReadonlyArray<{ readonly environmentId: string; readonly id: string }>,
  index: Pick<CompanyIndex, "projectCompany">,
): string | null {
  const ids = new Set(
    members.map((member) => companyOfProject(index, member.environmentId, member.id)),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
