// Zen Staff memory v4 (zen-memory `wave/memory-personal`): "Memoria mea" (the person's own memory,
// companyId "personal"), "Ce știe memoria" per zone with correct / wrong / delete / send to the
// company, rules waiting for a person's confirmation, erasing a person from every zone, and (for
// owners/admins, on the Team page) the zones, who reads them and the memory rules. See ZEN.md.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenCompany } from "@t3tools/contracts/zenCompanies";
import type {
  ZenMemoryFact,
  ZenMemoryListResult,
  ZenMemoryZone,
} from "@t3tools/contracts/zenMemory";
import { AsyncResult } from "effect/reactivity";
import { BrainIcon, CheckIcon, ShieldAlertIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useContext, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { hubErrorMessage, useHubCall, useHubQuery } from "../hub/hubClient";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { zenErrorMessage } from "../i18n/serverText";
import { formatMemoryDate } from "./memoryModel";
import {
  memoryConfigure,
  memoryDecideRule,
  memoryFactAction,
  memoryFacts,
  memoryFactsPage,
  memoryForgetPerson,
  memoryPendingRules,
  memorySettings,
  memoryZones,
} from "./memoryState";
import { memoryV4Text } from "./memoryV4.i18n";
import { ZenNativeSelect } from "../ui/ZenSelect";

const PERSONAL_MEMORY = "personal";

type Text = (typeof memoryV4Text)["en"];

function zoneLabel(t: Text, zone: { kind: string; name: string }): string {
  switch (zone.kind) {
    case "company":
      return t.zoneCompany;
    case "team":
      return t.zoneTeam(zone.name);
    case "project":
      return t.zoneProject(zone.name);
    default:
      return t.zoneMine;
  }
}

/** Which memory a fact came from and how far to trust it (shown on every row). */
export function FactOriginBadges({ fact }: { readonly fact: ZenMemoryFact }) {
  const t = useZenText(memoryV4Text);
  return (
    <>
      {fact.zone ? (
        <Badge size="sm" variant="outline" data-fact-zone={fact.zone.ref}>
          {zoneLabel(t, fact.zone)}
        </Badge>
      ) : null}
      {fact.trust === "untrusted" ? (
        <Badge size="sm" variant="warning">
          {t.trustUntrusted}
        </Badge>
      ) : fact.trust === "confirmed" ? (
        <Badge size="sm" variant="success">
          {t.trustConfirmed}
        </Badge>
      ) : null}
      {fact.markedWrong === true ? (
        <Badge size="sm" variant="error">
          {t.markedWrong}
        </Badge>
      ) : null}
      {fact.promotedTo ? (
        <Badge size="sm" variant="info">
          {t.sentBadge}
        </Badge>
      ) : null}
    </>
  );
}

export function MemoryReview({
  environmentId,
  companyId,
  companies,
  canDelete,
}: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  /** Companies this item may be sent to (personal memory only). */
  readonly companies?: ReadonlyArray<ZenCompany>;
  readonly canDelete: boolean;
}) {
  const t = useZenText(memoryV4Text);
  const zonesResult = useAtomValue(memoryZones({ environmentId, input: { companyId } }));
  const zones = AsyncResult.getOrElse(zonesResult, () => null);
  const [zone, setZone] = useState<string | null>(null);
  const visible = zones?.zones ?? [];
  const chosen =
    zone ?? visible[0]?.ref ?? (companyId === PERSONAL_MEMORY ? "personal" : "company");
  return (
    <section className="flex flex-col gap-2" aria-label={t.whatMemoryKnows} data-memory-review>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h3 className="font-medium text-sm">{t.whatMemoryKnows}</h3>
        <div className="flex-1" />
        {visible.length > 1 ? (
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            {t.zoneLabel}
            <ZenNativeSelect
              className="rounded-md border bg-background px-2 py-1 text-xs"
              value={chosen}
              onChange={(event) => setZone(event.target.value)}
              aria-label={t.zoneLabel}
            >
              {visible.map((item) => (
                <option key={item.ref} value={item.ref}>
                  {zoneLabel(t, item)} ({item.facts})
                </option>
              ))}
            </ZenNativeSelect>
          </label>
        ) : null}
      </div>
      <p className="px-1 text-muted-foreground text-xs">{t.whatMemoryKnowsHint}</p>
      <ZoneFacts
        key={chosen}
        environmentId={environmentId}
        companyId={companyId}
        zone={companyId === PERSONAL_MEMORY ? undefined : chosen}
        companies={companies}
        canDelete={canDelete || companyId === PERSONAL_MEMORY}
      />
    </section>
  );
}

