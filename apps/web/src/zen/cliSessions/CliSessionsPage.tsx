import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZenCliSession,
  ZenCliSessionOrigin,
  ZenCliSessionsListInput,
  ZenCliSessionsListResult,
} from "@t3tools/contracts/zenCliSessions";
import {
  CopyIcon,
  MonitorIcon,
  PlayIcon,
  SearchIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useContext, useState } from "react";

import { isElectron } from "~/env";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
import { RefreshIcon } from "../../components/ui/refresh-icon";
import { SidebarInset } from "../../components/ui/sidebar";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useConnectedEnvironmentIds, useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { cliSessionsText } from "./cliSessions.i18n";
import {
  cliSessionResume,
  cliSessionsAcrossEnvironments,
  cliSessionsKey,
  cliSessionsList,
  folderName,
  groupByProject,
  resumeCommand,
} from "./cliSessionsState";

type Scope = "terminal" | "all";

interface SelectedSession {
  readonly environmentId: EnvironmentId;
  readonly provider: ZenCliSession["provider"];
  readonly sessionId: string;
}

const selectionKey = (session: SelectedSession) =>
  `${session.environmentId}\u0000${session.provider}\u0000${session.sessionId}`;

const ORIGIN_KEY = {
  terminal: "originTerminal",
  app: "originApp",
  other: "originOther",
} as const satisfies Record<ZenCliSessionOrigin, keyof typeof cliSessionsText.en>;

