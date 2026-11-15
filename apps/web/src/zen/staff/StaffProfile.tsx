// Zen Staff AI staff: an AI employee's own page. Header with role, status, manager and account,
// "Dă-i o sarcină" as the one loud action, and five tabs: Sarcini, Instrucțiuni, Unelte, Program,
// Istoric. Editing opens the full profile form.
import type {
  StaffAgent,
  StaffAgentStatus,
  StaffHuman,
  StaffRoleTemplate,
} from "@t3tools/contracts/zenStaff";
import {
  AppWindowIcon,
  ArrowLeftIcon,
  BrainIcon,
  CalendarClockIcon,
  ClockIcon,
  EllipsisIcon,
  GaugeIcon,
  HistoryIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  TargetIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { EmptyState, SectionHeading, Stamp, Tag } from "../ui/Registru";
import { AgentProfileDialog } from "./AgentProfileDialog";
import { staffText } from "./staff.i18n";
import { staffHomeText } from "./staffHome.i18n";
import { StaffAgentAccountLine } from "./StaffAgentAccount";
import {
  canDeleteStaffAgent,
  canEditStaffAgent,
  canGiveStaffTask,
  PublishToCompanyButton,
  StaffHubBadge,
  StaffHubDetails,
  StaffTaskPermissionTooltip,
  useStaffHubAccess,
} from "./StaffHubControls";
import { describeDays, formatTokens, STAFF_PROFILE_TABS, type StaffProfileTab } from "./staffModel";
import {
  attempt,
  Avatar,
  formatWhen,
  StatusLabel,
  useOpenThread,
  type StaffContext,
} from "./staffShared";
import { RunRow, TaskDialog } from "./StaffTeam";

type AgentWithStatus = StaffAgent & { readonly status: StaffAgentStatus };

const TAB_ICONS = {
  tasks: ListChecksIcon,
  instructions: TargetIcon,
  tools: AppWindowIcon,
  schedule: CalendarClockIcon,
  history: HistoryIcon,
} as const;

/** "luni", "Monday": 1 = Monday ... 7 = Sunday (2 November 2026 is a Monday). */
function weekdayName(weekday: number, locale: string): string {
  return new Date(2026, 10, 1 + weekday).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", {
    weekday: "long",
  });
}

