// Zen Staff: the "Connect <App>" card in a chat. It shows the best way to connect on this machine
// (AI account connector, Claude Code, Zapier, export, browser), what access is asked for, and does
// the step: opens the provider's settings, runs Claude Code's own sign-in and shows its link (open,
// QR for a phone, e-mail, copy), or lists the export steps. It never takes a password or a key.
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_PATH_BLOCK_TEXT,
  manualMcpCommand,
  type ZenConnectionScope,
  type ZenConnectorEntry,
  type ZenConnectorPath,
  type ZenConnectorPathKind,
  type ZenLoginView,
  type ZenPathBlock,
} from "@t3tools/contracts/zenConnectors";
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  FileDownIcon,
  GlobeIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  LoaderIcon,
  MailIcon,
  PlugIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { QRCodeSvg } from "../../components/ui/qr-code";
import { Textarea } from "../../components/ui/textarea";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { connectorsErrorMessage, type ConnectorsCall } from "./connectorsClient";
import { connectorsText } from "./connectors.i18n";
import {
  PROVIDER_LABEL,
  isCallbackAddress,
  looksLikeKey,
  pick,
  pickSteps,
  shownPath,
  type AgentAppView,
  type CardData,
} from "./connectState";
import { Skeleton } from "../../components/ui/skeleton";
import { SkeletonLines, SkeletonRows } from "../ui/ZenSkeletons";

const KIND_ICON: Record<ZenConnectorPathKind, ReactNode> = {
  native: <SparklesIcon className="size-3.5" />,
  "local-mcp": <PlugIcon className="size-3.5" />,
  automation: <WorkflowIcon className="size-3.5" />,
  csv: <FileDownIcon className="size-3.5" />,
  browser: <GlobeIcon className="size-3.5" />,
};

