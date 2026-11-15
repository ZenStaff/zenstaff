// Zen Staff: the company page's "Memorie" tab. Search, Decisions and Promises (open, overdue,
// done) from the company's hosted memory, each with its sources (opening the chat when it is on
// this machine), and the admin-only "Forget this" (GDPR erasure) behind a confirmation.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import type { ZenCompany } from "@t3tools/contracts/zenCompanies";
import type {
  ZenMemoryEntity,
  ZenMemoryFact,
  ZenMemoryListResult,
  ZenMemorySettings,
} from "@t3tools/contracts/zenMemory";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ExternalLinkIcon,
  SearchIcon,
  ShieldAlertIcon,
  UserIcon,
} from "lucide-react";
import { useContext, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { zenErrorMessage } from "../i18n/serverText";
import { memoryText } from "./memory.i18n";
import {
  FactOriginBadges,
  ForgetPersonSection,
  MemoryReview,
  PendingRules,
  PersonalMemoryPanel,
} from "./MemoryV4";
import { memoryV4Text } from "./memoryV4.i18n";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import {
  formatMemoryDate,
  forgettableEntity,
  groupPromises,
  isOverdue,
  localToday,
  PROMISE_GROUPS,
  sourceLinks,
  type PromiseGroup,
} from "./memoryModel";
import {
  memoryDecisions,
  memoryDecisionsPage,
  memoryForget,
  memoryPromises,
  memoryPromisesPage,
  memorySearch,
  memorySettings,
} from "./memoryState";

export function CompanyMemoryTab({
  environmentId,
  company,
  companies,
  onOpenSettings,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
  readonly companies?: ReadonlyArray<ZenCompany>;
  readonly onOpenSettings: () => void;
}) {
  const v4 = useZenText(memoryV4Text);
  const [view, setView] = useState<"company" | "mine">("company");
  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        variant="outline"
        size="sm"
        value={[view]}
        onValueChange={(next) => {
          if (next[0] === "company" || next[0] === "mine") setView(next[0]);
        }}
      >
        <Toggle value="company">{v4.tabCompany}</Toggle>
        <Toggle value="mine">{v4.tabMine}</Toggle>
      </ToggleGroup>
      {view === "mine" ? (
        <PersonalMemoryPanel environmentId={environmentId} companies={companies ?? [company]} />
      ) : (
        <CompanyMemoryView
          environmentId={environmentId}
          company={company}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
}

function CompanyMemoryView({
  environmentId,
  company,
  onOpenSettings,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
  readonly onOpenSettings: () => void;
}) {
  const t = useZenText(memoryText);
  const result = useAtomValue(memorySettings({ environmentId, input: { companyId: company.id } }));
  const settings = AsyncResult.getOrElse(result, () => null);
  if (settings === null) {
    return result._tag === "Failure" ? (
      <p className="text-destructive-foreground text-sm">
        {zenErrorMessage(result.cause, t.loadFailed)}
      </p>
    ) : (
      <Skeleton className="h-24 w-full" />
    );
  }
  if (!settings.available) {
    return <p className="text-muted-foreground text-sm">{t.personalNote}</p>;
  }
  if (!settings.connected) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.notConnectedTitle}</EmptyTitle>
          <EmptyDescription>{t.notConnectedBody}</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" variant="outline" onClick={onOpenSettings}>
          {t.openSettings}
        </Button>
      </Empty>
    );
  }
  return (
    <ConnectedMemory
      key={company.id}
      environmentId={environmentId}
      company={company}
      settings={settings}
    />
  );
}

function useLocalThreads(): ReadonlyMap<string, string> {
  const shells = useThreadShells();
  return new Map(shells.map((shell) => [String(shell.id), String(shell.environmentId)]));
}

type ListKind = "decisions" | "promises";

/**
 * The first page comes from a query atom (refreshed after a forget); "Load more" appends the
 * following pages, kept per first page so a refresh starts the list over.
 */