export function StaffProfilePage(props: {
  readonly context: StaffContext;
  readonly agent: AgentWithStatus;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly catalog: ReadonlyArray<StaffRoleTemplate>;
  readonly tab: StaffProfileTab;
  readonly onTab: (tab: StaffProfileTab) => void;
  readonly onBack: () => void;
}) {
  const t = useZenText(staffText);
  const h = useZenText(staffHomeText);
  const { context, agent } = props;
  const [editing, setEditing] = useState(false);
  const [tasking, setTasking] = useState(false);
  const manager = props.humans.find((human) => human.id === agent.managerId)?.name ?? null;
  const canEdit = canEditStaffAgent(context.overview, agent);
  const canDelete = canDeleteStaffAgent(context.overview, agent);
  // A company employee takes tasks only from a role with "Angajați AI: creează" (security-gaps).
  const access = useStaffHubAccess(context);
  const mayGiveTask = canGiveStaffTask(context.overview, agent, access);
  return (
    <div className="flex flex-col gap-8" data-staff-profile={agent.id}>
      <button
        type="button"
        className="zr-link flex w-fit items-center gap-1.5 text-sm"
        onClick={props.onBack}
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {h.backToTeam}
      </button>
      <header className="zr-card flex flex-wrap items-center gap-5 p-6">
        <Avatar name={agent.name} color={agent.color} agent className="size-16 text-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="zr-title text-3xl!">{agent.name}</h3>
            {agent.hub === undefined ? (
              <Tag>{t.kind[agent.kind]}</Tag>
            ) : (
              <StaffHubBadge agent={agent} />
            )}
          </div>
          <p className="zr-soft">{agent.role}</p>
          <div className="zr-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <StatusLabel status={agent.status} label={t.status[agent.status]} />
            <span>
              {h.managedBy}:{" "}
              <span className="font-medium text-zr-ink">{manager ?? h.noManager}</span>
            </span>
          </div>
          <StaffAgentAccountLine agent={agent} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <button type="button" className="zr-btn zr-btn-quiet" onClick={() => setEditing(true)}>
              <PencilIcon />
              {h.edit}
            </button>
          ) : null}
          <StaffTaskPermissionTooltip allowed={mayGiveTask}>
            <button
              type="button"
              className="zr-btn zr-btn-loud disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setTasking(true)}
              disabled={!mayGiveTask}
              data-staff-give-task
            >
              <MessageSquareIcon />
              {h.giveTask}
            </button>
          </StaffTaskPermissionTooltip>
          {canDelete ? (
            <Menu>
              <MenuTrigger
                render={<button type="button" className="zr-btn zr-btn-quiet" />}
                aria-label={h.more}
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  variant="destructive"
                  onClick={() => {
                    if (!globalThis.confirm(t.deleteAgentConfirm(agent.name))) return;
                    void attempt(() => context.call("agent.delete", { agentId: agent.id })).then(
                      () => {
                        context.refresh();
                        props.onBack();
                      },
                    );
                  }}
                >
                  {h.letGo}
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
        </div>
        <div className="w-full empty:hidden">
          <StaffHubDetails overview={context.overview} agent={agent} />
          <PublishToCompanyButton
            context={context}
            agent={agent}
            onDone={() => context.refresh()}
          />
        </div>
      </header>
      <nav className="zr-tabs" aria-label={agent.name}>
        {STAFF_PROFILE_TABS.map((item) => {
          const Icon = TAB_ICONS[item];
          return (
            <button
              key={item}
              type="button"
              className="zr-tab"
              aria-current={props.tab === item ? "page" : undefined}
              onClick={() => props.onTab(item)}
              data-staff-profile-tab={item}
            >
              <Icon className="size-4" aria-hidden />
              {h.profileTabs[item]}
            </button>
          );
        })}
      </nav>
      {props.tab === "tasks" ? (
        <TasksTab
          context={context}
          agent={agent}
          onGive={mayGiveTask ? () => setTasking(true) : null}
        />
      ) : props.tab === "instructions" ? (
        <InstructionsTab agent={agent} />
      ) : props.tab === "tools" ? (
        <ToolsTab agent={agent} />
      ) : props.tab === "schedule" ? (
        <ScheduleTab agent={agent} />
      ) : (
        <HistoryTab context={context} agent={agent} />
      )}
      {editing ? (
        <AgentProfileDialog
          context={context}
          draft={agent}
          catalog={props.catalog}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {tasking ? (
        <TaskDialog context={context} agent={agent} onClose={() => setTasking(false)} />
      ) : null}
    </div>
  );
}

function TasksTab(props: {
  readonly context: StaffContext;
  readonly agent: AgentWithStatus;
  /** Null when the person may not give this employee a task. */
  readonly onGive: (() => void) | null;
}) {
  const h = useZenText(staffHomeText);
  const openThread = useOpenThread(props.context.environmentId);
  const runs = props.context.overview.runs.filter((run) => run.agentId === props.agent.id);
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={ListChecksIcon}
        title={h.tasksEmpty}
        action={
          props.onGive ? (
            <button type="button" className="zr-btn zr-btn-loud" onClick={props.onGive}>
              <MessageSquareIcon />
              {h.giveTask}
            </button>
          ) : undefined
        }
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-staff-runs>
      {runs.slice(0, 20).map((run) => (
        <RunRow
          key={run.id}
          run={run}
          context={props.context}
          agent={props.agent}
          onOpen={() => openThread(run.threadId)}
        />
      ))}
    </ul>
  );
}

function Panel(props: {
  readonly title: string;
  readonly icon: typeof ClockIcon;
  readonly children: ReactNode;
}) {
  return (
    <section className="zr-card flex flex-col gap-3 p-5">
      <SectionHeading title={props.title} icon={props.icon} />
      {props.children}
    </section>
  );
}

function InstructionsTab(props: { readonly agent: AgentWithStatus }) {
  const h = useZenText(staffHomeText);
  const { agent } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="zr-card flex flex-col gap-3 p-6">
        <p className="zr-muted text-xs">{h.version(agent.instructionsVersion)}</p>
        <p className="whitespace-pre-wrap text-base leading-relaxed" data-staff-instructions>
          {agent.instructions}
        </p>
      </section>
      <Panel title={h.objectives} icon={TargetIcon}>
        {agent.objectives.length === 0 ? (
          <p className="zr-muted text-sm">{h.noObjectives}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {agent.objectives.map((objective) => (
              <li key={objective.id} className="flex items-baseline justify-between gap-3">
                <span>{objective.title}</span>
                <span className="zr-mono zr-muted">{objective.target}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ToolsTab(props: { readonly agent: AgentWithStatus }) {
  const h = useZenText(staffHomeText);
  const { agent } = props;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Panel title={h.workflows} icon={ListChecksIcon}>
        {agent.workflows.length === 0 ? (
          <p className="zr-muted text-sm">{h.noWorkflows}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.workflows.map((workflow) => (
              <Tag key={workflow}>{workflow}</Tag>
            ))}
          </div>
        )}
      </Panel>
      <Panel title={h.connectors} icon={AppWindowIcon}>
        {agent.connectors.length === 0 ? (
          <p className="zr-muted text-sm">{h.noConnectors}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.connectors.map((connector) => (
              <Tag key={connector}>{connector}</Tag>
            ))}
          </div>
        )}
      </Panel>
      <Panel title={h.memory} icon={BrainIcon}>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>{agent.memory.read ? h.memoryRead : h.memoryNoRead}</li>
          <li>{agent.memory.write ? h.memoryWrite : h.memoryNoWrite}</li>
        </ul>
      </Panel>
    </div>
  );
}

function ScheduleTab(props: { readonly agent: AgentWithStatus }) {
  const t = useZenText(staffText);
  const h = useZenText(staffHomeText);
  const locale = useZenLocale();
  const { agent } = props;
  const { limits } = agent;
  const limitLines = [
    limits.maxRunsPerDay !== null ? h.limitRuns(limits.maxRunsPerDay) : null,
    limits.maxMinutesPerRun !== null ? h.limitMinutes(limits.maxMinutesPerRun) : null,
    limits.monthlyTokenBudget !== null
      ? h.limitTokens(formatTokens(limits.monthlyTokenBudget, locale))
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Panel title={h.hours} icon={ClockIcon}>
        <p className="text-sm">
          {agent.workingHours
            ? h.hoursLine(
                describeDays(agent.workingHours.days, t.days),
                agent.workingHours.start,
                agent.workingHours.end,
              )
            : h.noHours}
        </p>
      </Panel>
      <Panel title={h.duties} icon={CalendarClockIcon}>
        {agent.duties.length === 0 ? (
          <p className="zr-muted text-sm">{h.noDuties}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {agent.duties.map((duty) => (
              <li key={duty.id} className="flex flex-col">
                <span className="font-medium">{duty.title}</span>
                <span className="zr-muted text-xs">
                  {h.dutyLine(weekdayName(duty.weekday, locale), duty.time)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={h.limits} icon={GaugeIcon}>
        {limitLines.length === 0 ? (
          <p className="zr-muted text-sm">{h.noLimits}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {limitLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function HistoryTab(props: { readonly context: StaffContext; readonly agent: AgentWithStatus }) {
  const t = useZenText(staffText);
  const h = useZenText(staffHomeText);
  const locale = useZenLocale();
  const { overview } = props.context;
  const approvals = overview.approvals.filter((approval) => approval.agentId === props.agent.id);
  const proposals = overview.proposals.filter((proposal) => proposal.agentId === props.agent.id);
  if (approvals.length === 0 && proposals.length === 0) {
    return <EmptyState icon={HistoryIcon} title={h.historyEmpty} />;
  }
  return (
    <div className="flex flex-col gap-8">
      {approvals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title={h.historyApprovals} />
          <ul className="flex flex-col gap-3">
            {approvals.map((approval) => (
              <li
                key={approval.id}
                className="zr-card relative flex flex-col gap-1 p-4 pr-32 text-sm"
              >
                <span className="font-semibold">
                  {t.action[approval.action]} · {approval.target}
                </span>
                <span className="zr-muted line-clamp-2">{approval.content}</span>
                <span className="zr-muted text-xs">{formatWhen(approval.createdAt, locale)}</span>
                <Stamp
                  quiet={approval.status !== "approved"}
                  className="absolute top-1/2 right-5 -translate-y-1/2"
                >
                  {approval.status === "approved"
                    ? h.stampApproved
                    : approval.status === "rejected"
                      ? h.stampRejected
                      : h.stampPending}
                </Stamp>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {proposals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title={h.historyProposals} />
          <ul className="flex flex-col gap-3">
            {proposals.map((proposal) => (
              <li key={proposal.id} className="zr-card flex flex-col gap-1 p-4 text-sm">
                <ul className="list-disc pl-5">
                  {proposal.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
                <span className="zr-muted text-xs">{formatWhen(proposal.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