function Steps({ steps }: { readonly steps: ReadonlyArray<string> }) {
  return (
    <ol className="ms-4 list-decimal space-y-1 text-sm text-muted-foreground">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export interface ConnectCardProps {
  readonly environmentId: EnvironmentId;
  readonly data: CardData;
  readonly entries: ReadonlyArray<ZenConnectorEntry>;
  readonly call: ConnectorsCall;
  readonly onChanged: () => void;
}

export function ConnectCard({ data, entries, call, onChanged }: ConnectCardProps) {
  const text = useZenText(connectorsText);
  const locale = useZenLocale();
  const { request } = data;
  const app = data.apps[0] ?? null;
  const entry = app ? (entries.find((candidate) => candidate.id === app.id) ?? null) : null;
  const [picked, setPicked] = useState<ZenConnectorPathKind | null>(request.preferredKind);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askSent, setAskSent] = useState(false);
  const [anotherWay, setAnotherWay] = useState(false);

  const run = async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(connectorsErrorMessage(cause));
      return null;
    }
  };

  const dismiss = () =>
    void run(async () => {
      await call("requests.dismiss", { id: request.id });
      onChanged();
    });

  // A kind without a brand ("our CRM"): which app?
  if (request.appId === null && request.customUrl === null) {
    return (
      <CardShell title={text.cardTitleKind} onClose={dismiss} closeLabel={text.close}>
        <p className="text-sm">{text.whichOne}</p>
        <div className="flex flex-wrap gap-2">
          {request.candidates.map((id) => {
            const candidate = entries.find((item) => item.id === id);
            return candidate ? (
              <Button
                key={id}
                size="sm"
                variant="outline"
                onClick={() =>
                  void run(async () => {
                    await call("requests.create", {
                      threadId: request.threadId,
                      appId: id,
                      source: "chat",
                    });
                    await call("requests.dismiss", { id: request.id });
                    onChanged();
                  })
                }
              >
                {candidate.name}
              </Button>
            ) : null;
          })}
        </div>
        {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
      </CardShell>
    );
  }

  if (request.customUrl !== null) {
    return (
      <CardShell
        title={text.customTitle(request.customUrl)}
        onClose={dismiss}
        closeLabel={text.close}
      >
        <p className="text-sm text-muted-foreground">{text.customBody}</p>
        {request.state === "connected" ? (
          <p className="flex items-center gap-2 rounded-md bg-success/8 px-3 py-2 text-sm text-success-foreground">
            <CheckCircle2Icon className="size-4" />
            {text.connected(request.customUrl)}
          </p>
        ) : null}
        {request.state === "connected" ? null : (
          <LocalMcpStep
            call={call}
            request={request}
            add={() => call("connect.custom", { url: request.customUrl, requestId: request.id })}
            server={null}
            onChanged={onChanged}
          />
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" />
          {text.noKeys}
        </p>
      </CardShell>
    );
  }

  if (!app || !entry) {
    return (
      <CardShell title={text.cardTitleKind} onClose={dismiss} closeLabel={text.close}>
        <SkeletonRows rows={1} />
      </CardShell>
    );
  }

  const connectedServer = app.connections.find((connection) => connection.health === "connected");
  const kind = shownPath(app, picked);
  const path = kind ? (entry.paths.find((candidate) => candidate.kind === kind) ?? null) : null;

  return (
    <CardShell
      title={text.cardTitle(entry.name)}
      subtitle={pick(locale, entry.description)}
      badge={entry.tier === "enterprise" ? text.enterpriseBadge : null}
      onClose={dismiss}
      closeLabel={text.close}
    >
      {(request.state === "connected" || connectedServer) && !anotherWay ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-success/8 px-3 py-2 text-sm text-success-foreground">
          <CheckCircle2Icon className="size-4" />
          <span className="flex-1">
            {request.state === "connected"
              ? text.connected(connectedServer?.name ?? entry.name)
              : text.already(connectedServer?.name ?? entry.name)}
          </span>
          <Button size="xs" variant="ghost" onClick={() => setAnotherWay(true)}>
            {text.anotherWay}
          </Button>
        </div>
      ) : (
        <>
          {app.lock ? (
            <p className="rounded-md bg-warning/8 px-3 py-2 text-sm text-warning-foreground">
              {app.lock}
            </p>
          ) : null}
          <ScopeRow
            scope={request.scope}
            onChange={(scope) =>
              void run(async () => {
                await call("requests.create", {
                  threadId: request.threadId,
                  appId: entry.id,
                  scope,
                  source: "chat",
                });
                await call("requests.dismiss", { id: request.id });
                onChanged();
              })
            }
          />
          <PathPicker app={app} shown={kind} onPick={setPicked} />
          {path ? (
            <>
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {text.access}
                </p>
                <p className="text-sm">{pick(locale, path.access.read)}</p>
                {path.access.write ? (
                  <p className="text-xs text-muted-foreground">
                    {text.accessWrite(pick(locale, path.access.write))}
                  </p>
                ) : null}
              </div>
              <PathBody
                entry={entry}
                path={path}
                app={app}
                call={call}
                request={request}
                onChanged={onChanged}
              />
            </>
          ) : null}
        </>
      )}
      {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        {askSent ? (
          <p className="flex items-center gap-1.5 text-sm text-success-foreground">
            <CheckCircle2Icon className="size-4" />
            {text.askSent}
          </p>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAsking((open) => !open)}>
            <LifeBuoyIcon />
            {text.askZedZen}
          </Button>
        )}
        <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" />
          {text.noKeys}
        </span>
      </div>
      {asking && !askSent ? (
        <AskZedZen
          appName={entry.name}
          onSend={(note, contact) =>
            void run(async () => {
              await call("support.create", {
                appId: entry.id,
                note,
                contact,
                threadId: request.threadId,
                requestId: request.id,
              });
              setAskSent(true);
              setAsking(false);
            })
          }
        />
      ) : null}
    </CardShell>
  );
}

function CardShell(props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string | null;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      data-zen-connect-card
      data-zen-no-translate
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <header className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PlugIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-medium">
            {props.title}
            {props.badge ? <Badge variant="warning">{props.badge}</Badge> : null}
          </h3>
          {props.subtitle ? (
            <p className="text-sm text-muted-foreground">{props.subtitle}</p>
          ) : null}
        </div>
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label={props.closeLabel}
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </header>
      {props.children}
    </section>
  );
}

