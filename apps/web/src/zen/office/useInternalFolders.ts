// Zen Staff: internal folders are never offered as a place to work. A quick chat's own Scratch
// folder (`2026-11-07-https-www-reddit-com-r-5dfc959f`) is a project upstream, so every Zen folder
// picker (Birou, hiring, Academy, customizing, imports, copies, companies) filters with this.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { useEnvironments } from "../../state/environments";
import { isScratchThreadFolder } from "./officeState";

/** `(project) => true` for the Scratch project and for folders inside the Scratch root. */
export function useIsInternalFolder(): (project: EnvironmentProject) => boolean {
  const { environments } = useEnvironments();
  return (project) =>
    project.isScratch === true ||
    isScratchThreadFolder(
      project.workspaceRoot,
      environments.find((environment) => environment.environmentId === project.environmentId)
        ?.serverConfig?.scratchWorkspaceRoot ?? null,
    );
}
