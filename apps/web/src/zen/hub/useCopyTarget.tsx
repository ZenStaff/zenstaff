// Zen Staff hub: where "Continue on my side" and "Take it over" land: one of your projects, with
// that project's default model and runtime mode on THIS machine (your own AI account), chosen the
// same way the Office edition starts a thread.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { scheduledTaskDefaultModel } from "../../components/settings/scheduledTasksSettings.logic";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useZenText } from "../i18n/zenI18n";
import { hubText } from "./hub.i18n";
import { useIsInternalFolder } from "../office/useInternalFolders";
import { ZenNativeSelect } from "../ui/ZenSelect";

export function useCopyTarget(environmentId: EnvironmentId) {
  const t = useZenText(hubText);
  const projects = useProjects();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const isInternal = useIsInternalFolder();
  const own = projects.filter(
    (project) => project.environmentId === environmentId && !isInternal(project),
  );
  const [projectId, setProjectId] = useState<string>("");
  const project = own.find((candidate) => candidate.id === projectId) ?? own[0] ?? null;

  const selection = (() => {
    if (project === null) return null;
    const entries = providerInstanceEntriesFor(providers, settings, project.id);
    const modelSelection = scheduledTaskDefaultModel(settings, project, entries);
    if (modelSelection === null) return null;
    const runtimeMode = resolveProjectSettings(settings, project.id, project).settings
      .defaultRuntimeMode;
    return { projectId: project.id, modelSelection, runtimeMode };
  })();

  const picker = (
    <ZenNativeSelect
      aria-label={t.continueInProject}
      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
      value={project?.id ?? ""}
      onChange={(event) => setProjectId(event.target.value)}
    >
      {own.map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.title}
        </option>
      ))}
    </ZenNativeSelect>
  );

  const openThread = (navigate: ReturnType<typeof useNavigate>, threadId: string) =>
    navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, ThreadId.make(threadId))),
    });

  return { picker, selection, openThread, hasProjects: own.length > 0 };
}
