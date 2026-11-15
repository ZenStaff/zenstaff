// Zen Staff Academy: "Try it". Prepares the practice folder when the lesson has one (and adds it
// as a project), then starts a normal thread through the same turn-start command the composer
// uses: an Office workflow with example answers, a prompt, or an audit command (`/security-audit
// ...` when the agent has that command or skill, else the lesson's full fallback prompt).
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { DEFAULT_PROVIDER_INTERACTION_MODE, type EnvironmentId } from "@t3tools/contracts";
import {
  auditMessage,
  localized,
  type ZenAcademyLocale,
  type ZenAcademyTryIt,
  type ZenLesson,
} from "@t3tools/contracts/zenAcademy";
import { buildWorkflowMessage, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import { scheduledTaskDefaultModel } from "../../components/settings/scheduledTasksSettings.logic";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { newMessageId, newProjectId, newThreadId } from "../../lib/utils";
import { providerInstanceEntriesFor, type ProviderInstanceEntry } from "../../providerInstances";
import { readProjects, waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { prepareAcademyExercise } from "./academyState";
import type { AcademyStrings } from "./academy.i18n";

/** Commands and skills the chosen agent can run, as names without the slash. */
function availableAgentCommands(entry: ProviderInstanceEntry | undefined): string[] {
  if (!entry) return [];
  return [
    ...entry.snapshot.slashCommands.map((command) => command.name),
    ...entry.snapshot.skills.map((skill) => skill.name),
  ];
}

/** The message a prompt or audit Try it sends. Workflows are built from their template. */
function tryItMessage(
  tryIt: Exclude<ZenAcademyTryIt, { kind: "open" | "workflow" }>,
  commands: ReadonlyArray<string>,
  locale: ZenAcademyLocale,
): { readonly text: string; readonly usedCommand: boolean } {
  if (tryIt.kind === "prompt")
    return { text: localized(tryIt.prompt, locale).trim(), usedCommand: false };
  return auditMessage(tryIt, commands, locale);
}

export type TryItTarget =
  | { readonly kind: "practice" }
  | { readonly kind: "project"; readonly project: EnvironmentProject };

export function useAcademyTryIt(environmentId: EnvironmentId, strings: AcademyStrings) {
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const prepare = useAtomCommand(prepareAcademyExercise, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  /** The practice folder as a project (created on first use). */
  const practiceProject = async (
    lesson: ZenLesson,
    companyId: string | null,
    locale: ZenAcademyLocale,
  ): Promise<EnvironmentProject | string> => {
    const prepared = await prepare({
      environmentId,
      input: { lessonId: lesson.manifest.id, companyId },
    });
    if (prepared._tag === "Failure") {
      const error = squashAtomCommandFailure(prepared);
      return error instanceof Error && error.message ? error.message : strings.startFailed;
    }
    const path = prepared.value.path;
    const existing = findProjectByPath(
      readProjects().filter((project) => project.environmentId === environmentId),
      path,
    );
    if (existing) return existing;
    const projectId = newProjectId();
    const created = await createProject({
      environmentId,
      input: {
        projectId,
        title: `${locale === "ro" ? "Academie" : "Academy"}: ${localized(lesson.manifest.title, locale)}`,
        workspaceRoot: path,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (created._tag === "Failure") {
      const error = squashAtomCommandFailure(created);
      return error instanceof Error && error.message ? error.message : strings.startFailed;
    }
    return waitForProject(scopeProjectRef(environmentId, projectId));
  };

  /** What an audit or prompt would send in `project`, for the dialog's preview. */
  const preview = (
    tryIt: Exclude<ZenAcademyTryIt, { kind: "open" | "workflow" }>,
    project: EnvironmentProject | null,
    locale: ZenAcademyLocale,
  ) => {
    const entries = providerInstanceEntriesFor(providers, settings, project?.id ?? null);
    const model = scheduledTaskDefaultModel(settings, project, entries);
    const entry = entries.find((candidate) => candidate.instanceId === model?.instanceId);
    return tryItMessage(tryIt, availableAgentCommands(entry), locale);
  };

  /** Resolves to an error message, or null once the thread started and opened. */
  const run = async (input: {
    readonly lesson: ZenLesson;
    readonly target: TryItTarget;
    readonly locale: ZenAcademyLocale;
    readonly companyId: string | null;
    readonly workflows: ReadonlyArray<ZenWorkflow>;
  }): Promise<string | null> => {
    const { lesson, locale } = input;
    const tryIt = lesson.manifest.tryIt;
    if (!tryIt) return null;
    if (tryIt.kind === "open") {
      await navigate({ to: tryIt.to });
      return null;
    }
    const project =
      input.target.kind === "practice"
        ? await practiceProject(lesson, input.companyId, locale)
        : input.target.project;
    if (typeof project === "string") return project;

    const entries = providerInstanceEntriesFor(providers, settings, project.id);
    const modelSelection = scheduledTaskDefaultModel(settings, project, entries);
    if (modelSelection === null) return strings.noAgent;
    const entry = entries.find((candidate) => candidate.instanceId === modelSelection.instanceId);

    let text: string;
    if (tryIt.kind === "workflow") {
      const workflow = input.workflows.find(
        (candidate) => candidate.manifest.id === tryIt.workflow,
      );
      if (!workflow) return strings.workflowMissing(tryIt.workflow);
      const values = tryIt.values?.[locale] ?? tryIt.values?.en ?? tryIt.values?.ro ?? {};
      text = buildWorkflowMessage(workflow, values);
    } else {
      text = tryItMessage(tryIt, availableAgentCommands(entry), locale).text;
    }

    const runtimeMode = resolveProjectSettings(settings, project.id, project).settings
      .defaultRuntimeMode;
    const threadId = newThreadId();
    const title =
      `${locale === "ro" ? "Academie" : "Academy"}: ${localized(lesson.manifest.title, locale)}`.slice(
        0,
        80,
      );
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
      return error instanceof Error && error.message ? error.message : strings.startFailed;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
    return null;
  };

  return { run, preview };
}