function ZoneFacts({
  environmentId,
  companyId,
  zone,
  companies,
  canDelete,
}: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly zone: string | undefined;
  readonly companies: ReadonlyArray<ZenCompany> | undefined;
  readonly canDelete: boolean;
}) {
  const t = useZenText(memoryV4Text);
  const registry = useContext(RegistryContext);
  const input = zone === undefined ? { companyId } : { companyId, zone };
  const atom = memoryFactsPage({ environmentId, input });
  const result = useAtomValue(atom);
  const first = AsyncResult.getOrElse(result, () => null);
  const load = useAtomCommand(memoryFacts, { reportFailure: false });
  const [more, setMore] = useState<{
    readonly first: ZenMemoryListResult;
    readonly items: ReadonlyArray<ZenMemoryFact>;
    readonly nextCursor: string | null;
  } | null>(null);
  const [filter, setFilter] = useState("");
  const extra = more !== null && more.first === first ? more : null;
  if (first === null) {
    return result._tag === "Failure" ? (
      <p className="text-destructive-foreground text-sm">
        {zenErrorMessage(result.cause, t.loadFailed)}
      </p>
    ) : (
      <Skeleton className="h-20 w-full" />
    );
  }
  const items = [...first.items, ...(extra?.items ?? [])];
  const nextCursor = extra !== null ? extra.nextCursor : first.nextCursor;
  const words = filter.trim().toLocaleLowerCase();
  const shown =
    words === "" ? items : items.filter((item) => item.fact.toLocaleLowerCase().includes(words));
  const loadMore = () => {
    if (nextCursor === null) return;
    void load({ environmentId, input: { ...input, cursor: nextCursor } }).then((response) => {
      if (response._tag !== "Success") {
        toastManager.add({ type: "error", title: zenErrorMessage(response.cause, t.loadFailed) });
        return;
      }
      setMore({
        first,
        items: [...(extra?.items ?? []), ...response.value.items],
        nextCursor: response.value.nextCursor,
      });
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Input
        size="sm"
        value={filter}
        placeholder={t.filterPlaceholder}
        aria-label={t.filterPlaceholder}
        onChange={(event) => setFilter(event.target.value)}
      />
      {shown.length === 0 ? (
        <p className="px-1 text-muted-foreground text-xs">{t.nothingHere}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((fact) => (
            <ReviewRow
              key={fact.id}
              fact={fact}
              environmentId={environmentId}
              companyId={companyId}
              zone={zone}
              companies={companies}
              canDelete={canDelete}
              onChanged={() => registry.refresh(atom)}
            />
          ))}
        </ul>
      )}
      {nextCursor !== null ? (
        <Button size="xs" variant="ghost" onClick={loadMore}>
          {t.loadMore}
        </Button>
      ) : null}
    </div>
  );
}

function ReviewRow({
  fact,
  environmentId,
  companyId,
  zone,
  companies,
  canDelete,
  onChanged,
}: {
  readonly fact: ZenMemoryFact;
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly zone: string | undefined;
  readonly companies: ReadonlyArray<ZenCompany> | undefined;
  readonly canDelete: boolean;
  readonly onChanged: () => void;
}) {
  const t = useZenText(memoryV4Text);
  const locale = useZenLocale();
  const act = useAtomCommand(memoryFactAction, { reportFailure: false });
  const [mode, setMode] = useState<"view" | "correct" | "send">("view");
  const [text, setText] = useState(fact.fact);
  const [busy, setBusy] = useState(false);
  const targets = (companies ?? []).filter((company) => !company.isDefault);
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const source = fact.sources[0] ?? null;
  const run = (
    action: "correct" | "wrong" | "delete" | "promote",
    done: string,
    extra: Record<string, unknown> = {},
  ) => {
    setBusy(true);
    void act({
      environmentId,
      input: {
        companyId,
        factId: fact.id,
        action,
        ...(zone === undefined ? {} : { zone }),
        ...extra,
      },
    }).then((response) => {
      setBusy(false);
      if (response._tag !== "Success") {
        toastManager.add({
          type: "error",
          title: t.actionFailed,
          description: zenErrorMessage(response.cause, t.actionFailed),
        });
        return;
      }
      toastManager.add({ type: "success", title: done });
      setMode("view");
      onChanged();
    });
  };
  const targetName = targets.find((company) => company.id === target)?.name ?? "";
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2",
        !fact.current && "opacity-70",
      )}
      data-review-fact={fact.id}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <FactOriginBadges fact={fact} />
      </div>
      {mode === "correct" ? (
        <div className="flex flex-col gap-1.5">
          <Input
            size="sm"
            value={text}
            aria-label={t.correct}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={() => setMode("view")}>
              {t.cancel}
            </Button>
            <Button
              size="xs"
              disabled={busy || text.trim().length < 3}
              onClick={() => run("correct", t.corrected, { text: text.trim() })}
            >
              {t.saveCorrection}
            </Button>
          </div>
        </div>
      ) : (
        <p className="min-w-0 text-sm leading-snug">{fact.fact}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        {source?.title ? <span>{t.knownFrom(source.title)}</span> : null}
        {source?.at ? <span>{formatMemoryDate(source.at, locale)}</span> : null}
        {source?.user ? <span>{source.user}</span> : null}
        <div className="flex-1" />
        {mode === "view" ? (
          <>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => setMode("correct")}>
              {t.correct}
            </Button>
            {fact.current ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => run("wrong", t.markedWrong)}
              >
                {t.markWrong}
              </Button>
            ) : null}
            {companyId === PERSONAL_MEMORY ? (
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setMode("send")}>
                {t.sendToCompany}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                size="xs"
                variant="ghost-destructive"
                disabled={busy}
                onClick={() => run("delete", t.deleted)}
              >
                {t.delete}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {mode === "send" ? (
        <div
          className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2 text-xs"
          role="dialog"
          aria-label={t.sendToCompany}
        >
          {targets.length === 0 ? (
            <p>{t.noCompanyToSend}</p>
          ) : (
            <>
              <label className="flex items-center gap-2">
                {t.chooseCompany}
                <ZenNativeSelect
                  className="rounded-md border bg-background px-2 py-1"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  aria-label={t.chooseCompany}
                >
                  {targets.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </ZenNativeSelect>
              </label>
              <p className="text-muted-foreground">{t.sendToCompanyBody(targetName)}</p>
            </>
          )}
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={() => setMode("view")}>
              {t.cancel}
            </Button>
            {targets.length > 0 ? (
              <Button
                size="xs"
                disabled={busy || target === ""}
                onClick={() => run("promote", t.sent, { targetCompanyId: target, consent: true })}
              >
                {t.sendConfirm}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function PendingRules({
  environmentId,
  companyId,
}: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
}) {
  const t = useZenText(memoryV4Text);
  const registry = useContext(RegistryContext);
  const atom = memoryPendingRules({ environmentId, input: { companyId } });
  const result = useAtomValue(atom);
  const rules = AsyncResult.getOrElse(result, () => null)?.rules ?? [];
  const decide = useAtomCommand(memoryDecideRule, { reportFailure: false });
  const [busy, setBusy] = useState<string | null>(null);
  if (rules.length === 0) return null;
  const answer = (ruleId: string, decision: "confirm" | "reject") => {
    setBusy(ruleId);
    void decide({ environmentId, input: { companyId, ruleId, decision } }).then((response) => {
      setBusy(null);
      if (response._tag !== "Success") {
        toastManager.add({ type: "error", title: zenErrorMessage(response.cause, t.saveFailed) });
        return;
      }
      toastManager.add({
        type: "success",
        title: decision === "confirm" ? t.ruleConfirmed : t.ruleRejected,
      });
      registry.refresh(atom);
    });
  };
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3"
      aria-label={t.rulesTitle}
      data-pending-rules
    >
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <ShieldCheckIcon className="size-4" aria-hidden />
        {t.rulesTitle}
      </h3>
      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-col gap-1.5 text-sm" data-pending-rule={rule.id}>
            <p>
              <span className="text-muted-foreground">{t.ruleAsk}</span> „{rule.text}”
              {rule.title ? (
                <span className="text-muted-foreground text-xs"> ({t.ruleFrom(rule.title)})</span>
              ) : null}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                disabled={busy === rule.id}
                onClick={() => answer(rule.id, "confirm")}
              >
                <CheckIcon className="size-3" aria-hidden />
                {t.confirm}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy === rule.id}
                onClick={() => answer(rule.id, "reject")}
              >
                <XIcon className="size-3" aria-hidden />
                {t.reject}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ForgetPersonSection({
  environmentId,
  companyId,
}: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
}) {
  const t = useZenText(memoryV4Text);
  const forget = useAtomCommand(memoryForgetPerson, { reportFailure: false });
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const erase = () => {
    setBusy(true);
    void forget({
      environmentId,
      input: { companyId, name: name.trim(), adminConfirmed: true },
    }).then((response) => {
      setBusy(false);
      setConfirming(false);
      if (response._tag !== "Success") {
        toastManager.add({ type: "error", title: zenErrorMessage(response.cause, t.saveFailed) });
        return;
      }
      const { factsDeleted, zones } = response.value;
      toastManager.add({
        type: "success",
        title:
          zones.length === 0 ? t.forgetPersonNone : t.forgetPersonDone(factsDeleted, zones.length),
      });
      setName("");
    });
  };
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border p-3"
      aria-label={t.forgetPersonTitle}
      data-forget-person
    >
      <h3 className="flex flex-wrap items-center gap-2 font-medium text-sm">
        <ShieldAlertIcon className="size-4 text-destructive-foreground" aria-hidden />
        {t.forgetPersonTitle}
        <Badge size="sm" variant="outline">
          {t.adminOnly}
        </Badge>
      </h3>
      <p className="text-muted-foreground text-xs">{t.forgetPersonBody}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          className="max-w-xs"
          value={name}
          placeholder={t.forgetPersonPlaceholder}
          aria-label={t.forgetPersonPlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
        {confirming ? (
          <>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
            <Button size="xs" variant="destructive" disabled={busy} onClick={erase}>
              {t.forgetPersonButton}
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant="outline"
            disabled={name.trim().length < 2}
            onClick={() => setConfirming(true)}
          >
            {t.forgetPersonButton}
          </Button>
        )}
      </div>
    </section>
  );
}

interface PersonalHubStatus {
  readonly machines: ReadonlyArray<{ keyId: string; machine: string; issuedAt: string }>;
  readonly companies: ReadonlyArray<{ companyId: string; name: string }>;
}

export function PersonalMemoryPanel({
  environmentId,
  companies,
}: {
  readonly environmentId: EnvironmentId;
  readonly companies: ReadonlyArray<ZenCompany>;
}) {
  const t = useZenText(memoryV4Text);
  const registry = useContext(RegistryContext);
  const settingsAtom = memorySettings({ environmentId, input: { companyId: PERSONAL_MEMORY } });
  const result = useAtomValue(settingsAtom);
  const settings = AsyncResult.getOrElse(result, () => null);
  const configure = useAtomCommand(memoryConfigure, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  if (settings === null) {
    return result._tag === "Failure" ? (
      <p className="text-destructive-foreground text-sm">
        {zenErrorMessage(result.cause, t.loadFailed)}
      </p>
    ) : (
      <Skeleton className="h-24 w-full" />
    );
  }
  const change = (
    input: { activateHosted?: boolean; saveConversations?: boolean },
    done: string | null,
  ) => {
    setBusy(true);
    void configure({ environmentId, input: { companyId: PERSONAL_MEMORY, ...input } }).then(
      (response) => {
        setBusy(false);
        if (response._tag !== "Success") {
          toastManager.add({ type: "error", title: zenErrorMessage(response.cause, t.saveFailed) });
          return;
        }
        if (done !== null) toastManager.add({ type: "success", title: done });
        registry.refresh(settingsAtom);
      },
    );
  };
  const hosted = settings.hosted ?? null;
  return (
    <div className="flex flex-col gap-4" data-personal-memory>
      <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <BrainIcon className="size-4" aria-hidden />
          {t.myMemoryTitle}
        </h2>
        <p className="text-muted-foreground text-sm">{t.myMemoryIntro}</p>
        {settings.connected ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success">{t.myMemoryOn}</Badge>
              <span className="text-muted-foreground text-xs">{t.myMemoryKeyReady}</span>
            </p>
            <p className="text-muted-foreground text-xs">{t.myMemoryWhere}</p>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                size="sm"
                checked={settings.saveConversations}
                disabled={busy}
                onCheckedChange={(checked) => change({ saveConversations: Boolean(checked) }, null)}
                aria-label={t.saveMine}
              />
              {t.saveMine}
            </label>
          </>
        ) : hosted?.active === true ? (
          <p className="text-muted-foreground text-sm">
            {t.myMemoryKeyPending(settings.hostedError ?? null)}
          </p>
        ) : hosted?.available === true ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{t.myMemoryOff}</Badge>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => change({ activateHosted: true }, t.myMemoryTurnedOn)}
            >
              {t.myMemoryTurnOn}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t.myMemoryNeedsHub}</p>
        )}
      </section>
      {settings.connected ? (
        <>
          <PendingRules environmentId={environmentId} companyId={PERSONAL_MEMORY} />
          <MemoryReview
            environmentId={environmentId}
            companyId={PERSONAL_MEMORY}
            companies={companies}
            canDelete
          />
          {hosted?.active === true ? <PersonalHubSection environmentId={environmentId} /> : null}
        </>
      ) : null}
    </div>
  );
}

function PersonalHubSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(memoryV4Text);
  const { call } = useHubCall();
  const status = useHubQuery<PersonalHubStatus>(environmentId, "memoryPersonal.get");
  const registry = useContext(RegistryContext);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = (
    op: Parameters<typeof call>[0],
    input: Record<string, unknown>,
    done: (value: unknown) => string,
  ) => {
    setBusy(true);
    void call(op, input)
      .then(
        (value) => {
          toastManager.add({ type: "success", title: done(value) });
          status.refresh();
          registry.refresh(
            memorySettings({ environmentId, input: { companyId: PERSONAL_MEMORY } }),
          );
        },
        (error: unknown) =>
          toastManager.add({ type: "error", title: hubErrorMessage(error, t.saveFailed) }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
      {status.data !== null && status.data.machines.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{t.devicesTitle}</h3>
          <ul className="flex flex-col gap-1">
            {status.data.machines.map((machine) => (
              <li key={machine.keyId} className="flex items-center gap-2 text-xs">
                <span>{machine.machine}</span>
                <div className="flex-1" />
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    act("memoryPersonal.removeKey", { keyId: machine.keyId }, () => t.deviceRemoved)
                  }
                >
                  {t.removeDevice}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {status.data !== null && status.data.companies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{t.companiesTitle}</h3>
          <ul className="flex flex-col gap-1">
            {status.data.companies.map((company) => (
              <li key={company.companyId} className="flex items-center gap-2 text-xs">
                <span>{company.name}</span>
                <div className="flex-1" />
                <Button
                  size="xs"
                  variant="ghost-destructive"
                  disabled={busy}
                  onClick={() =>
                    act("memoryPersonal.forgetCompany", { companyId: company.companyId }, (value) =>
                      t.forgetCompanyDone(
                        Number((value as { factsDeleted?: unknown }).factsDeleted ?? 0),
                      ),
                    )
                  }
                >
                  {t.forgetCompany}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {confirming ? (
          <div
            role="alertdialog"
            aria-label={t.deleteAll}
            className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="text-xs">{t.deleteAllBody}</p>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                {t.cancel}
              </Button>
              <Button
                size="xs"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  act("memoryPersonal.delete", { confirm: "sterge" }, () => t.deleteAllDone)
                }
              >
                {t.deleteAllConfirm}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="xs"
            variant="ghost-destructive"
            className="self-start"
            onClick={() => setConfirming(true)}
          >
            {t.deleteAll}
          </Button>
        )}
      </div>
    </section>
  );
}

interface HubZones {
  readonly rules?: {
    readonly autoPromoteDecisions: boolean;
    readonly sensitivePolicy: string;
  } | null;
  readonly zones: ReadonlyArray<{
    readonly ref: string;
    readonly kind: ZenMemoryZone["kind"];
    readonly name: string;
    readonly restricted?: boolean;
    readonly readers: ReadonlyArray<{ userId: string; name: string; admin: boolean }>;
  }>;
}

export function MemoryZonesAdmin({ companyId }: { readonly companyId: string }) {
  const { environmentId } = useHubCall();
  if (environmentId === null) return null;
  return <MemoryZonesAdminLoad environmentId={environmentId} companyId={companyId} />;
}

function MemoryZonesAdminLoad({
  environmentId,
  companyId,
}: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
}) {
  const zones = useHubQuery<HubZones>(environmentId, "memoryHosted.zones", { companyId });
  if (zones.data === null) {
    return zones.error === null ? (
      <Skeleton className="h-16 w-full" />
    ) : (
      <p className="text-destructive-foreground text-xs">{zones.error}</p>
    );
  }
  return (
    <MemoryZonesAdminFor
      key={`${String(zones.data.rules?.autoPromoteDecisions)}:${zones.data.rules?.sensitivePolicy ?? ""}`}
      companyId={companyId}
      data={zones.data}
      refresh={zones.refresh}
      rules={zones.data.rules ?? null}
    />
  );
}

function MemoryZonesAdminFor({
  companyId,
  data,
  refresh,
  rules,
}: {
  readonly companyId: string;
  readonly data: HubZones;
  readonly refresh: () => void;
  readonly rules: {
    readonly autoPromoteDecisions: boolean;
    readonly sensitivePolicy: string;
  } | null;
}) {
  const t = useZenText(memoryV4Text);
  const { call } = useHubCall();
  const zones = { data, refresh };
  const [autoPromote, setAutoPromote] = useState(rules?.autoPromoteDecisions ?? false);
  const [sensitive, setSensitive] = useState(
    rules?.sensitivePolicy === "drop" ? "drop" : "personal",
  );
  const [busy, setBusy] = useState(false);
  const save = (op: Parameters<typeof call>[0], input: Record<string, unknown>, done: string) => {
    setBusy(true);
    void call(op, { companyId, ...input })
      .then(
        () => {
          toastManager.add({ type: "success", title: done });
          zones.refresh();
        },
        (error: unknown) =>
          toastManager.add({ type: "error", title: hubErrorMessage(error, t.saveFailed) }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-4" data-memory-zones-admin>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-sm">{t.rulesSectionTitle}</h3>
        <label className="flex items-start gap-2 text-sm">
          <Switch
            size="sm"
            checked={autoPromote}
            disabled={busy}
            onCheckedChange={(checked) => {
              setAutoPromote(Boolean(checked));
              save("memoryHosted.rules", { autoPromoteDecisions: Boolean(checked) }, t.rulesSaved);
            }}
            aria-label={t.autoPromote}
          />
          <span className="flex flex-col">
            {t.autoPromote}
            <span className="text-muted-foreground text-xs">{t.autoPromoteHint}</span>
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t.sensitiveLabel}
          <ZenNativeSelect
            className="rounded-md border bg-background px-2 py-1 text-xs"
            value={sensitive}
            disabled={busy}
            aria-label={t.sensitiveLabel}
            onChange={(event) => {
              const value = event.target.value === "drop" ? "drop" : "personal";
              setSensitive(value);
              save("memoryHosted.rules", { sensitivePolicy: value }, t.rulesSaved);
            }}
          >
            <option value="personal">{t.sensitivePersonal}</option>
            <option value="drop">{t.sensitiveDrop}</option>
          </ZenNativeSelect>
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-sm">{t.zonesAdminTitle}</h3>
        <p className="text-muted-foreground text-xs">{t.zonesAdminHint}</p>
        {
          <ul className="flex flex-col gap-1.5">
            {zones.data.zones.map((zone) => (
              <li
                key={zone.ref}
                className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm"
                data-memory-zone={zone.ref}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{zoneLabel(t, zone)}</span>
                  <span className="text-muted-foreground text-xs">
                    {t.readers(zone.readers.length)}
                  </span>
                  <div className="flex-1" />
                  {zone.kind === "company" ? null : (
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        size="sm"
                        checked={zone.restricted === true}
                        disabled={busy}
                        aria-label={t.restricted}
                        onCheckedChange={(checked) =>
                          save(
                            "memoryHosted.zone",
                            { ref: zone.ref, restricted: Boolean(checked) },
                            t.zoneSaved,
                          )
                        }
                      />
                      {t.restricted}
                    </label>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {zone.readers.map((reader) => reader.name).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        }
      </div>
    </div>
  );
}
