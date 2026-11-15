// Zen Staff chat-first hiring: starts a normal Office thread in a folder with a first message the
// server wrote (the setup chat of a new AI employee), through the composer's own turn-start
// command, like useLaunchWorkflow, then opens it.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { DEFAULT_PROVIDER_INTERACTION_MODE, type EnvironmentId } from "@t3tools/contracts";
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
import { officeText } from "../office/office.i18n";

export function useStartChat(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  /** Resolves to an error message, or null once the thread started and opened. */
  return async (input: {
    readonly project: EnvironmentProject;
    readonly compose: (
      threadId: string,
    ) => Promise<{ readonly text: string; readonly title: string } | { readonly error: string }>;
  }): Promise<string | null> => {
    const t = zenText(officeText);
    const entries = providerInstanceEntriesFor(providers, settings, input.project.id);
    const modelSelection = scheduledTaskDefaultModel(settings, input.project, entries);
    if (modelSelection === null) return t.noAssistant;
    const runtimeMode = resolveProjectSettings(settings, input.project.id, input.project).settings
      .defaultRuntimeMode;
    const threadId = newThreadId();
    const composed = await input.compose(threadId);
    if ("error" in composed) return composed.error;
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: composed.text, attachments: [] },
        modelSelection,
        titleSeed: composed.title,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: input.project.id,
            title: composed.title,
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
      const error = squashAtomCommandFailure(result);
      return error instanceof Error && error.message ? error.message : t.taskDidNotStart;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
    return null;
  };
}
