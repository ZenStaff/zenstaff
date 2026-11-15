// Zen Staff "Conectează-ți AI-ul": one card per AI (Claude, ChatGPT, Google), no terminal: install
// in the background, official sign-in page in the browser, detected by itself, then asked before
// use ("Confirmă contul de AI"). Onboarding, Settings, Birou, chat errors. ZEN.md.
import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  defaultInstanceIdForDriver,
  isManagedDriverAllowed,
} from "@t3tools/contracts";
import type { AiConnectJob } from "@t3tools/contracts/zenCompanies";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { AntigravityIcon, ClaudeAI, OpenAI } from "../../components/Icons";
import { buildProviderInstanceUpdatePatch } from "../../components/settings/SettingsPanels.logic";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { aiAccountSignature, aiAccountTitle, type AiAccount } from "../aiAccount/aiAccountModel";
import {
  confirmAiAccount,
  forgetAiAccount,
  useConfirmedAiAccounts,
} from "../aiAccount/aiAccountStore";
import { useZenText } from "../i18n/zenI18n";
import { useZenOffice } from "../office/useZenEdition";
import { aiConnectText } from "./aiConnect.i18n";
import { useAiConnectActions, useAiConnectDialog, useAiConnectJobs } from "./aiConnectClient";
import {
  AI_CONNECT_SERVICES,
  type AiConnectService,
  type CardView,
  type ConnectProgress,
  aiConnectCardView,
  cliProviderPatch,
  googleProviderForCard,
  nextGoogleAction,
  progressFromGoogle,
  progressFromJob,
  selectProvidersByDriver,
  serviceDriver,
  stepStatuses,
} from "./aiConnectFlow.logic";

type Text = (typeof aiConnectText)["en"];

const NO_FIRED: ReadonlySet<string> = new Set();

const ICONS: Record<AiConnectService, ReactNode> = {
  claude: <ClaudeAI className="size-5" aria-hidden />,
  codex: <OpenAI className="size-5" aria-hidden />,
  google: <AntigravityIcon className="size-5" aria-hidden />,
};

function errorText(t: Text, code: string): string {
  return (t.errors as Record<string, string>)[code] ?? t.errors.generic;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(0)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function openUrl(url: string) {
  void ensureLocalApi()
    .shell.openExternal(url)
    .catch(() => undefined);
}

/** The settings change: enable the provider and, for Google, use the Google account sign-in. */
function useProviderSettingsPatch(environmentId: EnvironmentId) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  return (
    driver: string,
    provider: ServerProvider | undefined,
    configPatch: Record<string, unknown>,
  ) => {
    const settings = config?.settings;
    if (!settings) return Promise.resolve();
    const instanceId =
      provider?.instanceId ?? defaultInstanceIdForDriver(ProviderDriverKind.make(driver));
    const instance = settings.providerInstances[instanceId] ?? {
      driver: ProviderDriverKind.make(driver),
    };
    const current =
      instance.config !== null && typeof instance.config === "object"
        ? (instance.config as Record<string, unknown>)
        : {};
    return update({
      environmentId,
      input: {
        patch: buildProviderInstanceUpdatePatch({
          settings,
          instanceId,
          instance: {
            ...instance,
            enabled: true,
            config: { ...current, enabled: true, ...configPatch },
          },
        }),
      },
    }).then(() => undefined);
  };
}

/** Asks the machine to re-read a provider every 3 s while a sign-in is waiting to be noticed. */
function useProviderPolling(
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId | undefined,
  active: boolean,
) {
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the provider status the app already has until the sign-in shows up
  useEffect(() => {
    if (!active || instanceId === undefined) return undefined;
    const tick = () => void refresh({ environmentId, input: { instanceId } });
    tick();
    const timer = window.setInterval(tick, 3_000);
    return () => window.clearInterval(timer);
  }, [active, environmentId, instanceId, refresh]);
}