function ScopeRow(props: {
  readonly scope: ZenConnectionScope;
  readonly onChange: (scope: ZenConnectionScope) => void;
}) {
  const text = useZenText(connectorsText);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{text.scopeLabel}:</span>
      {(["personal", "company"] as const).map((scope) => (
        <Button
          key={scope}
          size="xs"
          variant={props.scope === scope ? "secondary" : "ghost"}
          aria-pressed={props.scope === scope}
          onClick={() => props.scope !== scope && props.onChange(scope)}
        >
          {scope === "personal" ? text.scopePersonal : text.scopeCompany}
        </Button>
      ))}
    </div>
  );
}

function PathPicker(props: {
  readonly app: AgentAppView;
  readonly shown: ZenConnectorPathKind | null;
  readonly onPick: (kind: ZenConnectorPathKind) => void;
}) {
  const text = useZenText(connectorsText);
  const locale = useZenLocale();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.shown === props.app.bestPath ? text.bestWay : text.otherWays}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {props.app.paths.map((option) => {
          const reason = option.blocked
            ? ZEN_PATH_BLOCK_TEXT[option.blocked as ZenPathBlock]
            : null;
          return (
            <Button
              key={option.kind}
              size="xs"
              variant={props.shown === option.kind ? "default" : "outline"}
              disabled={!option.available}
              title={reason ? pick(locale, reason) : text.kindHint[option.kind]}
              onClick={() => props.onPick(option.kind)}
            >
              {KIND_ICON[option.kind]}
              {text.kind[option.kind]}
              {option.available ? null : <span className="opacity-70">({text.unavailable})</span>}
            </Button>
          );
        })}
      </div>
      {props.shown ? (
        <p className="text-xs text-muted-foreground">{text.kindHint[props.shown]}</p>
      ) : null}
    </div>
  );
}