function usePagedList(
  kind: ListKind,
  environmentId: EnvironmentId,
  companyId: string,
  includeSuperseded: boolean,
) {
  const t = useZenText(memoryText);
  const registry = useContext(RegistryContext);
  const input =
    kind === "decisions" ? { companyId, includeSuperseded } : { companyId, status: "all" as const };
  const atom =
    kind === "decisions"
      ? memoryDecisionsPage({ environmentId, input })
      : memoryPromisesPage({ environmentId, input });
  const result = useAtomValue(atom);
  const first = AsyncResult.getOrElse(result, () => null);
  const load = useAtomCommand(kind === "decisions" ? memoryDecisions : memoryPromises, {
    reportFailure: false,
  });
  const [more, setMore] = useState<{
    readonly first: ZenMemoryListResult;
    readonly items: ReadonlyArray<ZenMemoryFact>;
    readonly nextCursor: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const extra = more !== null && more.first === first ? more : null;
  const items = first === null ? null : [...first.items, ...(extra?.items ?? [])];
  const nextCursor = extra !== null ? extra.nextCursor : (first?.nextCursor ?? null);
  const error =
    first === null && result._tag === "Failure"
      ? zenErrorMessage(result.cause, t.loadFailed)
      : null;

  const loadMore = async () => {
    if (first === null || nextCursor === null) return;
    setBusy(true);
    const response = await load({ environmentId, input: { ...input, cursor: nextCursor } });
    setBusy(false);
    if (response._tag !== "Success") {
      toastManager.add({ type: "error", title: zenErrorMessage(response.cause, t.loadFailed) });
      return;
    }
    setMore({
      first,
      items: [...(extra?.items ?? []), ...response.value.items],
      nextCursor: response.value.nextCursor,
    });
  };
  return { items, nextCursor, error, busy, loadMore, reload: () => registry.refresh(atom) };
}

function ConnectedMemory({
  environmentId,
  company,
  settings,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
  readonly settings: ZenMemorySettings;
}) {
  const t = useZenText(memoryText);
  const localThreads = useLocalThreads();
  const [showReplaced, setShowReplaced] = useState(false);
  const decisions = usePagedList("decisions", environmentId, company.id, showReplaced);
  const promises = usePagedList("promises", environmentId, company.id, false);
  const reloadAll = () => {
    decisions.reload();
    promises.reload();
  };
  const today = localToday();
  const canForget = settings.hasKey;

  return (
    <div className="flex flex-col gap-6" data-zen-memory-tab>
      <PendingRules environmentId={environmentId} companyId={company.id} />
      <SearchSection
        environmentId={environmentId}
        companyId={company.id}
        localThreads={localThreads}
        canForget={canForget}
        onForgotten={reloadAll}
      />
      <section className="flex flex-col gap-2" aria-label={t.decisions}>
        <div className="flex items-center gap-2 px-1">
          <h3 className="font-medium text-sm">{t.decisions}</h3>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            {t.showReplaced}
            <Switch
              size="sm"
              checked={showReplaced}
              onCheckedChange={(checked) => setShowReplaced(Boolean(checked))}
              aria-label={t.showReplaced}
            />
          </label>
        </div>
        <FactList
          state={decisions}
          empty={t.noDecisions}
          environmentId={environmentId}
          companyId={company.id}
          localThreads={localThreads}
          canForget={canForget}
          onForgotten={reloadAll}
          today={today}
        />
      </section>
      <section className="flex flex-col gap-3" aria-label={t.promises}>
        <h3 className="px-1 font-medium text-sm">{t.promises}</h3>
        {promises.items === null ? (
          promises.error === null ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <p className="text-destructive-foreground text-sm">{promises.error}</p>
          )
        ) : (
          <PromiseGroups
            promises={promises.items}
            today={today}
            environmentId={environmentId}
            companyId={company.id}
            localThreads={localThreads}
            canForget={canForget}
            onForgotten={reloadAll}
          />
        )}
        {promises.nextCursor !== null ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={promises.busy}
            onClick={() => void promises.loadMore()}
          >
            {t.loadMore}
          </Button>
        ) : null}
      </section>
      <MemoryReview
        environmentId={environmentId}
        companyId={company.id}
        canDelete={
          settings.hubRole === "owner" ||
          settings.hubRole === "admin" ||
          (settings.hubRole == null && canForget)
        }
      />
      {canForget && settings.hubRole !== "member" && settings.hubRole !== "guest" ? (
        <ForgetPersonSection environmentId={environmentId} companyId={company.id} />
      ) : null}
    </div>
  );
}