/** Every card, in order Claude, ChatGPT, Google. */
export function AiConnectPanel(props: { readonly environmentId: EnvironmentId | null }) {
  const t = useZenText(aiConnectText);
  if (props.environmentId === null) {
    return (
      <div className="flex flex-col gap-2" aria-label={t.checking}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  return <AiConnectCards environmentId={props.environmentId} />;
}

function AiConnectCards(props: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(aiConnectText);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(props.environmentId));
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const jobs = useAiConnectJobs(props.environmentId);
  const office = useZenOffice();
  const navigate = useNavigate();
  if (!providers) {
    return (
      <div className="flex flex-col gap-2" aria-label={t.checking}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  const byDriver = selectProvidersByDriver(providers);
  const policy = config?.managedPolicy;
  return (
    <div className="flex flex-col gap-2" data-zen-ai-connect>
      {AI_CONNECT_SERVICES.map((service) => {
        const driver = serviceDriver(service);
        const allowed = isManagedDriverAllowed(policy, ProviderDriverKind.make(driver));
        const provider = byDriver.get(driver);
        return service === "google" ? (
          <GoogleCard
            key={service}
            environmentId={props.environmentId}
            provider={provider}
            allowed={allowed}
          />
        ) : (
          <CliCard
            key={service}
            service={service}
            environmentId={props.environmentId}
            provider={provider}
            allowed={allowed}
            job={jobs.find((job) => job.provider === service) ?? null}
          />
        );
      })}
      {office ? null : (
        <Button
          size="xs"
          variant="ghost-muted"
          className="w-fit"
          onClick={() => void navigate({ to: "/settings/providers" })}
        >
          {t.advanced}
        </Button>
      )}
    </div>
  );
}

function CliCard(props: {
  readonly service: "claude" | "codex";
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider | undefined;
  readonly allowed: boolean;
  readonly job: AiConnectJob | null;
}) {
  const { service, environmentId, provider, job } = props;
  const actions = useAiConnectActions(environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const patchSettings = useProviderSettingsPatch(environmentId);
  const confirmed = useConfirmedAiAccounts();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const patchedFor = useRef<string | null>(null);
  const progress = progressFromJob(job);
  const view = aiConnectCardView({
    provider,
    allowed: props.allowed,
    progress,
    confirmed: (account) => confirmed.has(aiAccountSignature(account)),
    now,
  });
  const driver = serviceDriver(service);
  const instance =
    config?.settings.providerInstances[
      provider?.instanceId ?? defaultInstanceIdForDriver(ProviderDriverKind.make(driver))
    ];
  const patch = cliProviderPatch({ provider, instance, job });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- once installed, point the provider at the new CLI (enabled, and its path when it is not on PATH)
  useEffect(() => {
    if (patch === null || job === null || patchedFor.current === job.id) return;
    patchedFor.current = job.id;
    void patchSettings(driver, provider, patch.binaryPath ? { binaryPath: patch.binaryPath } : {});
  }, [patch, job, driver, provider, patchSettings]);

  const waiting = view.kind === "browser" || view.kind === "verifying";
  useProviderPolling(environmentId, provider?.instanceId, waiting);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a clock for "the account is not visible yet" after a finished sign-in
  useEffect(() => {
    if (view.kind !== "verifying") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [view.kind]);

  const start = (mode: "connect" | "signin") => {
    setError(null);
    setNow(Date.now());
    actions
      .start(service, mode)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : null));
  };
  return (
    <ConnectCard
      service={service}
      view={view}
      error={error}
      onConnect={(action) => start(action)}
      onOtherAccount={() => start("signin")}
      onCancel={() => {
        if (job) void actions.cancel(job.id).catch(() => undefined);
      }}
      onSubmit={(code) =>
        job
          ? actions.submitCode(job.id, code).then(
              () => undefined,
              (cause: unknown) => setError(cause instanceof Error ? cause.message : null),
            )
          : Promise.resolve()
      }
    />
  );
}

function GoogleCard(props: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider | undefined;
  readonly allowed: boolean;
}) {
  const { environmentId } = props;
  const instanceId =
    props.provider?.instanceId ??
    defaultInstanceIdForDriver(ProviderDriverKind.make("antigravity"));
  const target = { environmentId, input: { instanceId } };
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const patchSettings = useProviderSettingsPatch(environmentId);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, {
    reportFailure: false,
  });
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, {
    reportFailure: false,
  });
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, { reportFailure: false });
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, { reportFailure: false });
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, {
    reportFailure: false,
  });
  const confirmed = useConfirmedAiAccounts();
  const [request, setRequest] = useState<{
    readonly at: number;
    readonly skippedInstall: boolean;
    readonly reauth: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which upstream calls this request already made (read only in the effect below).
  const fired = useRef(new Set<string>());
  const openedFlow = useRef<string | null>(null);
  const install = installQuery.data;
  const auth = authQuery.data;
  const provider = googleProviderForCard(props.provider, auth);
  const now = request?.at ?? 0;
  const progress = progressFromGoogle({
    requested: request !== null,
    install,
    auth,
    skippedInstall: request?.skippedInstall ?? false,
    now,
  });
  const reauthRunning =
    request?.reauth === true && progress !== null && progress.phase !== "succeeded";
  const view = aiConnectCardView({
    provider: reauthRunning ? undefined : provider,
    allowed: props.allowed,
    progress,
    confirmed: (account) => confirmed.has(aiAccountSignature(account)),
    now,
  });
  const instanceConfig = config?.settings.providerInstances[instanceId]?.config;
  const authMethod =
    instanceConfig !== null && typeof instanceConfig === "object" && "authMethod" in instanceConfig
      ? String((instanceConfig as { authMethod: unknown }).authMethod)
      : "oauth-personal";
  const action = nextGoogleAction({
    requested: request !== null,
    // Another account: sign in again although one is signed in (the effect fires it once).
    provider:
      request?.reauth && provider ? { ...provider, auth: { status: "unauthenticated" } } : provider,
    authMethod: provider?.enabled ? authMethod : null,
    install,
    auth,
    fired: NO_FIRED,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives upstream's Google setup one call at a time: enable, managed install, then sign-in
  useEffect(() => {
    if (action === null || fired.current.has(action)) return;
    fired.current.add(action);
    const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : null);
    if (action === "enable") {
      patchSettings("antigravity", provider, { authMethod: "oauth-personal" }).catch(fail);
    } else if (action === "install") {
      startInstall({ environmentId, input: { instanceId } }).catch(fail);
    } else {
      startAuth({ environmentId, input: { instanceId } }).catch(fail);
    }
  }, [action, environmentId, instanceId, patchSettings, provider, startAuth, startInstall]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens Google's sign-in page once per sign-in, on this device
  useEffect(() => {
    const url = progress?.loginUrl;
    const flowId = auth?.flowId ?? null;
    if (!url || flowId === null || openedFlow.current === flowId) return;
    openedFlow.current = flowId;
    openUrl(url);
  }, [progress?.loginUrl, auth?.flowId]);

  useProviderPolling(environmentId, provider?.instanceId, view.kind === "verifying");

  return (
    <ConnectCard
      service="google"
      view={view}
      error={error}
      onConnect={() => {
        fired.current = new Set();
        openedFlow.current = null;
        setError(null);
        setRequest({ at: Date.now(), skippedInstall: provider?.installed === true, reauth: false });
      }}
      onOtherAccount={() => {
        fired.current = new Set();
        openedFlow.current = null;
        setError(null);
        setRequest({ at: Date.now(), skippedInstall: true, reauth: true });
      }}
      onCancel={() => {
        if (install?.operationId && install.phase !== "succeeded" && install.phase !== "failed") {
          void cancelInstall({
            environmentId,
            input: { instanceId, operationId: install.operationId },
          });
        }
        if (auth?.flowId)
          void cancelAuth({ environmentId, input: { instanceId, flowId: auth.flowId } });
        setRequest(null);
      }}
      onSubmit={(callbackUrl) =>
        auth?.flowId
          ? completeAuth({
              environmentId,
              input: { instanceId, flowId: auth.flowId, callbackUrl },
            }).then(
              () => undefined,
              (cause: unknown) => setError(cause instanceof Error ? cause.message : null),
            )
          : Promise.resolve()
      }
    />
  );
}

/** The card itself: presentational, one look for the three AIs. */
export function ConnectCard(props: {
  readonly service: AiConnectService;
  readonly view: CardView;
  readonly error: string | null;
  readonly onConnect: (action: "connect" | "signin") => void;
  readonly onOtherAccount: () => void;
  readonly onCancel: () => void;
  readonly onSubmit: (value: string) => Promise<void>;
}) {
  const t = useZenText(aiConnectText);
  const { service, view } = props;
  const name = t.service[service];
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-background p-4"
      data-zen-ai-connect-card={service}
      data-zen-ai-connect-state={view.kind}
      aria-label={name}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          {ICONS[service]}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm">{name}</h3>
          <p className="text-muted-foreground text-xs">{t.plain[service]}</p>
        </div>
        {view.kind === "idle" ? (
          <Button size="sm" onClick={() => props.onConnect(view.action)} data-zen-ai-connect-start>
            {view.action === "signin" ? t.signIn(name) : t.connect[service]}
          </Button>
        ) : view.kind === "in-use" ? (
          <CheckIcon className="mt-1 size-5 text-success-foreground" aria-hidden />
        ) : null}
      </div>
      <CardBody {...props} name={name} t={t} />
      {props.error ? (
        <p role="alert" className="text-destructive text-xs">
          {props.error}
        </p>
      ) : null}
    </section>
  );
}

function CardBody(
  props: Parameters<typeof ConnectCard>[0] & { readonly name: string; readonly t: Text },
) {
  const { view, t, name } = props;
  switch (view.kind) {
    case "checking":
      return <Skeleton className="h-4 w-48" />;
    case "unavailable":
      return <p className="text-muted-foreground text-xs">{t.notAllowed}</p>;
    case "idle":
      return null;
    case "working":
      return (
        <div className="flex flex-col gap-2">
          <Steps progress={view.progress} name={name} t={t} />
          <div>
            <Button size="xs" variant="ghost" onClick={props.onCancel}>
              {t.cancel}
            </Button>
          </div>
        </div>
      );
    case "browser":
      return <BrowserStep {...props} progress={view.progress} />;
    case "verifying":
      return (
        <div className="flex flex-col gap-2" aria-label={t.verifying}>
          <p className="text-sm">{t.verifying}</p>
          <Skeleton className="h-4 w-56" />
        </div>
      );
    case "found":
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-zen-no-translate>
          <p className="flex-1 text-sm">{t.found(accountLabel(view.account))}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => confirmAiAccount(aiAccountSignature(view.account))}>
              {t.useIt}
            </Button>
            <Button size="sm" variant="outline" onClick={props.onOtherAccount}>
              {t.otherAccount}
            </Button>
          </div>
        </div>
      );
    case "in-use":
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-zen-no-translate>
          <p className="flex-1 font-medium text-sm">{t.inUse(accountLabel(view.account))}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => forgetAiAccount(aiAccountSignature(view.account))}
            >
              {t.stopUsing}
            </Button>
            <Button size="sm" variant="outline" onClick={props.onOtherAccount}>
              {t.otherAccount}
            </Button>
          </div>
        </div>
      );
    case "failed":
      return <Failure {...props} view={view} />;
  }
}

