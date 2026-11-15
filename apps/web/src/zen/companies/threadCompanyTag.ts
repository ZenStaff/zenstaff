// Zen Staff: a "No project" chat started while a company is chosen belongs to that company.
// Called from upstream's useOrchestrationCommand (one line) for every orchestration command;
// only the commands that create a thread in a "No project" home do anything. See ZEN.md,
// "Companies (workspaces)".
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { companyTagForNewThread, threadCreatedByCommand } from "./companiesModel";

/**
 * Tags the thread a command creates with the company chosen in the switcher, on the thread's own
 * machine (a remote environment keeps its own tags). Never fails the command: on a server
 * without the tag RPC the chat simply stays in Personal, as before.
 */
export async function zenTagNewThreadCompany(
  commandLabel: string,
  value: { readonly environmentId: EnvironmentId; readonly input?: unknown },
): Promise<void> {
  const created = threadCreatedByCommand(commandLabel, value.input);
  if (created === null) return;
  // Loaded on first use: upstream's useOrchestrationCommand imports this file, and these modules
  // pull in the whole client (its tests mock only what that hook itself uses).
  const [{ readProject }, { companiesListAtom, companyAssignThread, useSelectedCompanyStore }] =
    await Promise.all([import("../../state/entities"), import("./companiesState")]);
  const project = readProject(scopeProjectRef(value.environmentId, created.projectId as ProjectId));
  const companyId = companyTagForNewThread({
    selectedCompanyId: useSelectedCompanyStore.getState().selectedCompanyId,
    projectIsScratch: project?.isScratch === true,
  });
  if (companyId === null) return;
  const result = await runAtomCommand(
    appAtomRegistry,
    companyAssignThread,
    {
      environmentId: value.environmentId,
      input: { threadId: created.threadId as ThreadId, companyId },
    },
    { label: companyAssignThread.label, reportFailure: false, reportDefect: false },
  );
  if (result._tag === "Success") appAtomRegistry.refresh(companiesListAtom(value.environmentId));
}
