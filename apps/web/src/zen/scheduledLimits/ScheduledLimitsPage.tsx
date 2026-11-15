import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZenGlobalLimits,
  ZenRunEvent,
  ZenScheduledLimitsOverview,
  ZenScheduledTaskUsage,
} from "@t3tools/contracts/zenScheduledLimits";
import { MonitorIcon, PencilIcon, PauseIcon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useContext, useState, type ReactNode } from "react";

import { isElectron } from "~/env";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";
import { RefreshIcon } from "../../components/ui/refresh-icon";
import { SidebarInset } from "../../components/ui/sidebar";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { useConnectedEnvironmentIds, useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { getZenLocale, useZenLocale, useZenText, type ZenLocale } from "../i18n/zenI18n";
import { zenErrorMessage } from "../i18n/serverText";
import { scheduledLimitsText, type ScheduledLimitsMessages } from "./scheduledLimits.i18n";
import {
  describeLimits,
  draftFromLimits,
  eventLabel,
  eventTone,
  formatDuration,
  formatTokens,
  limitText,
  limitsFromDraft,
  parseLimit,
  scheduledLimitsOverview,
  setScheduledGlobalLimits,
  setScheduledTaskLimits,
  type TaskLimitsDraft,
} from "./scheduledLimitsState";

const INPUT = {} as const;
const RECENT_SHOWN = 15;

const SCHEDULE_KEY: Record<string, keyof ScheduledLimitsMessages | undefined> = {
  interval: "scheduleInterval",
  fixed_time: "scheduleFixedTime",
  once: "scheduleOnce",
  webhook: "scheduleWebhook",
};

function scheduleLabel(t: ScheduledLimitsMessages, scheduleType: string): string {
  const key = SCHEDULE_KEY[scheduleType];
  const label = key === undefined ? undefined : t[key];
  return typeof label === "string" ? label : scheduleType;
}

const DATE_LOCALE: Record<ZenLocale, string> = { en: "en-US", ro: "ro-RO" };

function nextRunLabel(t: ScheduledLimitsMessages, iso: string | null): string {
  if (iso === null) return t.notScheduled;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t.notScheduled;
  return date.getTime() <= Date.now()
    ? t.dueNow
    : date.toLocaleString(DATE_LOCALE[getZenLocale()], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function ScheduledLimitsPage() {
  const t = useZenText(scheduledLimitsText);
  const registry = useContext(RegistryContext);
  const environmentIds = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const labelOf = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    t.machineFallback;
  const refresh = () => {
    for (const environmentId of environmentIds) {
      registry.refresh(scheduledLimitsOverview({ environmentId, input: INPUT }));
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel={t.breadcrumb}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{t.title}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          <Button size="icon-sm" variant="ghost" aria-label={t.refresh} onClick={refresh}>
            <RefreshIcon refreshing={false} />
          </Button>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide" className="gap-6">
            <p className="text-muted-foreground text-sm">{t.intro}</p>
            {environmentIds.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t.noMachineTitle}</EmptyTitle>
                  <EmptyDescription>{t.noMachineDescription}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {environmentIds.map((environmentId) => (
              <MachineLimits
                key={environmentId}
                environmentId={environmentId}
                label={labelOf(environmentId)}
                showMachine={environmentIds.length > 1}
              />
            ))}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function MachineLimits({
  environmentId,
  label,
  showMachine,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly showMachine: boolean;
}) {
  const t = useZenText(scheduledLimitsText);
  const result = useAtomValue(scheduledLimitsOverview({ environmentId, input: INPUT }));
  const registry = useContext(RegistryContext);
  const refresh = () => registry.refresh(scheduledLimitsOverview({ environmentId, input: INPUT }));
  const data = AsyncResult.getOrElse(result, () => null);
  return (
    <section className="flex flex-col gap-4" aria-label={t.limitsOn(label)}>
      {showMachine ? (
        <header className="flex items-baseline gap-2 border-b pb-1.5">
          <MonitorIcon aria-hidden className="size-4 self-center text-muted-foreground" />
          <h2 className="font-medium text-sm">{label}</h2>
        </header>
      ) : null}
      {result._tag === "Failure" ? (
        <p className="text-destructive-foreground text-sm">
          {zenErrorMessage(result.cause, t.loadFailed)}
        </p>
      ) : null}
      {data === null && result._tag !== "Failure" ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {data !== null ? (
        <>
          <GlobalLimits environmentId={environmentId} overview={data} onSaved={refresh} />
          <TaskList environmentId={environmentId} overview={data} onSaved={refresh} />
          <RecentActivity overview={data} />
        </>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="flex min-w-28 flex-col gap-0.5 rounded-lg border px-3 py-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-lg tabular-nums">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

function LimitField({
  id,
  label,
  value,
  placeholder,
  onChange,
  time = false,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  time?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-muted-foreground text-xs">
      {label}
      <Input
        id={id}
        size="sm"
        className="w-28"
        inputMode={time ? "text" : "numeric"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function GlobalLimits({
  environmentId,
  overview,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly overview: ZenScheduledLimitsOverview;
  readonly onSaved: () => void;
}) {
  const t = useZenText(scheduledLimitsText);
  const save = useAtomCommand(setScheduledGlobalLimits, { reportFailure: false });
  const { globals } = overview;
  const [cap, setCap] = useState(limitText(globals.maxRunsPerDay));
  const [concurrent, setConcurrent] = useState(limitText(globals.maxConcurrentRuns));
  const [duration, setDuration] = useState(limitText(globals.defaultMaxDurationMinutes));
  const [saving, setSaving] = useState(false);
  const dirty =
    cap !== limitText(globals.maxRunsPerDay) ||
    concurrent !== limitText(globals.maxConcurrentRuns) ||
    duration !== limitText(globals.defaultMaxDurationMinutes);

  const submit = async (next: ZenGlobalLimits, success: string) => {
    setSaving(true);
    const result = await save({ environmentId, input: { globals: next } });
    setSaving(false);
    if (result._tag === "Success") {
      onSaved();
      toastManager.add({ type: "success", title: success });
      return;
    }
    toastManager.add({
      type: "error",
      title: t.saveFailed,
      description: zenErrorMessage(result.cause, t.serverRefused),
    });
  };

  const onSave = () => {
    const parsedCap = parseLimit(cap, 10_000, t);
    const parsedConcurrent = parseLimit(concurrent, 100, t);
    const parsedDuration = parseLimit(duration, 24 * 60, t);
    if ("error" in parsedCap || "error" in parsedConcurrent || "error" in parsedDuration) {
      const description =
        "error" in parsedCap
          ? t.dailyCapError(parsedCap.error)
          : "error" in parsedConcurrent
            ? t.maxAtOnceError(parsedConcurrent.error)
            : t.defaultMaxMinutesError("error" in parsedDuration ? parsedDuration.error : "");
      toastManager.add({ type: "error", title: t.checkLimits, description });
      return;
    }
    void submit(
      {
        ...globals,
        maxRunsPerDay: parsedCap.value,
        maxConcurrentRuns: parsedConcurrent.value,
        defaultMaxDurationMinutes: parsedDuration.value,
      },
      t.globalSaved,
    );
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-medium text-sm">{t.allAgents}</h2>
          <p className="text-muted-foreground text-xs">
            {t.serverTime(overview.timeZone, overview.localDay)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={globals.pauseAll}
            disabled={saving}
            onCheckedChange={(checked) =>
              void submit({ ...globals, pauseAll: checked }, checked ? t.paused : t.resumed)
            }
          />
          {t.pauseAll}
        </label>
      </div>
      {globals.pauseAll ? (
        <p className="flex items-center gap-2 rounded-lg bg-warning/8 px-3 py-2 text-sm text-warning-foreground">
          <PauseIcon aria-hidden className="size-4" />
          {t.pausedNotice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Stat
          label={t.runsToday}
          value={
            globals.maxRunsPerDay === null
              ? overview.runsToday
              : `${overview.runsToday} / ${globals.maxRunsPerDay}`
          }
        />
        <Stat
          label={t.workingNow}
          value={
            globals.maxConcurrentRuns === null
              ? overview.activeRuns
              : `${overview.activeRuns} / ${globals.maxConcurrentRuns}`
          }
          hint={overview.queuedTasks > 0 ? t.queuedCount(overview.queuedTasks) : undefined}
        />
        <Stat label={t.skippedToday} value={overview.skipsToday} />
        <Stat
          label={t.tokensToday}
          value={formatTokens(overview.inputTokensToday + overview.outputTokensToday)}
          hint={t.tokensInOut(
            formatTokens(overview.inputTokensToday),
            formatTokens(overview.outputTokensToday),
          )}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <LimitField
          id={`${environmentId}-cap`}
          label={t.dailyCap}
          value={cap}
          placeholder={t.none}
          onChange={setCap}
        />
        <LimitField
          id={`${environmentId}-concurrent`}
          label={t.maxAtOnce}
          value={concurrent}
          placeholder={t.none}
          onChange={setConcurrent}
        />
        <LimitField
          id={`${environmentId}-duration`}
          label={t.defaultMaxMinutes}
          value={duration}
          placeholder={t.none}
          onChange={setDuration}
        />
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {t.save}
        </Button>
      </div>
    </div>
  );
}

function TaskList({
  environmentId,
  overview,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly overview: ZenScheduledLimitsOverview;
  readonly onSaved: () => void;
}) {
  const t = useZenText(scheduledLimitsText);
  if (overview.tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">{t.noTasks}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">{t.scheduledTasks}</h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {overview.tasks.map((task) => (
          <TaskRow key={task.taskId} environmentId={environmentId} task={task} onSaved={onSaved} />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({
  environmentId,
  task,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ZenScheduledTaskUsage;
  readonly onSaved: () => void;
}) {
  const t = useZenText(scheduledLimitsText);
  const [editing, setEditing] = useState(false);
  const tokens = task.inputTokensToday + task.outputTokensToday;
  return (
    <li className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium text-sm">{task.title}</span>
            <Badge variant="secondary" size="sm">
              {scheduleLabel(t, task.scheduleType)}
            </Badge>
            {!task.enabled ? (
              <Badge variant="outline" size="sm">
                {t.off}
              </Badge>
            ) : null}
            {task.queuedSince !== null ? (
              <Badge variant="info" size="sm">
                {t.queued}
              </Badge>
            ) : null}
            {task.activeRuns > 0 ? (
              <Badge variant="info" size="sm">
                {t.working}
              </Badge>
            ) : null}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
            <span>{describeLimits(task.limits, t)}</span>
            <span aria-hidden>·</span>
            <span>{t.runsTodayCount(task.runsToday, task.limits.maxRunsPerDay)}</span>
            {task.skipsToday > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span>{t.skippedCount(task.skipsToday)}</span>
              </>
            ) : null}
            {tokens > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span>{t.tokensCount(formatTokens(tokens))}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{t.next(task.enabled ? nextRunLabel(t, task.nextRunAt) : t.off)}</span>
          </span>
          <LastStatus task={task} />
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
          <PencilIcon />
          {editing ? t.close : t.limitsButton}
        </Button>
      </div>
      {editing ? (
        <TaskLimitsEditor
          environmentId={environmentId}
          task={task}
          onDone={() => {
            setEditing(false);
            onSaved();
          }}
        />
      ) : null}
    </li>
  );
}

function LastStatus({ task }: { readonly task: ZenScheduledTaskUsage }) {
  const t = useZenText(scheduledLimitsText);
  const locale = useZenLocale();
  const lines: Array<ReactNode> = [];
  if (task.lastRun !== null) {
    const run = task.lastRun;
    const duration = formatDuration(run.durationMs);
    lines.push(
      <span key="run" className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Badge variant={eventTone(run)} size="sm">
          {eventLabel(run, t)}
        </Badge>
        <span>{t.lastRun(formatZenRelativeTime(locale, run.at))}</span>
        {duration ? <span>· {duration}</span> : null}
        {run.reason ? <span>· {run.reason}</span> : null}
      </span>,
    );
  } else if (task.lastRunAt !== null) {
    lines.push(
      <span key="run">
        {t.lastRun(formatZenRelativeTime(locale, task.lastRunAt))} ({task.lastRunStatus})
      </span>,
    );
  }
  if (task.lastSkip !== null) {
    const skip = task.lastSkip;
    lines.push(
      <span key="skip" className="text-warning-foreground">
        {t.skippedAt(formatZenRelativeTime(locale, skip.at))}
        {skip.repeats > 0 ? ` (${t.timesCount(skip.repeats + 1)})` : ""}: {skip.reason}
      </span>,
    );
  }
  if (lines.length === 0) return null;
  return <div className="flex flex-col gap-0.5 text-muted-foreground text-xs">{lines}</div>;
}

function TaskLimitsEditor({
  environmentId,
  task,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ZenScheduledTaskUsage;
  readonly onDone: () => void;
}) {
  const t = useZenText(scheduledLimitsText);
  const save = useAtomCommand(setScheduledTaskLimits, { reportFailure: false });
  const [draft, setDraft] = useState<TaskLimitsDraft>(() => draftFromLimits(task.limits));
  const [saving, setSaving] = useState(false);
  const patch = (next: Partial<TaskLimitsDraft>) =>
    setDraft((current) => ({ ...current, ...next }));
  const id = (field: string) => `${environmentId}-${task.taskId}-${field}`;

  const onSave = async () => {
    const parsed = limitsFromDraft(draft, t);
    if ("error" in parsed) {
      toastManager.add({ type: "error", title: t.checkLimits, description: parsed.error });
      return;
    }
    setSaving(true);
    const result = await save({
      environmentId,
      input: { taskId: task.taskId, limits: parsed.limits },
    });
    setSaving(false);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: t.taskSaved(task.title) });
      onDone();
      return;
    }
    toastManager.add({
      type: "error",
      title: t.saveFailed,
      description: zenErrorMessage(result.cause, t.serverRefused),
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-3">
      <LimitField
        id={id("runs")}
        label={t.maxRunsPerDay}
        value={draft.maxRunsPerDay}
        placeholder={t.none}
        onChange={(value) => patch({ maxRunsPerDay: value })}
      />
      <LimitField
        id={id("duration")}
        label={t.maxMinutesPerRun}
        value={draft.maxDurationMinutes}
        placeholder={t.none}
        onChange={(value) => patch({ maxDurationMinutes: value })}
      />
      <LimitField
        id={id("quiet-start")}
        label={t.quietFrom}
        value={draft.quietStart}
        placeholder="22:00"
        onChange={(value) => patch({ quietStart: value })}
        time
      />
      <LimitField
        id={id("quiet-end")}
        label={t.quietUntil}
        value={draft.quietEnd}
        placeholder="07:00"
        onChange={(value) => patch({ quietEnd: value })}
        time
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void onSave()}>
          {t.save}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() =>
            setDraft({ maxRunsPerDay: "", maxDurationMinutes: "", quietStart: "", quietEnd: "" })
          }
        >
          {t.clear}
        </Button>
      </div>
    </div>
  );
}

function RecentActivity({ overview }: { readonly overview: ZenScheduledLimitsOverview }) {
  const t = useZenText(scheduledLimitsText);
  const locale = useZenLocale();
  if (overview.recent.length === 0) return null;
  const titleOf = (event: ZenRunEvent) =>
    overview.tasks.find((task) => task.taskId === event.taskId)?.title ?? t.deletedTask;
  const triggerOf = (event: ZenRunEvent) =>
    event.trigger === "manual" ? t.triggerManual : t.triggerWebhook;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">{t.recentActivity}</h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {overview.recent.slice(0, RECENT_SHOWN).map((event) => {
          const duration = formatDuration(event.durationMs);
          const tokens =
            event.inputTokens === null && event.outputTokens === null
              ? null
              : (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
          return (
            <li
              key={event.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-xs"
            >
              <Badge variant={eventTone(event)} size="sm">
                {eventLabel(event, t)}
              </Badge>
              <span className="font-medium text-sm">{titleOf(event)}</span>
              <span className="text-muted-foreground">
                {formatZenRelativeTime(locale, event.at)}
                {event.trigger === "scheduled" ? "" : ` · ${triggerOf(event)}`}
                {duration ? ` · ${duration}` : ""}
                {tokens !== null && tokens > 0 ? ` · ${t.tokensCount(formatTokens(tokens))}` : ""}
                {event.repeats > 0 ? ` · ${t.timesCount(event.repeats + 1)}` : ""}
              </span>
              {event.reason ? (
                <span className="basis-full text-muted-foreground">{event.reason}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