/** "Claude Pro (alex@…)": the plan when known, else the service, then the email. */
function accountLabel(account: AiAccount): string {
  return account.plan
    ? `${account.plan}${account.email ? ` (${account.email})` : ""}`
    : aiAccountTitle(account);
}

function Steps(props: {
  readonly progress: ConnectProgress;
  readonly name: string;
  readonly t: Text;
}) {
  const { progress, t } = props;
  return (
    <ol className="flex flex-col gap-1.5" data-zen-ai-connect-steps>
      {stepStatuses(progress).map(({ step, status }) => {
        const label =
          step === "download"
            ? t.steps.download(props.name)
            : step === "install"
              ? t.steps.install
              : t.steps.signin;
        return (
          <li
            key={step}
            className="flex items-center gap-2 text-sm"
            data-step={step}
            data-status={status}
          >
            {status === "done" || status === "skipped" ? (
              <CheckIcon className="size-4 text-success-foreground" aria-hidden />
            ) : status === "active" ? (
              <span className="flex size-4 items-center justify-center" aria-hidden>
                <span className="size-2 animate-pulse rounded-full bg-primary" />
              </span>
            ) : (
              <span className="flex size-4 items-center justify-center" aria-hidden>
                <span className="size-2 rounded-full bg-muted-foreground/30" />
              </span>
            )}
            <span className={status === "pending" ? "text-muted-foreground" : undefined}>
              {label}
            </span>
            {status === "skipped" ? (
              <span className="text-muted-foreground text-xs">{t.stepSkipped}</span>
            ) : null}
            {status === "active" && step === "download" && progress.attempt > 1 ? (
              <span className="text-muted-foreground text-xs">
                {t.downloadAttempt(progress.attempt)}
              </span>
            ) : null}
            {status === "active" && progress.bytes && progress.bytes.done > 0 ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                {progress.bytes.total
                  ? t.progress(formatBytes(progress.bytes.done), formatBytes(progress.bytes.total))
                  : formatBytes(progress.bytes.done)}
              </span>
            ) : null}
          </li>
        );
      })}
      {progress.phase === "running" ? (
        <li aria-hidden>
          <Skeleton className="h-1.5 w-full" />
        </li>
      ) : null}
    </ol>
  );
}

