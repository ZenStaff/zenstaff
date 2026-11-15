// Zen Staff: the company's working folder, created when it is first needed (first run, a Birou card
// without a folder, "Dosar nou pentru <firmă>"): `~/Zen Staff/<Company>` (the machine says where),
// added as a folder and attached to the company, so a first task never meets "add a folder first".
// ZEN.md, "First run".
import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import { useContext } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { newProjectId } from "../../lib/utils";
import { readProjects, waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZenLocale } from "../i18n/zenI18n";
import { useOnboardingCall, type OnboardingGetResult } from "../onboarding/onboardingClient";
import { useIsInternalFolder } from "../office/useInternalFolders";
import { companyOfProject } from "./companiesModel";
import { folderTitleOf, nextFreeFolder } from "./companyFolderModel";

export { folderTitleOf, siblingFolder } from "./companyFolderModel";
import { companiesListAtom, companyAssignProject, useCompanyIndex } from "./companiesState";

/** The Office home's chosen folder (same key as OfficeHomePage), so Birou opens on it. */
export function rememberOfficeFolder(project: Pick<EnvironmentProject, "environmentId" | "id">) {
  try {
    globalThis.localStorage?.setItem(
      "zen:office:project",
      `${project.environmentId}:${project.id}`,
    );
  } catch {
    // Remembering the folder is a convenience only.
  }
}

/**
 * Returns `attach(path, companyId)`: the folder at `path` as a folder of the app (made when
 * `create` is set and it does not exist yet), attached to the company. Null when it fails.
 */
export function useAttachFolder(environmentId: EnvironmentId | null) {
  const registry = useContext(RegistryContext);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const assign = useAtomCommand(companyAssignProject, { reportFailure: false });
  return useStableCallback(
    async (
      path: string,
      companyId: string,
      options: { readonly create?: boolean } = {},
    ): Promise<EnvironmentProject | null> => {
      if (environmentId === null || path.trim() === "") return null;
      const here = readProjects().filter(
        (project) => project.environmentId === environmentId && project.archivedAt == null,
      );
      let project = findProjectByPath(here, path) ?? null;
      if (project === null) {
        const projectId = newProjectId();
        const created = await createProject({
          environmentId,
          input: {
            projectId,
            title: folderTitleOf(path),
            workspaceRoot: path,
            createWorkspaceRootIfMissing: options.create === true,
            defaultModelSelection: null,
          },
        });
        if (created._tag === "Failure") return null;
        project = await waitForProject(scopeProjectRef(environmentId, projectId)).catch(() => null);
        if (project === null) return null;
      }
      if (companyId !== ZEN_PERSONAL_COMPANY_ID) {
        await assign({ environmentId, input: { projectId: project.id, companyId } });
        registry.refresh(companiesListAtom(environmentId));
      }
      return project;
    },
  );
}

/** Where the company's own folder goes (`~/Zen Staff/<Company>`), as the machine says. */
export function useCompanyFolderPath(environmentId: EnvironmentId | null) {
  const onboarding = useOnboardingCall(environmentId);
  const locale = useZenLocale();
  return useStableCallback(async (companyId: string): Promise<string | null> => {
    const loaded = await onboarding<OnboardingGetResult>("get", { companyId, locale }).catch(
      () => null,
    );
    return loaded?.workFolder ?? null;
  });
}

/**
 * Returns `ensure(companyId)`: the company's first folder, or a new `~/Zen Staff/<Company>` folder
 * attached to it. Null when the machine is not connected or the folder could not be made.
 */
export function useEnsureCompanyFolder(environmentId: EnvironmentId | null) {
  const index = useCompanyIndex();
  const isInternal = useIsInternalFolder();
  const folderPath = useCompanyFolderPath(environmentId);
  const attach = useAttachFolder(environmentId);
  return useStableCallback(async (companyId: string): Promise<EnvironmentProject | null> => {
    if (environmentId === null) return null;
    const here = readProjects().filter(
      (project) => project.environmentId === environmentId && project.archivedAt == null,
    );
    const owned = here.find(
      (project) =>
        !isInternal(project) && companyOfProject(index, environmentId, project.id) === companyId,
    );
    if (owned) return owned;
    const path = await folderPath(companyId);
    if (path === null) return null;
    // A folder with the same name that another company already uses: "<name> (2)".
    const free = nextFreeFolder(path, (candidate) => {
      const found = findProjectByPath(here, candidate);
      return found !== undefined && companyOfProject(index, environmentId, found.id) !== companyId;
    });
    return attach(free, companyId, { create: true });
  });
}
