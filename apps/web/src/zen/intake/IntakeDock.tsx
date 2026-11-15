// Zen Staff chat-first task start: what an intake chat shows above the composer (quick replies,
// "Pornesc cu … · Schimbă", the repeat it saves, the company choice of a hire made in Personal,
// the hiring profile to approve). There is no form anywhere. Rendered by ZenConnectDock (Zen file), so no upstream hook.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  hireInstructionsText,
  lineDiff,
  type HireProposal,
  type IntakeLocale,
  type IntakeThreadView,
} from "@t3tools/contracts/zenIntake";
import { localizeWorkflowManifest, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import type { StaffAgent } from "@t3tools/contracts/zenStaff";
import { AsyncResult } from "effect/reactivity";
import { CheckCircle2Icon, PlayIcon, RepeatIcon, UserCheckIcon } from "lucide-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { newMessageId } from "../../lib/utils";
import { useProjects, useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeChatText } from "../office/officeChat.i18n";
import { officeWorkflows, workflowsInput } from "../office/officeState";
import { useScheduleWorkflow } from "../office/useScheduleWorkflow";
import { describeRepeat } from "../office/WorkflowRepeatField";
import { useStaffCall, useStaffOverview } from "../staff/staffClient";
import { useStaffDefaults } from "../staff/staffShared";
import { HireCompanyChoice } from "./HireCompanyChoice";
import { intakeText } from "./intake.i18n";
import { intakeStateAtom, useIntakeCall, useIntakeState } from "./intakeClient";
import {
  applyHireProposal,
  chipsVisible,
  listChanges,
  scheduleRepeat,
  startingWithItems,
} from "./intakeState";

export function ZenIntakeDock(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly latestUserMessageAtMs: number | null;
}) {
  const state = useIntakeState(props.environmentId, props.threadId);
  const send = useSendToThread(props.environmentId, props.threadId);
  if (state === null) return null;
  return (
    <div className="flex flex-col gap-2" data-zen-intake-dock={state.kind}>
      <QuickReplies {...props} state={state} />
      {state.kind === "workflow" ? (
        <WorkflowCards environmentId={props.environmentId} state={state} />
      ) : (
        <>
          <HireCompanyChoice environmentId={props.environmentId} state={state} send={send} />
          <HireCard environmentId={props.environmentId} state={state} />
        </>
      )}
    </div>
  );
}

/** Sends a message into the thread, like the composer does for a follow-up. */
function useSendToThread(environmentId: EnvironmentId, threadId: string) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId as never));
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (text: string): Promise<boolean> => {
    const result = await startTurn({
      environmentId,
      input: {
        threadId: threadId as never,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        ...(shell?.runtimeMode ? { runtimeMode: shell.runtimeMode } : {}),
        interactionMode: shell?.interactionMode ?? "default",
        createdAt: new Date().toISOString(),
      } as never,
    });
    return result._tag === "Success";
  };
}