function errorMessage(cause: Cause.Cause<unknown>, fallback: string): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export function CliSessionsPage() {
  const t = useZenText(cliSessionsText);
  const registry = useContext(RegistryContext);
  const environmentIds = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("terminal");
  const [includeOwned, setIncludeOwned] = useState(false);
  const [debouncedQuery] = useDebouncedValue(query.trim(), { wait: 250 });

  const input: ZenCliSessionsListInput = {
    ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
    ...(scope === "terminal" ? { origins: ["terminal"] } : {}),
    ...(includeOwned ? { includeOwned: true } : {}),
  };
  const results = useAtomValue(
    cliSessionsAcrossEnvironments(cliSessionsKey(environmentIds, input)),
  );
  const labelOf = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    t.machineFallback;
  const refreshing = results.some(({ result }) => result.waiting);
  const resume = useAtomCommand(cliSessionResume, { reportFailure: false });
  const [selected, setSelected] = useState<ReadonlyMap<string, SelectedSession>>(new Map());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  // Sessions an import can still pick up (not already a thread here).
  const importable = results.flatMap(({ environmentId, result }) =>
    (AsyncResult.getOrElse(result, () => null)?.sessions ?? [])
      .filter((session) => session.threadId === null)
      .map((session) => ({
        environmentId,
        provider: session.provider,
        sessionId: session.sessionId,
      })),
  );
  const toggle = (session: SelectedSession, checked: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(selectionKey(session), session);
      else next.delete(selectionKey(session));
      return next;
    });
  const importSelected = async () => {
    const sessions = [...selected.values()];
    let imported = 0;
    let failed = 0;
    setBulk({ done: 0, total: sessions.length });
    // One at a time: each import reads a whole transcript on its machine.
    for (const session of sessions) {
      const result = await resume({
        environmentId: session.environmentId,
        input: { provider: session.provider, sessionId: session.sessionId, history: "full" },
      });
      if (result._tag === "Success") imported += 1;
      else failed += 1;
      setBulk((current) => (current === null ? null : { ...current, done: current.done + 1 }));
    }
    setBulk(null);
    setSelected(new Map());
    toastManager.add({
      type: failed > 0 ? "warning" : "success",
      title: t.bulkDone(imported, failed),
    });
    refresh();
  };
  const refresh = () => {
    for (const environmentId of environmentIds) {
      registry.refresh(cliSessionsList({ environmentId, input }));
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
            <RefreshIcon refreshing={refreshing} />
          </Button>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide" className="gap-4">
            <p className="text-muted-foreground text-sm">{t.intro}</p>
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="min-w-0 flex-1 basis-64">
                <InputGroupAddon>
                  <SearchIcon
                    aria-hidden
                    className={
                      refreshing && debouncedQuery.length > 0 ? "animate-pulse" : undefined
                    }
                  />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label={t.searchLabel}
                  placeholder={t.searchPlaceholder}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </InputGroup>
              <ToggleGroup
                aria-label={t.sourceLabel}
                variant="segmented"
                value={[scope]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "terminal" || value === "all") setScope(value);
                }}
              >
                <Toggle value="terminal">{t.originTerminal}</Toggle>
                <Toggle value="all">{t.allClients}</Toggle>
              </ToggleGroup>
              <label className="flex items-center gap-2 text-muted-foreground text-sm">
                <Switch
                  checked={includeOwned}
                  onCheckedChange={(checked) => setIncludeOwned(checked)}
                />
                {t.alreadyInThreads}
              </label>
            </div>
            {importable.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2"
                data-zen-cli-bulk
              >
                <span className="min-w-0 flex-1 basis-64 text-muted-foreground text-xs">
                  {t.bulkHint}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected(
                      new Map(importable.map((session) => [selectionKey(session), session])),
                    )
                  }
                >
                  {t.selectAllShown}
                </Button>
                {selected.size > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
                    {t.clearSelection}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={selected.size === 0 || bulk !== null}
                  onClick={() => void importSelected()}
                >
                  {bulk !== null ? <Spinner /> : <PlayIcon />}
                  {bulk !== null
                    ? t.bulkProgress(bulk.done, bulk.total)
                    : t.importSelected(selected.size)}
                </Button>
              </div>
            ) : null}
            {environmentIds.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t.noMachineTitle}</EmptyTitle>
                  <EmptyDescription>{t.noMachineDescription}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {results.map(({ environmentId, result }) => (
              <MachineSection
                key={environmentId}
                environmentId={environmentId}
                label={labelOf(environmentId)}
                result={result}
                searching={debouncedQuery.length > 0}
                onResumed={refresh}
                selected={selected}
                onToggle={toggle}
              />
            ))}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function MachineSection({
  environmentId,
  label,
  result,
  searching,
  onResumed,
  selected,
  onToggle,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly result: AsyncResult.AsyncResult<ZenCliSessionsListResult, unknown>;
  readonly searching: boolean;
  readonly onResumed: () => void;
  readonly selected: ReadonlyMap<string, SelectedSession>;
  readonly onToggle: (session: SelectedSession, checked: boolean) => void;
}) {
  const t = useZenText(cliSessionsText);
  const data = AsyncResult.getOrElse(result, () => null);
  const groups = data === null ? [] : groupByProject(data.sessions);
  return (
    <section className="flex flex-col gap-3" aria-label={t.sessionsOn(label)}>
      <header className="flex items-baseline gap-2 border-b pb-1.5">
        <MonitorIcon aria-hidden className="size-4 self-center text-muted-foreground" />
        <h2 className="font-medium text-sm">{label}</h2>
        {data !== null ? (
          <span className="text-muted-foreground text-xs">
            {data.matchedCount > data.sessions.length
              ? t.shownOf(data.sessions.length, data.matchedCount)
              : data.matchedCount}{" "}
            {searching ? t.matchesNoun(data.matchedCount) : t.sessionsNoun(data.matchedCount)}
          </span>
        ) : null}
      </header>
      {result._tag === "Failure" ? (
        <p className="text-destructive-foreground text-sm">
          {errorMessage(result.cause, t.loadFailed)}
        </p>
      ) : null}
      {data === null && result._tag !== "Failure" ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}
      {data !== null && data.sessions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{searching ? t.noMatch : t.noSessions}</p>
      ) : null}
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-2 px-1">
            <span className="shrink-0 font-medium text-xs">
              {folderName(group.cwd, t.unknownFolder)}
            </span>
            <span className="truncate text-muted-foreground text-xs">{group.cwd}</span>
          </div>
          <ul className="flex flex-col divide-y rounded-lg border">
            {group.sessions.map((session) => (
              <SessionRow
                key={`${session.provider}:${session.sessionId}`}
                environmentId={environmentId}
                machine={label}
                session={session}
                onResumed={onResumed}
                selected={selected.has(
                  selectionKey({
                    environmentId,
                    provider: session.provider,
                    sessionId: session.sessionId,
                  }),
                )}
                onToggle={(checked) =>
                  onToggle(
                    { environmentId, provider: session.provider, sessionId: session.sessionId },
                    checked,
                  )
                }
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SessionRow({
  environmentId,
  machine,
  session,
  onResumed,
  selected,
  onToggle,
}: {
  readonly environmentId: EnvironmentId;
  readonly machine: string;
  readonly session: ZenCliSession;
  readonly onResumed: () => void;
  readonly selected: boolean;
  readonly onToggle: (checked: boolean) => void;
}) {
  const t = useZenText(cliSessionsText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const resume = useAtomCommand(cliSessionResume, { reportFailure: false });
  const [resuming, setResuming] = useState(false);

  const openThread = async (threadId: string) => {
    await navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
  };
  const onResume = async () => {
    if (session.threadId !== null) {
      await openThread(session.threadId);
      return;
    }
    setResuming(true);
    const result = await resume({
      environmentId,
      input: { provider: session.provider, sessionId: session.sessionId, history: "full" },
    });
    setResuming(false);
    if (result._tag === "Success") {
      if (result.value.importedItems !== undefined) {
        toastManager.add({ type: "success", title: t.importedItems(result.value.importedItems) });
      }
      onResumed();
      await openThread(result.value.threadId);
      return;
    }
    toastManager.add({
      type: "error",
      title: t.resumeFailed,
      description: errorMessage(result.cause, t.loadFailed),
    });
  };
  const onCopy = () => {
    const command = resumeCommand(session);
    void writeTextToClipboard(command, t.commandClipboardName).then((copied) => {
      if (copied)
        toastManager.add({ type: "success", title: t.commandCopied, description: command });
    });
  };

  return (
    <li className="flex min-w-0 items-start gap-3 px-3 py-2.5">
      {session.threadId === null ? (
        <Checkbox
          className="mt-0.5"
          aria-label={t.selectSession(session.title)}
          checked={selected}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-sm">{session.title}</span>
        {session.snippet ? (
          <span className="line-clamp-2 text-muted-foreground text-xs">{session.snippet}</span>
        ) : null}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
          <span>{folderName(session.cwd, t.unknownFolder)}</span>
          <span aria-hidden>·</span>
          <span>{machine}</span>
          {session.gitBranch ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{session.gitBranch}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <time dateTime={session.lastActivityAt}>
            {formatZenRelativeTime(locale, session.lastActivityAt)}
          </time>
          <span aria-hidden>·</span>
          <span>{t.messageCount(session.messageCount)}</span>
          <Badge variant="secondary" size="sm">
            {session.provider === "codex" ? "Codex" : "Claude"} · {t[ORIGIN_KEY[session.origin]]}
          </Badge>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="icon-sm" variant="ghost" aria-label={t.copyCommand} onClick={onCopy}>
                <CopyIcon />
              </Button>
            }
          />
          <TooltipPopup side="top">{t.copyCommand}</TooltipPopup>
        </Tooltip>
        <Button size="sm" variant="outline" disabled={resuming} onClick={() => void onResume()}>
          {session.threadId !== null ? <SquareArrowOutUpRightIcon /> : <PlayIcon />}
          {session.threadId !== null ? t.openThread : resuming ? t.resuming : t.resume}
        </Button>
      </div>
    </li>
  );
}
