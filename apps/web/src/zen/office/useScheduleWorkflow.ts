// Zen Staff: saves a workflow as a scheduled task (Settings > Scheduled tasks shows it), with the
// same model and permissions the workflow would start with now.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { scheduledTaskDefaultModel } from "../../components/settings/scheduledTasksSettings.logic";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { zenText } from "../i18n/zenI18n";
import { officeChatText } from "./officeChat.i18n";
import { workflowThreadTitle } from "./officeState";
import { workflowModelSelection } from "./officeWorkflowTools";
import { workflowScheduleInput, type WorkflowRepeat } from "./workflowSchedule";

export function useScheduleWorkflow(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: zenText(officeChatText).repeatIt,
    reportFailure: false,
  });

  /** Resolves to an error message, or null once the task is saved. */
  return async (input: {
    readonly workflow: ZenWorkflow;
    readonly project: EnvironmentProject;
    readonly values: Readonly<Record<string, string>>;
    readonly locale: string;
    readonly repeat: WorkflowRepeat;
  }): Promise<string | null> => {
    const t = zenText(officeChatText);
    const entries = providerInstanceEntriesFor(providers, settings, input.project.id);
    const modelSelection = workflowModelSelection(
      input.workflow.manifest.model,
      scheduledTaskDefaultModel(settings, input.project, entries),
      entries,
    );
    if (modelSelection === null) return t.repeatFailed;
    const runtimeMode = resolveProjectSettings(settings, input.project.id, input.project).settings
      .defaultRuntimeMode;
    const result = await upsert({
      environmentId: input.project.environmentId,
      input: workflowScheduleInput({
        workflow: input.workflow,
        values: input.values,
        locale: input.locale,
        title: workflowThreadTitle(input.workflow.manifest, input.values),
        projectId: input.project.id,
        modelSelection,
        runtimeMode,
        repeat: input.repeat,
      }),
    });
    return result._tag === "Success" ? null : t.repeatFailed;
  };
}