function QuickReplies(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly latestUserMessageAtMs: number | null;
  readonly state: IntakeThreadView;
}) {
  const t = useZenText(intakeText);
  const registry = useContext(RegistryContext);
  const call = useIntakeCall();
  const send = useSendToThread(props.environmentId, props.threadId);
  const [sending, setSending] = useState<string | null>(null);
  const chips = props.state.chips;
  if (!chipsVisible(chips, props.latestUserMessageAtMs)) return null;
  const choose = async (option: string) => {
    setSending(option);
    const sent = await send(option);
    setSending(null);
    if (!sent) {
      toastManager.add({ type: "error", title: t.sendFailed });
      return;
    }
    await call(props.environmentId, "chips.clear", { threadId: props.threadId }).catch(
      () => undefined,
    );
    registry.refresh(intakeStateAtom(props.environmentId, props.threadId));
  };
  return (
    <div
      role="group"
      aria-label={chips.question || t.quickReplies}
      className="flex flex-wrap gap-1.5"
      data-zen-intake-chips={chips.field ?? ""}
    >
      {chips.options.map((option) => (
        <Button
          key={option}
          size="sm"
          variant="outline"
          disabled={sending !== null}
          onClick={() => void choose(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

function useThreadWorkflow(
  environmentId: EnvironmentId,
  state: IntakeThreadView,
): ZenWorkflow | null {
  const result = useAtomValue(
    officeWorkflows({ environmentId, input: workflowsInput(state.companyId) }),
  );
  if (!AsyncResult.isSuccess(result)) return null;
  return result.value.workflows.find((item) => item.manifest.id === state.workflowId) ?? null;
}

function WorkflowCards(props: {
  readonly environmentId: EnvironmentId;
  readonly state: IntakeThreadView;
}) {
  const t = useZenText(intakeText);
  const c = useZenText(officeChatText);
  const locale = useZenLocale();
  const send = useSendToThread(props.environmentId, props.state.threadId);
  const registry = useContext(RegistryContext);
  const call = useIntakeCall();
  const schedule = useScheduleWorkflow(props.environmentId);
  const workflow = useThreadWorkflow(props.environmentId, props.state);
  const project =
    useProjects().find(
      (item) => item.environmentId === props.environmentId && item.id === props.state.projectId,
    ) ?? null;
  const scheduling = useRef(false);
  const { state } = props;
  const request = state.schedule;

  // The person said yes in the chat; the agent asked for the repeat; it is saved once, here.
  const saveSchedule = useEffectEvent(async () => {
    if (!workflow || !project || !state.launched || !request) return;
    const failure = await schedule({
      workflow,
      project,
      values: state.launched.values,
      locale,
      repeat: scheduleRepeat(request),
    });
    await call(props.environmentId, "schedule.result", {
      threadId: state.threadId,
      ok: failure === null,
      detail: failure,
    }).catch(() => undefined);
    registry.refresh(intakeStateAtom(props.environmentId, state.threadId));
  });
  const pending = request?.state === "pending" && workflow !== null && project !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves the scheduled task once, when the agent's intake_schedule request arrives.
  useEffect(() => {
    if (!pending || scheduling.current) return;
    scheduling.current = true;
    void saveSchedule();
  }, [pending]);

  if (workflow === null) return null;
  const manifest = localizeWorkflowManifest(workflow.manifest, locale);
  // Chat only: before the start nothing shows here; "Schimbă" asks the agent in the chat.
  if (state.launched === null) return null;
  const askChange = async () => {
    const sent = await send(t.changeRequest);
    if (!sent) toastManager.add({ type: "error", title: t.sendFailed });
  };
  const items = startingWithItems(manifest, state.launched.values);
  const folder = project ? `${project.title}/${state.launched.folder}` : state.launched.folder;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-sm"
        data-zen-intake-launched
      >
        <PlayIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-medium">{t.startingWith}: </span>
            {items.map((item) => `${item.label}: ${item.value}`).join(" · ")}
          </p>
          <p className="mt-0.5 text-muted-foreground text-xs">{t.savedIn(folder)}</p>
        </div>
        <Button size="xs" variant="ghost" onClick={() => void askChange()}>
          {t.change}
        </Button>
      </div>
      {request ? (
        <div
          className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm"
          data-zen-intake-schedule={request.state}
          role="status"
        >
          <RepeatIcon className="size-4 shrink-0 text-primary" aria-hidden />
          {request.state === "pending"
            ? t.scheduling
            : request.state === "saved"
              ? t.scheduled(describeRepeat(scheduleRepeat(request), c))
              : (request.detail ?? t.scheduleFailed)}
        </div>
      ) : null}
    </div>
  );
}

function HireCard(props: {
  readonly environmentId: EnvironmentId;
  readonly state: IntakeThreadView;
}) {
  const { state } = props;
  const companyId = state.companyId ?? "personal";
  const locale = useZenLocale();
  const overview = useStaffOverview(props.environmentId, companyId, locale);
  const agent = overview.data?.agents.find((item) => item.id === state.agentId) ?? null;
  if (state.proposal === null || agent === null) return null;
  return (
    <ProposalCard
      environmentId={props.environmentId}
      state={state}
      proposal={state.proposal}
      agent={agent}
      approvalsOn={overview.data?.settings.approvals === true}
      onSaved={overview.refresh}
    />
  );
}

function ProposalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly state: IntakeThreadView;
  readonly proposal: HireProposal;
  readonly agent: StaffAgent;
  readonly approvalsOn: boolean;
  readonly onSaved: () => void;
}) {
  const t = useZenText(intakeText);
  const locale = useZenLocale() as IntakeLocale;
  const registry = useContext(RegistryContext);
  const call = useIntakeCall();
  const staffCall = useStaffCall(props.environmentId, props.state.companyId ?? "personal");
  const defaultsFor = useStaffDefaults(props.environmentId);
  const send = useSendToThread(props.environmentId, props.state.threadId);
  const project =
    useProjects().find(
      (item) => item.environmentId === props.environmentId && item.id === props.state.projectId,
    ) ?? null;
  const [busy, setBusy] = useState(false);
  const { agent, proposal } = props;
  const workflowList = useAtomValue(
    officeWorkflows({
      environmentId: props.environmentId,
      input: workflowsInput(props.state.companyId),
    }),
  );
  const workflowName = (id: string) => {
    const found = AsyncResult.isSuccess(workflowList)
      ? workflowList.value.workflows.find((item) => item.manifest.id === id)
      : undefined;
    return found ? localizeWorkflowManifest(found.manifest, locale).name : id;
  };
  const next = applyHireProposal(agent, proposal, locale);
  const approved = props.state.proposalState === "approved";
  const instructions = lineDiff(agent.instructions, hireInstructionsText(proposal, locale));
  const dutyText = (duty: {
    readonly title: string;
    readonly weekday: number;
    readonly time: string;
  }) => `${duty.title} (${t.dutyAt(t.weekdaysMonFirst[duty.weekday - 1] ?? "", duty.time)})`;

  const approve = async () => {
    setBusy(true);
    const saved = await staffCall("agent.save", {
      agent: next,
      defaults: defaultsFor(project),
    }).then(
      () => true,
      (cause: unknown) => {
        toastManager.add({
          type: "error",
          title: t.approveFailed,
          description: cause instanceof Error ? cause.message : undefined,
        });
        return false;
      },
    );
    if (saved) {
      await call(props.environmentId, "hire.approved", { threadId: props.state.threadId }).catch(
        () => undefined,
      );
      registry.refresh(intakeStateAtom(props.environmentId, props.state.threadId));
      props.onSaved();
      toastManager.add({ type: "success", title: t.activated(agent.name) });
    }
    setBusy(false);
  };

  if (approved) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm"
        data-zen-hire-approved
        role="status"
      >
        <CheckCircle2Icon className="size-4 text-success" aria-hidden />
        {t.approvedNote}
      </div>
    );
  }
  return (
    <section
      className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-3 text-sm"
      aria-label={t.proposalTitle(agent.name)}
      data-zen-hire-proposal
    >
      <div className="flex items-start gap-2">
        <UserCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="font-medium">{t.proposalTitle(agent.name)}</p>
          <p className="text-muted-foreground text-xs">{t.proposalIntro}</p>
        </div>
      </div>
      <DiffBlock title={t.jobDescription} lines={instructions} />
      <ListBlock
        title={t.workflows}
        items={listChanges(agent.workflows.map(workflowName), next.workflows.map(workflowName))}
        empty={t.nothing}
      />
      <ListBlock
        title={t.connectors}
        items={listChanges(agent.connectors, next.connectors)}
        empty={t.nothing}
      />
      <ListBlock
        title={t.duties}
        items={listChanges(agent.duties.map(dutyText), next.duties.map(dutyText))}
        empty={t.nothing}
      />
      {props.approvalsOn ? (
        <p className="rounded-lg bg-warning/10 px-2 py-1.5 text-xs">{t.approvalsOn}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void send(t.keepTalking)}
        >
          {t.keepTalking}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void approve()} data-zen-hire-approve>
          {busy ? t.approving : t.approveActivate}
        </Button>
      </div>
    </section>
  );
}

function DiffBlock(props: {
  readonly title: string;
  readonly lines: ReadonlyArray<{
    readonly kind: "same" | "added" | "removed";
    readonly text: string;
  }>;
}) {
  const t = useZenText(intakeText);
  // Long unchanged runs fold into one line.
  const rows: Array<{ kind: "same" | "added" | "removed" | "fold"; text: string; key: string }> =
    [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 2) {
      rows.push({ kind: "same", text: run[0]!, key: `s${rows.length}` });
      rows.push({ kind: "fold", text: t.moreLines(run.length - 1), key: `f${rows.length}` });
    } else for (const text of run) rows.push({ kind: "same", text, key: `s${rows.length}` });
    run = [];
  };
  for (const line of props.lines) {
    if (line.kind === "same") run.push(line.text);
    else {
      flush();
      rows.push({ ...line, key: `${line.kind[0]}${rows.length}` });
    }
  }
  flush();
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-muted-foreground text-xs">{props.title}</p>
      <div className="rounded-lg bg-muted/40 p-2 font-mono text-xs leading-relaxed">
        {rows.map((row) => (
          <p
            key={row.key}
            className={
              row.kind === "added"
                ? "whitespace-pre-wrap text-success-foreground"
                : row.kind === "removed"
                  ? "whitespace-pre-wrap text-destructive-foreground line-through"
                  : row.kind === "fold"
                    ? "text-muted-foreground italic"
                    : "whitespace-pre-wrap text-muted-foreground"
            }
          >
            {row.kind === "added" ? "+ " : row.kind === "removed" ? "- " : "  "}
            {row.text}
          </p>
        ))}
      </div>
    </div>
  );
}

function ListBlock(props: {
  readonly title: string;
  readonly items: ReadonlyArray<{
    readonly kind: "same" | "added" | "removed";
    readonly text: string;
  }>;
  readonly empty: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-muted-foreground text-xs">{props.title}</p>
      {props.items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{props.empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {props.items.map((item) => (
            <li
              key={`${item.kind}:${item.text}`}
              className={`rounded-md px-1.5 py-0.5 text-xs ${
                item.kind === "added"
                  ? "bg-success/10 text-success-foreground"
                  : item.kind === "removed"
                    ? "bg-destructive/10 text-destructive-foreground line-through"
                    : "bg-muted"
              }`}
            >
              {item.kind === "added" ? "+ " : item.kind === "removed" ? "- " : ""}
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