function PathBody(props: {
  readonly entry: ZenConnectorEntry;
  readonly path: ZenConnectorPath;
  readonly app: AgentAppView;
  readonly call: ConnectorsCall;
  readonly request: CardData["request"];
  readonly onChanged: () => void;
}) {
  const text = useZenText(connectorsText);
  const locale = useZenLocale();
  const { entry, path } = props;
  const notes = path.notes ? (
    <p className="text-xs text-muted-foreground">{pick(locale, path.notes)}</p>
  ) : null;
  switch (path.kind) {
    case "native": {
      const [primary, ...others] = path.native ?? [];
      if (!primary) return null;
      return (
        <div className="space-y-2">
          <Steps steps={pickSteps(locale, primary.steps)} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              render={<a href={primary.settingsUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              {text.openSettings(PROVIDER_LABEL[primary.provider] ?? primary.provider)}
            </Button>
            {primary.url ? <CopyButton value={primary.url} label={primary.url} /> : null}
            <VerifyButton
              call={props.call}
              request={props.request}
              appId={entry.id}
              onChanged={props.onChanged}
            />
          </div>
          {notes}
          {others.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {text.otherAccounts}
              </summary>
              <div className="mt-2 space-y-2">
                {others.map((other) => (
                  <div key={other.provider} className="space-y-1">
                    <a
                      className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                      href={other.settingsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      {text.openSettings(PROVIDER_LABEL[other.provider] ?? other.provider)}
                    </a>
                    <Steps steps={pickSteps(locale, other.steps)} />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      );
    }
    case "local-mcp": {
      const mcp = path.mcp!;
      if (mcp.auth === "env") {
        return (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRoundIcon className="size-4" />
              {text.manualTitle}
            </p>
            <p className="text-sm text-muted-foreground">{text.manualBody}</p>
            <code className="block overflow-x-auto rounded-md bg-muted px-2 py-1.5 text-xs">
              {manualMcpCommand(entry, mcp)}
            </code>
            <CopyButton value={manualMcpCommand(entry, mcp)} label={text.copyLink} />
            <Steps steps={pickSteps(locale, path.setup)} />
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <Steps steps={pickSteps(locale, path.setup)} />
          <LocalMcpStep
            call={props.call}
            request={props.request}
            add={() =>
              props.call("connect.add", {
                appId: entry.id,
                scope: props.request.scope,
                requestId: props.request.id,
              })
            }
            server={mcp.serverName ?? entry.id}
            onChanged={props.onChanged}
          />
          {notes}
        </div>
      );
    }
    case "automation":
      return (
        <div className="space-y-2">
          <Steps steps={pickSteps(locale, path.setup)} />
          {notes}
        </div>
      );
    case "csv":
      return (
        <div className="space-y-2">
          <Steps steps={pickSteps(locale, path.setup)} />
          {path.url ? (
            <Button
              size="sm"
              variant="outline"
              render={<a href={path.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              {text.openApp(entry.name)}
            </Button>
          ) : null}
          {notes}
        </div>
      );
    case "browser":
      return (
        <div className="space-y-2">
          <p className="rounded-md bg-warning/8 px-3 py-2 text-sm text-warning-foreground">
            {text.supervised}
          </p>
          <Steps steps={pickSteps(locale, path.setup)} />
          {path.url ? (
            <Button
              size="sm"
              variant="outline"
              render={<a href={path.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              {text.openApp(entry.name)}
            </Button>
          ) : null}
          {notes}
        </div>
      );
  }
}

function VerifyButton(props: {
  readonly call: ConnectorsCall;
  readonly request: CardData["request"];
  readonly appId: string;
  readonly onChanged: () => void;
}) {
  const text = useZenText(connectorsText);
  const [state, setState] = useState<"idle" | "checking" | "missing">("idle");
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={state === "checking"}
        onClick={() => {
          setState("checking");
          void props
            .call<{ connected: unknown }>("connect.verify", {
              appId: props.appId,
              requestId: props.request.id,
            })
            .then((result) => {
              setState(result.connected ? "idle" : "missing");
              props.onChanged();
            })
            .catch(() => setState("missing"));
        }}
      >
        {state === "checking" ? <LoaderIcon className="animate-spin" /> : <CheckCircle2Icon />}
        {state === "checking" ? text.checking : text.check}
      </Button>
      {state === "missing" ? (
        <p className="w-full text-sm text-muted-foreground">{text.notVisibleYet}</p>
      ) : null}
    </>
  );
}

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const text = useZenText(connectorsText);
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <CopyIcon />
      <span className="max-w-56 truncate">{copied ? text.copied : label}</span>
    </Button>
  );
}

/** Claude Code adds the server; for a sign-in, its link is shown here until it finishes. */
export function LocalMcpStep(props: {
  readonly call: ConnectorsCall;
  readonly request: Pick<CardData["request"], "id"> | null;
  readonly add: () => Promise<unknown>;
  readonly server: string | null;
  readonly onChanged: () => void;
}) {
  const text = useZenText(connectorsText);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<ZenLoginView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [email, setEmail] = useState("");
  const { call, onChanged } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls Claude Code's sign-in (a process on the server) while it runs
  useEffect(() => {
    if (login === null || login.state === "done" || login.state === "failed") return;
    const timer = setInterval(() => {
      void call<ZenLoginView>("connect.loginStatus", { loginId: login.id })
        .then((next) => {
          setLogin(next);
          if (next.state === "done") {
            void call("connect.verify", {
              server: next.server,
              requestId: props.request?.id ?? null,
            }).then(onChanged);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [call, login, onChanged, props.request?.id]);

  if (login === null || login.state === "failed") {
    return (
      <div className="space-y-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void props
              .add()
              .then((result) => {
                const next = (result as { login: ZenLoginView | null }).login;
                setLogin(next);
                if (next === null) onChanged();
              })
              .catch((cause: unknown) => setError(connectorsErrorMessage(cause)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderIcon className="animate-spin" /> : <PlugIcon />}
          {busy ? text.connecting : text.connect}
        </Button>
        {login?.state === "failed" ? (
          <p className="text-sm text-destructive-foreground">
            {text.signInFailed(login.message ?? "")}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
      </div>
    );
  }
  if (login.state === "done") {
    return (
      <p className="flex items-center gap-2 text-sm text-success-foreground">
        <CheckCircle2Icon className="size-4" />
        {text.connected(login.server)}
      </p>
    );
  }
  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <p className="text-sm font-medium">
        {login.authorizeUrl ? text.signInReady : text.waitingSignIn}
      </p>
      {login.authorizeUrl ? (
        <div className="flex flex-wrap items-start gap-4">
          <div className="space-y-2">
            <Button
              size="sm"
              render={<a href={login.authorizeUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              {text.openSignIn}
            </Button>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={login.authorizeUrl} label={text.copyLink} />
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void call<{ mailto: string }>("connect.sendLink", {
                  url: login.authorizeUrl,
                  email,
                })
                  .then((result) => window.open(result.mailto, "_self"))
                  .catch((cause: unknown) => setError(connectorsErrorMessage(cause)));
              }}
            >
              <MailIcon className="size-4 text-muted-foreground" />
              <Input
                className="h-8 w-48"
                type="email"
                value={email}
                placeholder={text.emailPlaceholder}
                aria-label={text.sendEmail}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button size="sm" variant="outline" type="submit">
                {text.send}
              </Button>
            </form>
          </div>
          <figure className="space-y-1 text-center">
            <QRCodeSvg value={login.authorizeUrl} size={112} marginSize={2} />
            <figcaption className="text-xs text-muted-foreground">{text.scanPhone}</figcaption>
          </figure>
        </div>
      ) : (
        <div className="flex items-center gap-4" aria-hidden>
          <Skeleton className="size-28 shrink-0" />
          <SkeletonLines lines={2} className="flex-1" />
        </div>
      )}
      {login.authorizeUrl ? (
        <form
          className="space-y-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isCallbackAddress(pasted)) {
              setError(text.pasteBackHelp);
              return;
            }
            void call<ZenLoginView>("connect.finishLogin", {
              loginId: login.id,
              redirectUrl: pasted,
            })
              .then((next) => {
                setPasted("");
                setLogin(next);
              })
              .catch((cause: unknown) => setError(connectorsErrorMessage(cause)));
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor={`paste-${login.id}`}>
            {text.pasteBackLabel} {text.pasteBackHelp}
          </label>
          <div className="flex gap-2">
            <Input
              id={`paste-${login.id}`}
              className="h-8"
              value={pasted}
              autoComplete="off"
              placeholder="http://localhost:…/callback?code=…"
              onChange={(event) => setPasted(event.target.value)}
            />
            <Button size="sm" variant="outline" type="submit" disabled={pasted.trim() === ""}>
              {text.pasteBackButton}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
    </div>
  );
}

function AskZedZen(props: {
  readonly appName: string;
  readonly onSend: (note: string, contact: string) => void;
}) {
  const text = useZenText(connectorsText);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const secret = looksLikeKey(note) || looksLikeKey(contact);
  return (
    <form
      className="space-y-2 rounded-md border border-border/60 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!secret) props.onSend(note, contact);
      }}
    >
      <p className="text-sm font-medium">{text.askTitle(props.appName)}</p>
      <Textarea
        value={note}
        placeholder={text.askNote}
        onChange={(event) => setNote(event.target.value)}
      />
      <Input
        value={contact}
        placeholder={text.askContact}
        onChange={(event) => setContact(event.target.value)}
      />
      <p
        className={secret ? "text-xs text-destructive-foreground" : "text-xs text-muted-foreground"}
      >
        {text.askNoSecrets}
      </p>
      <Button size="sm" type="submit" disabled={secret}>
        {text.askSend}
      </Button>
    </form>
  );
}