function BrowserStep(
  props: Parameters<typeof ConnectCard>[0] & {
    readonly name: string;
    readonly t: Text;
    readonly progress: ConnectProgress;
  },
) {
  const { t, progress } = props;
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const url = progress.loginUrl;
  return (
    <div className="flex flex-col gap-3" data-zen-ai-connect-browser>
      <Steps progress={progress} name={props.name} t={t} />
      <div className="rounded-lg bg-muted/40 p-3">
        <p className="font-medium text-sm">{t.browserTitle(props.name)}</p>
        <p className="mt-1 text-muted-foreground text-xs">{t.browserBody}</p>
        {url ? (
          <Button size="xs" variant="link" className="mt-1" onClick={() => openUrl(url)}>
            <ExternalLinkIcon className="size-3.5" aria-hidden />
            {t.openAgain}
          </Button>
        ) : null}
      </div>
      {progress.input !== null ? (
        progress.inputSent ? (
          <p className="text-muted-foreground text-xs">{t.codeSent}</p>
        ) : (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!value.trim() || sending) return;
              setSending(true);
              void props.onSubmit(value.trim()).then(() => {
                setSending(false);
                setValue("");
              });
            }}
          >
            <label className="text-xs" htmlFor={`zen-ai-connect-${props.service}-code`}>
              {progress.input === "code" ? t.codeLabel : t.callbackLabel}
            </label>
            <div className="flex gap-2">
              <Input
                id={`zen-ai-connect-${props.service}-code`}
                size="sm"
                autoComplete="off"
                spellCheck={false}
                maxLength={progress.input === "code" ? 512 : 16_384}
                placeholder={progress.input === "code" ? t.codePlaceholder : t.callbackPlaceholder}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={!value.trim() || sending}>
                {t.send}
              </Button>
            </div>
          </form>
        )
      ) : null}
      <div>
        <Button size="xs" variant="ghost" onClick={props.onCancel}>
          {t.cancel}
        </Button>
      </div>
    </div>
  );
}

