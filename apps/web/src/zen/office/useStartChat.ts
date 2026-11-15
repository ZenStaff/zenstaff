// Zen Staff Birou: "Ask anything" starts a normal thread in the chosen folder with the person's own
// words as the first message, through the same turn-start command (with a createThread bootstrap)
// the composer uses for a new thread, then opens it.
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
import { officeText } from "./office.i18n";
import { askTitle } from "./officeHome.logic";

export function useStartChat(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  /** Resolves to an error message, or null once the thread started and opened. */
  return async (input: {
    readonly project: EnvironmentProject;
    readonly text: string;
  }): Promise<string | null> => {
    const t = zenText(officeText);
    const { project } = input;
    const text = input.text.trim();
    if (!text) return null;
    const entries = providerInstanceEntriesFor(providers, settings, project.id);
    const modelSelection = scheduledTaskDefaultModel(settings, project, entries);
    if (modelSelection === null) return t.noAssistant;
    const runtimeMode = resolveProjectSettings(settings, project.id, project).settings
      .defaultRuntimeMode;
    const threadId = newThreadId();
    const title = askTitle(text);
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
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
      const error = squashAtomCommandFailure(result);
      return error instanceof Error && error.message ? error.message : t.noAssistant;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
    return null;
  };
}
