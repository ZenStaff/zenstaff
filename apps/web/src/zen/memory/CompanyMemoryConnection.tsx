// Zen Staff: "Company memory" in a company's Settings tab. The server address, the API key (sent
// once to this machine's vault, never shown again), the "save conversations" switch, and a Test
// connection button that calls /v1/me and shows the quotas.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenCompany } from "@t3tools/contracts/zenCompanies";
import type { ZenMemoryTestResult } from "@t3tools/contracts/zenMemory";
import { AsyncResult } from "effect/reactivity";
import { CheckCircle2Icon, KeyRoundIcon, XCircleIcon } from "lucide-react";
import { useContext, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { zenErrorMessage, zenServerText } from "../i18n/serverText";
import { memoryText } from "./memory.i18n";
import { formatMemoryDateTime, quotaPercent } from "./memoryModel";
import { memoryConfigure, memorySettings, memoryTest } from "./memoryState";

export function CompanyMemoryConnection({
  environmentId,
  company,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
}) {
  const t = useZenText(memoryText);
  const registry = useContext(RegistryContext);
  const atom = memorySettings({ environmentId, input: { companyId: company.id } });
  const result = useAtomValue(atom);
  const settings = AsyncResult.getOrElse(result, () => null);
  if (company.isDefault) {
    return <p className="max-w-xl text-muted-foreground text-xs">{t.personalNote}</p>;
  }
  if (settings === null) return <Skeleton className="h-32 w-full max-w-xl" />;
  return (
    <ConnectionForm
      key={`${settings.url ?? ""}:${settings.hasKey}`}
      environmentId={environmentId}
      companyId={company.id}
      initialUrl={settings.url ?? ""}
      hasKey={settings.hasKey}
      keyStore={settings.keyStore}
      saveConversations={settings.saveConversations}
      pendingCount={settings.pendingCount}
      nextRetryAt={settings.nextRetryAt}
      lastSave={settings.lastSave}
      hostedActive={
        settings.hosted?.active === true &&
        settings.url !== null &&
        settings.url === settings.hosted.url
      }
      hostedError={settings.hostedError ?? null}
      onChanged={() => registry.refresh(atom)}
    />
  );
}

function ConnectionForm(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly initialUrl: string;
  readonly hasKey: boolean;
  readonly keyStore: "keychain" | "file" | null;
  readonly saveConversations: boolean;
  readonly pendingCount: number;
  readonly nextRetryAt: string | null;
  readonly lastSave: {
    readonly at: string;
    readonly status: string;
    readonly detail: string | null;
  } | null;
  readonly hostedActive: boolean;
  readonly hostedError: string | null;
  readonly onChanged: () => void;
}) {
  const t = useZenText(memoryText);
  const locale = useZenLocale();
  const configure = useAtomCommand(memoryConfigure, { reportFailure: false });
  const testCommand = useAtomCommand(memoryTest, { reportFailure: false });
  const [url, setUrl] = useState(props.initialUrl);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ZenMemoryTestResult | null>(null);
  const dirty = url.trim() !== props.initialUrl || apiKey.trim() !== "";

  const save = async (input: { url?: string; apiKey?: string; saveConversations?: boolean }) => {
    setBusy(true);
    const response = await configure({
      environmentId: props.environmentId,
      input: { companyId: props.companyId, ...input },
    });
    setBusy(false);
    if (response._tag === "Success") {
      toastManager.add({ type: "success", title: t.connectionSaved });
      setApiKey("");
      props.onChanged();
      return true;
    }
    toastManager.add({
      type: "error",
      title: t.connectionSaveFailed,
      description: zenErrorMessage(response.cause, t.connectionSaveFailed),
    });
    return false;
  };

  const runTest = async () => {
    setTesting(true);
    const response = await testCommand({
      environmentId: props.environmentId,
      input: {
        companyId: props.companyId,
        ...(url.trim() === "" ? {} : { url: url.trim() }),
        ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
      },
    });
    setTesting(false);
    if (response._tag === "Success") {
      setTest(response.value);
      return;
    }
    setTest({
      ok: false,
      companyName: null,
      graph: {},
      quotas: [],
      error: zenErrorMessage(response.cause, t.testFailed),
    });
  };

  return (
    <section
      className="flex max-w-xl flex-col gap-3 rounded-lg border p-3"
      aria-label={t.connectionTitle}
      data-zen-memory-connection
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-sm">{t.connectionTitle}</h3>
        <p className="text-muted-foreground text-xs">{t.connectionIntro}</p>
      </div>
      {props.hostedActive ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm" data-zen-memory-hosted>
          <CheckCircle2Icon className="size-4 text-success-foreground" aria-hidden />
          <span className="font-medium">{t.hostedActive}</span>
          <span className="text-muted-foreground text-xs">
            {props.hasKey ? t.hostedKeyReady : t.hostedKeyPending(props.hostedError)}
          </span>
        </p>
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save({
            url: url.trim(),
            ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
          });
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t.serverUrl}</span>
          <Input
            value={url}
            placeholder={t.serverUrlPlaceholder}
            onChange={(event) => setUrl(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <KeyRoundIcon className="size-3.5" aria-hidden />
            {t.apiKey}
          </span>
          <Input
            type="password"
            value={apiKey}
            placeholder={props.hasKey ? t.apiKeyPlaceholderSet : t.apiKeyPlaceholder}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            data-zen-no-translate
          />
          <span className="text-muted-foreground text-xs">{t.apiKeyHint(props.keyStore)}</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            {t.saveConnection}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={() => void runTest()}
          >
            {testing ? t.testing : t.testConnection}
          </Button>
          <div className="flex-1" />
          {props.hasKey ? (
            <Button
              type="button"
              size="sm"
              variant="ghost-destructive"
              disabled={busy}
              onClick={() => void save({ apiKey: "" })}
            >
              {t.removeKey}
            </Button>
          ) : null}
        </div>
      </form>
      {test === null ? null : <TestResult result={test} />}
      <label className="flex items-start justify-between gap-3 border-t pt-3 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t.saveConversations}</span>
          <span className="text-muted-foreground text-xs">{t.saveConversationsHint}</span>
        </span>
        <Switch
          checked={props.saveConversations}
          disabled={busy}
          onCheckedChange={(checked) => void save({ saveConversations: Boolean(checked) })}
          aria-label={t.saveConversations}
        />
      </label>
      {props.pendingCount > 0 || props.lastSave !== null ? (
        <div className="flex flex-col gap-0.5 text-muted-foreground text-xs">
          {props.pendingCount > 0 ? (
            <span>
              {t.pending(props.pendingCount)}
              {props.nextRetryAt
                ? ` · ${t.nextRetry(formatMemoryDateTime(props.nextRetryAt, locale))}`
                : ""}
            </span>
          ) : null}
          {props.lastSave !== null ? (
            <span>
              {t.lastSave(
                t.saveStatus[props.lastSave.status] ?? props.lastSave.status,
                formatZenRelativeTime(locale, props.lastSave.at),
              )}
              {props.lastSave.detail ? ` · ${zenServerText(props.lastSave.detail, locale)}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TestResult({ result }: { readonly result: ZenMemoryTestResult }) {
  const t = useZenText(memoryText);
  const locale = useZenLocale();
  if (!result.ok) {
    return (
      <p className="flex items-center gap-1.5 text-destructive-foreground text-sm" role="status">
        <XCircleIcon className="size-4" aria-hidden />
        {t.testFailed}: {result.error}
      </p>
    );
  }
  const graph = result.graph;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2.5" role="status">
      <p className="flex items-center gap-1.5 font-medium text-sm text-success-foreground">
        <CheckCircle2Icon className="size-4" aria-hidden />
        {t.testOk(result.companyName)}
      </p>
      <p className="text-muted-foreground text-xs">
        {t.graphCounts(graph.entities ?? 0, graph.facts ?? 0, graph.episodes ?? 0)}
      </p>
      <ul className="flex flex-col gap-1.5">
        {result.quotas.map((quota) => {
          const percent = quotaPercent(quota);
          return (
            <li key={quota.name} className="flex flex-col gap-0.5 text-xs" data-quota={quota.name}>
              <span className="flex items-center gap-2">
                <span className="font-medium">{t.quotaNames[quota.name] ?? quota.name}</span>
                <span className="text-muted-foreground">
                  {quota.limit <= 0
                    ? `${quota.used.toLocaleString(locale)} · ${t.quotaUnlimited}`
                    : `${quota.used.toLocaleString(locale)} / ${quota.limit.toLocaleString(locale)}`}
                  {quota.resetsAt
                    ? ` · ${t.quotaResets(formatMemoryDateTime(quota.resetsAt, locale))}`
                    : ""}
                </span>
              </span>
              {quota.limit > 0 ? (
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      percent >= 100
                        ? "bg-destructive"
                        : percent >= 80
                          ? "bg-warning"
                          : "bg-primary",
                    )}
                    style={{ width: `${Math.max(percent, 1)}%` }}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
