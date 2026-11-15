// Zen Staff chat-first task start: pure helpers for the intake dock (which buttons to show, the
// "Starting with" line, the repeat, the hiring profile the approval writes).
import {
  hireInstructionsText,
  parseHireSetupMarker,
  parseIntakeMarker,
  type HireProposal,
  type IntakeChipsView,
  type IntakeLocale,
  type IntakeScheduleRequest,
} from "@t3tools/contracts/zenIntake";
import type { ZenWorkflowManifest } from "@t3tools/contracts/zenOffice";
import type { StaffAgent, StaffDuty } from "@t3tools/contracts/zenStaff";

import type { WorkflowRepeat } from "../office/workflowSchedule";

/** Whether a thread's first message started an intake or a hiring setup. */
export function isIntakeThread(firstText: string | null | undefined): boolean {
  if (!firstText) return false;
  return parseIntakeMarker(firstText) !== null || parseHireSetupMarker(firstText) !== null;
}

/** Buttons show until the person writes (or speaks) after the question was asked. */
export function chipsVisible(
  chips: IntakeChipsView | null,
  latestUserMessageAtMs: number | null,
): chips is IntakeChipsView {
  if (chips === null || chips.options.length === 0) return false;
  return latestUserMessageAtMs === null || latestUserMessageAtMs < chips.askedAt;
}

/** "Label: value" pairs of the answers, in the workflow's order, short. */
export function startingWithItems(
  manifest: Pick<ZenWorkflowManifest, "inputs">,
  values: Readonly<Record<string, string>>,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  return manifest.inputs.flatMap((field) => {
    const value = values[field.id]?.trim();
    if (!value) return [];
    const label = field.label.replace(/[?:]\s*$/, "").trim();
    const short = value.replace(/\s+/g, " ");
    return [{ label, value: short.length > 80 ? `${short.slice(0, 77)}...` : short }];
  });
}

/** The agent's schedule request as the form's repeat. */
export function scheduleRepeat(request: IntakeScheduleRequest): WorkflowRepeat {
  return request.kind === "daily"
    ? { kind: "daily", time: request.time }
    : { kind: "weekly", time: request.time, weekday: request.weekday };
}

/** The profile the approval saves: the proposal written into the employee, active. */
export function applyHireProposal(
  agent: StaffAgent,
  proposal: HireProposal,
  locale: IntakeLocale,
): StaffAgent {
  const duties: StaffDuty[] = proposal.duties.map((duty, index) => {
    const existing = agent.duties.find((item) => item.title === duty.title);
    return {
      id: existing?.id ?? `duty-${agent.id}-setup-${index + 1}`,
      title: duty.title,
      prompt: duty.prompt,
      weekday: duty.weekday,
      time: duty.time,
      scheduledTaskId: existing?.scheduledTaskId ?? null,
    };
  });
  return {
    ...agent,
    ...(proposal.name ? { name: proposal.name } : {}),
    instructions: hireInstructionsText(proposal, locale),
    workflows: proposal.workflows.length > 0 ? [...proposal.workflows] : [...agent.workflows],
    connectors: [...proposal.connectors],
    duties,
    paused: false,
  };
}

/** A list before and after: what is added, removed and kept, for the summary. */
export function listChanges(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): ReadonlyArray<{ readonly kind: "added" | "removed" | "same"; readonly text: string }> {
  return [
    ...after.map((text) => ({
      kind: before.includes(text) ? ("same" as const) : ("added" as const),
      text,
    })),
    ...before
      .filter((text) => !after.includes(text))
      .map((text) => ({ kind: "removed" as const, text })),
  ];
}
