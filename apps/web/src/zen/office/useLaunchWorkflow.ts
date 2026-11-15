// Zen Staff: starts a workflow as a normal thread, through the same turn-start command (with a
// createThread bootstrap) the composer uses for a new thread.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { DEFAULT_PROVIDER_INTERACTION_MODE, type EnvironmentId } from "@t3tools/contracts";
import { buildWorkflowMessage, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import { scheduledTaskDefaultModel } from "../../components/settings/scheduledTasksSettings.logic";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { newMessageId, newThreadId } from "../../lib/utils";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { zenText } from "../i18n/zenI18n";
import { recordWorkflowRun } from "../navigation/myWorkflowsState";
import { errorInput, useTelemetryCall, workflowRunInput } from "../telemetry/telemetryClient";
import { officeText } from "./office.i18n";
import { workflowThreadTitle } from "./officeState";
import { workflowModelSelection } from "./officeWorkflowTools";

export function useLaunchWorkflow(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  // Anonymous statistics (counted only after the person said yes; the server decides).
  const telemetry = useTelemetryCall(environmentId);
  const count = (input: Record<string, unknown>) =>
    void telemetry("count", input).catch(() => null);

  /** Resolves to an error message, or null once the thread started and opened. */
  return async (input: {
    readonly workflow: ZenWorkflow;
    readonly project: EnvironmentProject;
    readonly values: Readonly<Record<string, string>>;
    /** The app's language; the agent is told to answer in it. */
    readonly locale: string;
    /** Zen toolchains: prepares the thread's tools; the appendix lists them for the agent. */
    readonly prepare?: (
      threadId: string,
    ) => Promise<{ readonly appendix: string } | { readonly error: string }>;
    /**
     * Chat-first start (zen/intake): the first message and title come from the server instead of
     * the filled form; the appendix is handed over so the workflow run gets it later.
     */
    readonly compose?: (
      threadId: string,
      appendix: string,
    ) => Promise<{ readonly text: string; readonly title: string } | { readonly error: string }>;
  }): Promise<string | null> => {
    const { workflow, project, values } = input;
    const t = zenText(officeText);
    const entries = providerInstanceEntriesFor(providers, settings, project.id);
    // A workflow may name its own model; otherwise (or when it is not available) the folder's.
    const modelSelection = workflowModelSelection(
      workflow.manifest.model,
      scheduledTaskDefaultModel(settings, project, entries),
      entries,
    );
    if (modelSelection === null) {
      return t.noAssistant;
    }
    const runtimeMode = resolveProjectSettings(settings, project.id, project).settings
      .defaultRuntimeMode;
    const threadId = newThreadId();
    const prepared = input.prepare ? await input.prepare(threadId) : { appendix: "" };
    if ("error" in prepared) {
      count(errorInput("workflow.prepare_failed"));
      return prepared.error;
    }
    const composed = input.compose ? await input.compose(threadId, prepared.appendix) : null;
    if (composed !== null && "error" in composed) return composed.error;
    const title = composed?.title ?? workflowThreadTitle(workflow.manifest, values);
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text:
            composed?.text ??
            buildWorkflowMessage(workflow, values, {
              locale: input.locale,
              summary: {
                title: workflow.manifest.name,
                answers: workflow.manifest.inputs.map((field) => ({
                  label: field.label,
                  value: values[field.id] ?? "",
                })),
              },
            }) + (prepared.appendix ? `\n\n${prepared.appendix}` : ""),
          attachments: [],
        },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      count(errorInput("workflow.start_failed"));
      const error = squashAtomCommandFailure(result);
      return error instanceof Error && error.message ? error.message : t.taskDidNotStart;
    }
    // The sidebar's "My workflows" lists the most used ones (ZEN.md, "Sidebar navigation").
    recordWorkflowRun(workflow.manifest.id);
    count(workflowRunInput(workflow));
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
    return null;
  };
}
