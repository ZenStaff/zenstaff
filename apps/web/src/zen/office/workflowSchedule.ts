// Zen Staff: "Repeat it" on a workflow form. Builds the scheduled task a workflow becomes: its
// prompt opens with the workflow marker, so scheduled runs get the workflow's tools and its
// declared commands without asking (ZEN.md, "Scheduled workflows"). Pure; tested in
// workflowSchedule.test.ts.
import type {
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@t3tools/contracts";
import { buildWorkflowMessage, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { zenScheduledWorkflowMarker } from "@t3tools/contracts/zenToolchains";

export type WorkflowRepeat =
  | { readonly kind: "daily"; readonly time: string }
  | { readonly kind: "weekly"; readonly time: string; readonly weekday: number };

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidRepeatTime(time: string): boolean {
  return TIME.test(time.trim());
}

/** The scheduled task for a workflow with these answers, run in `projectId`. */
export function workflowScheduleInput(input: {
  readonly workflow: Pick<ZenWorkflow, "manifest" | "prompt" | "skill">;
  readonly values: Readonly<Record<string, string>>;
  readonly locale: string;
  readonly title: string;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly repeat: WorkflowRepeat;
}): ScheduledTaskUpsertInput {
  const { workflow } = input;
  const message = buildWorkflowMessage(workflow, input.values, {
    locale: input.locale,
    summary: {
      title: workflow.manifest.name,
      answers: workflow.manifest.inputs.map((field) => ({
        label: field.label,
        value: input.values[field.id] ?? "",
      })),
    },
  });
  const timeOfDay = input.repeat.time.trim();
  return {
    title: input.title,
    prompt: `${zenScheduledWorkflowMarker(workflow.manifest.id)}\n\n${message}`,
    enabled: true,
    schedule:
      input.repeat.kind === "daily"
        ? { type: "fixed_time", timeOfDay }
        : { type: "fixed_time", timeOfDay, weekdays: [input.repeat.weekday] },
    projectId: input.projectId,
    threadId: null,
    threadMode: "new_thread",
    workspaceStrategy: { type: "root" },
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    creationSource: "web",
  } as ScheduledTaskUpsertInput;
}