function Failure(
  props: Parameters<typeof ConnectCard>[0] & {
    readonly t: Text;
    readonly view: Extract<CardView, { kind: "failed" }>;
  },
) {
  const { t, view } = props;
  const [open, setOpen] = useState(false);
  const detail = [view.detail, view.log].filter((part) => part.trim() !== "").join("\n\n");
  return (
    <div className="flex flex-col gap-2" data-zen-ai-connect-failed={view.code}>
      <p className="flex items-start gap-2 text-sm">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        {errorText(t, view.code)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => props.onConnect("connect")} data-zen-ai-connect-retry>
          <RotateCcwIcon className="size-3.5" aria-hidden />
          {t.tryAgain}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDownIcon className={open ? "size-3.5 rotate-180" : "size-3.5"} aria-hidden />
          {open ? t.hideDetails : t.details}
        </Button>
      </div>
      {open ? (
        <pre
          className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-2xs leading-relaxed"
          data-zen-no-translate
        >
          {detail || t.noLog}
        </pre>
      ) : null}
    </div>
  );
}

/** Birou and chat: "Connect your AI" opens this dialog with the three cards. */
export function ZenAiConnectDialogHost() {
  const t = useZenText(aiConnectText);
  const { open, hide } = useAiConnectDialog();
  const environmentId = usePrimaryEnvironmentId();
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : hide())}>
      <DialogPopup className="sm:max-w-xl" data-zen-ai-connect-dialog>
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.intro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <AiConnectPanel environmentId={environmentId} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** The button an "AI not connected" state shows instead of a bare error. */
export function ZenAiConnectButton(props: { readonly size?: "xs" | "sm" }) {
  const t = useZenText(aiConnectText);
  const show = useAiConnectDialog((state) => state.show);
  return (
    <Button size={props.size ?? "sm"} onClick={show} data-zen-ai-connect-open>
      {t.bannerButton}
    </Button>
  );
}
