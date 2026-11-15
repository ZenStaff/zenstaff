import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_COMPANIES_WS_METHODS } from "@t3tools/contracts/zenCompanies";
import { Atom, AsyncResult } from "effect/reactivity";
import { create } from "zustand";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useConnectedEnvironmentIds } from "../../state/environments";
import {
  buildCompanyIndex,
  companySettledShelfScope,
  effectiveCompanyId,
  filterProjectGroupsByCompany,
  filterThreadsByCompany,
  type CompanyIndex,
} from "./companiesModel";

const companiesList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-companies:list",
  tag: ZEN_COMPANIES_WS_METHODS.list,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const companyMemoryList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-companies:list-memory",
  tag: ZEN_COMPANIES_WS_METHODS.listMemory,
  staleTimeMs: 10_000,
  idleTtlMs: 60_000,
});

export const companyCreate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-companies:create",
  tag: ZEN_COMPANIES_WS_METHODS.create,
});

export const companyUpdate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-companies:update",
  tag: ZEN_COMPANIES_WS_METHODS.update,
});

export const companyDelete = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-companies:delete",
  tag: ZEN_COMPANIES_WS_METHODS.delete,
});

export const companyAssignProject = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-companies:assign-project",
  tag: ZEN_COMPANIES_WS_METHODS.assignProject,
});

export const companyAssignThread = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-companies:assign-thread",
  tag: ZEN_COMPANIES_WS_METHODS.assignThread,
});

export const companyReadMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-companies:read-memory",
  tag: ZEN_COMPANIES_WS_METHODS.readMemory,
});

const LIST_INPUT = {} as const;

export const companiesListAtom = (environmentId: EnvironmentId) =>
  companiesList({ environmentId, input: LIST_INPUT });

/** Every connected environment's companies, keyed by the id list so atoms are reused. */
const companiesAcrossEnvironments = Atom.family((key: string) => {
  const ids = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get) =>
    ids.map((environmentId) => ({
      environmentId,
      data: AsyncResult.getOrElse(get(companiesListAtom(environmentId)), () => null),
    })),
  ).pipe(Atom.withLabel(`zen-companies:${key}`));
});

export function useCompanyIndex(): CompanyIndex {
  const environmentIds = useConnectedEnvironmentIds();
  const perEnvironment = useAtomValue(companiesAcrossEnvironments(JSON.stringify(environmentIds)));
  return buildCompanyIndex(perEnvironment);
}

// The chosen company is a per-device view preference, like the sidebar's project scope.
const SELECTED_COMPANY_KEY = "zen:selected-company:v1";

function readSelectedCompany(): string | null {
  try {
    return globalThis.localStorage?.getItem(SELECTED_COMPANY_KEY) ?? null;
  } catch {
    return null;
  }
}

export const useSelectedCompanyStore = create<{
  readonly selectedCompanyId: string | null;
  readonly setSelectedCompanyId: (companyId: string | null) => void;
}>((set) => ({
  selectedCompanyId: readSelectedCompany(),
  setSelectedCompanyId: (companyId) => {
    try {
      if (companyId === null) globalThis.localStorage?.removeItem(SELECTED_COMPANY_KEY);
      else globalThis.localStorage?.setItem(SELECTED_COMPANY_KEY, companyId);
    } catch {
      // Private windows can refuse storage; the choice still holds for this session.
    }
    set({ selectedCompanyId: companyId });
  },
}));

export function useActiveCompanyId(index: CompanyIndex): string | null {
  const selected = useSelectedCompanyStore((store) => store.selectedCompanyId);
  return effectiveCompanyId(selected, index);
}

/** Sidebar hook: thread shells of the selected company (all of them for "All companies"). */
export function useZenCompanyThreads<
  Thread extends {
    readonly environmentId: string;
    readonly id: string;
    readonly projectId: string;
  },
>(threads: ReadonlyArray<Thread>): ReadonlyArray<Thread> {
  const index = useCompanyIndex();
  const companyId = useActiveCompanyId(index);
  return filterThreadsByCompany(threads, companyId, index);
}

/** Sidebar hook: project groups with at least one project in the selected company. */
export function useZenCompanyProjectGroups<
  Group extends {
    readonly isScratch?: true | undefined;
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: string;
      readonly projectId: string;
    }>;
  },
>(groups: ReadonlyArray<Group>): ReadonlyArray<Group> {
  const index = useCompanyIndex();
  const companyId = useActiveCompanyId(index);
  return filterProjectGroupsByCompany(groups, companyId, index);
}

/** Sidebar hook: the Settled shelf's projects for the selected company (see the model). */
export function useZenCompanySettledShelfScope(
  groups: Parameters<typeof companySettledShelfScope>[0],
): ReturnType<typeof companySettledShelfScope> {
  const index = useCompanyIndex();
  const companyId = useActiveCompanyId(index);
  return companySettledShelfScope(groups, companyId, index);
}