function PromiseGroups({
  promises,
  today,
  ...rowProps
}: {
  readonly promises: ReadonlyArray<ZenMemoryFact>;
  readonly today: string;
} & RowContext) {
  const t = useZenText(memoryText);
  const groups = groupPromises(promises, today);
  const titles: Record<PromiseGroup, string> = {
    overdue: t.groupOverdue,
    open: t.groupOpen,
    done: t.groupDone,
  };
  const order: ReadonlyArray<PromiseGroup> = [
    "overdue",
    ...PROMISE_GROUPS.filter((g) => g !== "overdue"),
  ];
  return (
    <div className="flex flex-col gap-4">
      {order.map((group) => (
        <div key={group} className="flex min-w-0 flex-col gap-1.5" data-promise-group={group}>
          <h4
            className={cn(
              "flex items-center gap-1.5 px-1 font-medium text-xs",
              group === "overdue" && groups.overdue.length > 0
                ? "text-destructive-foreground"
                : "text-muted-foreground",
            )}
          >
            {group === "overdue" ? <AlertTriangleIcon className="size-3.5" aria-hidden /> : null}
            {titles[group]} ({groups[group].length})
          </h4>
          {groups[group].length === 0 ? (
            <p className="px-1 text-muted-foreground text-xs">{t.noPromisesIn}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {groups[group].map((promise) => (
                <FactRow key={promise.id} fact={promise} today={today} {...rowProps} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

interface RowContext {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly localThreads: ReadonlyMap<string, string>;
  readonly canForget: boolean;
  readonly onForgotten: () => void;
}

function FactList({
  state,
  empty,
  today,
  ...rowProps
}: {
  readonly state: ReturnType<typeof usePagedList>;
  readonly empty: string;
  readonly today: string;
} & RowContext) {
  const t = useZenText(memoryText);
  if (state.items === null) {
    return state.error === null ? (
      <Skeleton className="h-20 w-full" />
    ) : (
      <p className="text-destructive-foreground text-sm">{state.error}</p>
    );
  }
  return (
    <>
      {state.items.length === 0 ? (
        <p className="px-1 text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.items.map((fact) => (
            <FactRow key={fact.id} fact={fact} today={today} {...rowProps} />
          ))}
        </ul>
      )}
      {state.nextCursor !== null ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={state.busy}
          onClick={() => void state.loadMore()}
        >
          {t.loadMore}
        </Button>
      ) : null}
    </>
  );
}

function SearchSection({ environmentId, companyId, ...rowProps }: RowContext) {
  const t = useZenText(memoryText);
  const search = useAtomCommand(memorySearch, { reportFailure: false });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{
    readonly facts: ReadonlyArray<ZenMemoryFact>;
    readonly entities: ReadonlyArray<ZenMemoryEntity>;
  } | null>(null);
  const run = async () => {
    const q = query.trim();
    if (q === "") return;
    setBusy(true);
    const response = await search({ environmentId, input: { companyId, q, limit: 15 } });
    setBusy(false);
    if (response._tag === "Success") {
      setResults(response.value);
      return;
    }
    toastManager.add({ type: "error", title: zenErrorMessage(response.cause, t.loadFailed) });
  };
  return (
    <section className="flex flex-col gap-2" aria-label={t.searchLabel}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Input
          aria-label={t.searchLabel}
          placeholder={t.searchPlaceholder}
          value={query}
          maxLength={500}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || query.trim() === ""}>
          <SearchIcon className="size-3.5" aria-hidden />
          {busy ? t.searching : t.search}
        </Button>
      </form>
      {results === null ? null : results.facts.length === 0 && results.entities.length === 0 ? (
        <p className="px-1 text-muted-foreground text-sm">{t.noResults}</p>
      ) : (
        <div className="flex flex-col gap-1.5" data-zen-memory-results>
          <h4 className="px-1 font-medium text-muted-foreground text-xs">{t.results}</h4>
          <ul className="flex flex-col gap-1.5">
            {results.facts.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                today={localToday()}
                environmentId={environmentId}
                companyId={companyId}
                {...rowProps}
              />
            ))}
          </ul>
          {results.entities.length > 0 ? (
            <p className="px-1 text-muted-foreground text-xs">
              {t.entities}: {results.entities.map((entity) => entity.name).join(", ")}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function FactRow({
  fact,
  today,
  environmentId,
  companyId,
  localThreads,
  canForget,
  onForgotten,
}: { readonly fact: ZenMemoryFact; readonly today: string } & RowContext) {
  const t = useZenText(memoryText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const overdue = fact.type === "Promise" && isOverdue(fact, today);
  const status = overdue ? "overdue" : fact.status;
  const date = (value: string | null) => formatMemoryDate(value, locale);
  const links = sourceLinks(fact, localThreads);

  return (
    <li
      data-fact-type={fact.type}
      data-overdue={overdue ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2",
        overdue && "border-destructive/50 bg-destructive/5",
        !fact.current && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          size="sm"
          variant={
            fact.type === "Promise" ? "info" : fact.type === "Decision" ? "success" : "secondary"
          }
        >
          {fact.type === "Promise"
            ? t.typePromise
            : fact.type === "Decision"
              ? t.typeDecision
              : t.typeFact}
        </Badge>
        {status ? (
          <Badge size="sm" variant={overdue ? "error" : "outline"}>
            {t.status[status] ?? status}
          </Badge>
        ) : null}
        {!fact.current ? (
          <Badge size="sm" variant="warning">
            {t.replaced}
          </Badge>
        ) : null}
        <FactOriginBadges fact={fact} />
      </div>
      <p className="min-w-0 text-sm leading-snug">{fact.fact}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        {fact.owner ? (
          <span className="inline-flex items-center gap-1">
            <UserIcon className="size-3" aria-hidden />
            {t.owner}: {fact.owner}
          </span>
        ) : null}
        {fact.promisedTo ? (
          <span>
            {t.to}: {fact.promisedTo}
          </span>
        ) : null}
        {fact.dueDate ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue && "font-medium text-destructive-foreground",
            )}
          >
            <CalendarClockIcon className="size-3" aria-hidden />
            {t.due}: {date(fact.dueDate)}
          </span>
        ) : null}
        {fact.decisionDate ? (
          <span>
            {t.decided}: {date(fact.decisionDate)}
          </span>
        ) : null}
        {links.map((link) => (
          <span
            key={`${link.source.threadId ?? "none"}:${link.source.at ?? ""}:${link.source.title ?? ""}`}
            className="inline-flex items-center gap-1"
          >
            {t.source}: {link.source.title ?? "?"}
            {link.source.at
              ? ` (${date(link.source.at)}${link.source.user ? `, ${link.source.user}` : ""})`
              : ""}
            {link.local !== null ? (
              <Button
                size="xs"
                variant="link"
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(
                      scopeThreadRef(
                        link.local!.environmentId as EnvironmentId,
                        ThreadId.make(link.local!.threadId),
                      ),
                    ),
                  })
                }
              >
                <ExternalLinkIcon className="size-3" aria-hidden />
                {t.openThread}
              </Button>
            ) : link.source.threadId !== null ? (
              <span className="italic">({t.notOnThisMachine})</span>
            ) : null}
          </span>
        ))}
        <div className="flex-1" />
        {canForget && forgettableEntity(fact) !== null && !confirming ? (
          <Button size="xs" variant="ghost-destructive" onClick={() => setConfirming(true)}>
            {t.forget}
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <ForgetConfirm
          fact={fact}
          environmentId={environmentId}
          companyId={companyId}
          onDone={(forgotten) => {
            setConfirming(false);
            if (forgotten) onForgotten();
          }}
        />
      ) : null}
    </li>
  );
}

function ForgetConfirm({
  fact,
  environmentId,
  companyId,
  onDone,
}: {
  readonly fact: ZenMemoryFact;
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly onDone: (forgotten: boolean) => void;
}) {
  const t = useZenText(memoryText);
  const forget = useAtomCommand(memoryForget, { reportFailure: false });
  const choices = [fact.object, fact.subject].filter(
    (entity, index, all): entity is { id: string; name: string } =>
      entity !== null && all.findIndex((other) => other?.id === entity.id) === index,
  );
  const [chosen, setChosen] = useState(choices[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const target = choices.find((entity) => entity.id === chosen) ?? choices[0];
  if (target === undefined) return null;
  const confirm = async () => {
    setBusy(true);
    const response = await forget({
      environmentId,
      input: { companyId, entityId: target.id, adminConfirmed: true },
    });
    setBusy(false);
    if (response._tag === "Success") {
      toastManager.add({
        type: "success",
        title: t.forgotten(target.name),
        description: t.forgottenDetail(response.value.factsDeleted, response.value.factsRewritten),
      });
      onDone(true);
      return;
    }
    toastManager.add({
      type: "error",
      title: t.forgetFailed,
      description: zenErrorMessage(response.cause, t.forgetFailed),
    });
  };
  return (
    <div
      role="alertdialog"
      aria-label={t.forgetTitle}
      className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlertIcon className="size-4 text-destructive-foreground" aria-hidden />
        {t.forgetTitle}
        <Badge size="sm" variant="outline">
          {t.adminOnly}
        </Badge>
      </div>
      {choices.length > 1 ? (
        <fieldset className="flex flex-wrap items-center gap-2 text-xs">
          <legend className="mb-1 text-muted-foreground">{t.forgetWhich}</legend>
          {choices.map((entity) => (
            <Button
              key={entity.id}
              type="button"
              size="xs"
              variant={entity.id === target.id ? "secondary" : "outline"}
              aria-pressed={entity.id === target.id}
              onClick={() => setChosen(entity.id)}
            >
              {entity.name}
            </Button>
          ))}
        </fieldset>
      ) : null}
      <p className="text-muted-foreground text-xs">{t.forgetBody(target.name)}</p>
      <div className="flex items-center gap-2">
        <Button size="xs" variant="ghost" onClick={() => onDone(false)}>
          {t.forgetCancel}
        </Button>
        <Button size="xs" variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {t.forgetConfirm}
        </Button>
      </div>
    </div>
  );
}
