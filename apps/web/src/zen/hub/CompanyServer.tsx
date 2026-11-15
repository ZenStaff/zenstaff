// Zen Staff: Team > company > "Server" and "Cont AI". One plain line says what each is; owners
// and admins choose the company server among their own connected computers (this one or a
// remote one such as srv-birou, operated through that computer's own connection and hub sign-in),
// then pick the company AI account right there, on that server. Everyone else reads the status.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenHubAiAccount, ZenHubCompanyDetail, ZenHubStatus } from "@t3tools/contracts/zenHub";
import { BotIcon, MonitorIcon, ServerIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toastManager } from "../../components/ui/toast";
import { useConnectedEnvironmentIds, useEnvironments } from "../../state/environments";
import { useZenText } from "../i18n/zenI18n";
import { companyServerText } from "./companyServer.i18n";
import { hubErrorMessage, useHubCallOn, useHubQuery } from "./hubClient";
import { securityText } from "./security.i18n";
import { ZenNativeSelect } from "../ui/ZenSelect";
import { ServerConsentRow } from "./ServerConsentRow";
import { ServerSetupDialog } from "./ServerSetupDialog";
import type { RecordedServerConsent } from "./serverSetup.logic";
import {
  companyAiModes,
  initialCompanyAiMode,
  PROVIDER_CONSOLE,
  servesColleagues,
} from "./companyAiRule";

type Detail = ZenHubCompanyDetail;
type Runner = Detail["runners"][number];

/** What one connected computer can be for this company (pure, tested). */
export type MachineState =
  | { readonly kind: "checking" }
  | { readonly kind: "not-signed-in" }
  | { readonly kind: "other-account" }
  | { readonly kind: "no-access" }
  | { readonly kind: "ready"; readonly serves: boolean; readonly hubEnvironmentId: string };

export function machineState(
  status: ZenHubStatus | null,
  input: { readonly companyId: string; readonly myUserId: string | null },
): MachineState {
  if (status === null) return { kind: "checking" };
  if (!status.signedIn || status.user === null || status.environment === null) {
    return { kind: "not-signed-in" };
  }
  if (input.myUserId !== null && status.user.id !== input.myUserId)
    return { kind: "other-account" };
  const role = status.companies.find((company) => company.id === input.companyId)?.role;
  if (role !== "owner" && role !== "admin") return { kind: "no-access" };
  const served =
    status.runnerCompanyIds ?? (status.runnerCompanyId === null ? [] : [status.runnerCompanyId]);
  return {
    kind: "ready",
    serves: served.includes(input.companyId),
    hubEnvironmentId: status.environment.id,
  };
}

const fail = (title: string) => (cause: unknown) =>
  toastManager.add({ type: "error", title, description: hubErrorMessage(cause) });

function Block(props: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid={props.testId}
    >
      <h2 className="flex items-center gap-2 font-medium text-sm">
        {props.icon}
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

interface PanelProps {
  readonly companyId: string;
  readonly status: ZenHubStatus;
  readonly detail: Detail;
  /** Owners and admins choose; everyone else reads. */
  readonly manager: boolean;
  /** This window's own computer (the others are remote connections). */
  readonly environmentId: EnvironmentId;
  readonly reload: () => void;
}

/** The connected computers of this window, this one first, with their names. */
function useMachines(primary: EnvironmentId) {
  const connected = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const ids = [primary, ...connected.filter((id) => id !== primary)];
  return ids.map((id) => ({
    environmentId: id,
    label: environments.find((item) => item.environmentId === id)?.label ?? "",
    local: id === primary,
  }));
}

function ServerLine(props: { readonly runner: Runner; readonly local: boolean }) {
  const t = useZenText(companyServerText);
  const ts = useZenText(securityText);
  return (
    <li className="flex flex-wrap items-center gap-2 py-1 text-sm" data-testid="company-server">
      <ServerIcon className="size-3.5 text-muted-foreground" />
      <span className="font-medium">{props.runner.name}</span>
      <span className="text-muted-foreground">
        {props.local ? t.thisComputer : t.ownedBy(props.runner.ownerName)}
      </span>
      {(props.runner.companies ?? 1) > 1 ? (
        <Badge variant="outline">{ts.servesCount(props.runner.companies ?? 1)}</Badge>
      ) : null}
      <Badge variant={props.runner.online ? "success" : "outline"}>
        {props.runner.online ? t.running : t.stopped}
      </Badge>
    </li>
  );
}

/** "Alege serverul firmei": each of my connected computers, with "Fă-l serverul firmei". */
function ServerChooser(props: PanelProps) {
  const t = useZenText(companyServerText);
  const machines = useMachines(props.environmentId);
  return (
    <div className="flex flex-col gap-2" data-testid="server-chooser">
      <h3 className="font-medium text-sm">{t.chooseTitle}</h3>
      <p className="text-muted-foreground text-xs">{t.chooseHint}</p>
      <ul className="flex flex-col gap-2">
        {machines.map((machine) => (
          <MachineChoice
            key={machine.environmentId}
            {...props}
            machineEnvironmentId={machine.environmentId}
            label={machine.label}
            local={machine.local}
          />
        ))}
      </ul>
      {machines.length <= 1 ? (
        <p className="text-muted-foreground text-xs" data-testid="add-server-hint">
          {t.addServerHint}
        </p>
      ) : null}
    </div>
  );
}

function MachineChoice(
  props: PanelProps & {
    readonly machineEnvironmentId: EnvironmentId;
    readonly label: string;
    readonly local: boolean;
  },
) {
  const t = useZenText(companyServerText);
  // That computer's own view of the hub (its sign-in, the companies it serves).
  const { data: machineStatus, refresh } = useHubQuery<ZenHubStatus>(
    props.machineEnvironmentId,
    "status",
  );
  const call = useHubCallOn(props.machineEnvironmentId);
  const [busy, setBusy] = useState(false);
  // Review P0-6 + the API-key rule: becoming the company server (or confirming an older one) goes
  // through one dialog: the AI account (a company key once there are colleagues), connections
  // shared on purpose only, "Am înțeles".
  const [dialog, setDialog] = useState<"enable" | "confirm" | null>(null);
  const { data: consentData, refresh: refreshConsent } = useHubQuery<{
    consents: Readonly<Record<string, RecordedServerConsent | null>>;
  }>(props.machineEnvironmentId, "runner.consent.get", {});
  const state = machineState(machineStatus, {
    companyId: props.companyId,
    myUserId: props.status.user?.id ?? null,
  });
  const name = machineStatus?.environment?.name ?? props.label;
  const afterDialog = () => {
    setDialog(null);
    refresh();
    refreshConsent();
    props.reload();
  };
  const change = (enabled: boolean) => {
    setBusy(true);
    void call("runner.set", { companyId: props.companyId, enabled })
      .then(() => {
        refresh();
        props.reload();
      }, fail(t.couldNotChange))
      .then(() => setBusy(false));
  };
  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border px-3 py-2"
      data-testid="server-choice"
      data-machine={props.local ? "local" : "remote"}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {props.local ? (
          <MonitorIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <ServerIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-medium">{name}</span>
        {props.local ? <span className="text-muted-foreground">{t.thisComputer}</span> : null}
        <span className="flex-1" />
        {state.kind === "ready" ? (
          state.serves ? (
            <>
              <Badge variant="success">{t.isServer}</Badge>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => change(false)}>
                {t.stopServer}
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => setDialog("enable")}>
              {t.makeServer}
            </Button>
          )
        ) : null}
      </div>
      {state.kind === "ready" && !state.serves ? (
        <p className="text-muted-foreground text-xs" data-testid="server-warning">
          {props.local ? t.personalWarning : t.serverWarning}
        </p>
      ) : null}
      {state.kind === "ready" && state.serves ? (
        <ServerConsentRow
          consent={consentData?.consents[props.companyId] ?? null}
          loaded={consentData !== null}
          onConfirm={() => setDialog("confirm")}
        />
      ) : null}
      {dialog !== null ? (
        <ServerSetupDialog
          environmentId={props.machineEnvironmentId}
          companyId={props.companyId}
          companyName={props.detail.company.name}
          mode={dialog}
          hasStoredKey={machineStatus?.companyAis?.[props.companyId]?.hasKey === true}
          memberCount={props.detail.members.length}
          call={call}
          onClose={() => setDialog(null)}
          onDone={afterDialog}
        />
      ) : null}
      {state.kind === "ready" &&
      state.serves &&
      machineStatus !== null &&
      (consentData?.consents[props.companyId] ?? null) !== null ? (
        <ServerKeyStep
          companyId={props.companyId}
          machineEnvironmentId={props.machineEnvironmentId}
          current={machineStatus.companyAis?.[props.companyId] ?? null}
          memberCount={props.detail.members.length}
          onSaved={() => {
            refresh();
            props.reload();
          }}
        />
      ) : null}
      {state.kind !== "ready" ? (
        <p className="text-muted-foreground text-xs">
          {state.kind === "checking"
            ? t.checking
            : state.kind === "not-signed-in"
              ? t.notSignedIn
              : state.kind === "other-account"
                ? t.otherAccount
                : t.noAccess}
        </p>
      ) : null}
    </li>
  );
}

/**
 * "Fă-l serverul firmei" is followed by the company API key: without it the server works for
 * nobody but its owner (the runner refuses colleagues, companyAiPolicy.ts on the server).
 */
function ServerKeyStep(props: {
  readonly companyId: string;
  readonly machineEnvironmentId: EnvironmentId;
  readonly current: ZenHubAiAccount | null;
  readonly memberCount: number;
  readonly onSaved: () => void;
}) {
  const t = useZenText(companyServerText);
  if (servesColleagues(props.current)) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-warning/8 p-2" data-testid="server-key-step">
      <p className="text-sm">
        {props.current?.mode === "seat" && props.memberCount <= 1 ? t.modeSoloWarning : t.needsKey}
      </p>
      <AiAccountForm
        key={JSON.stringify(props.current)}
        companyId={props.companyId}
        machineEnvironmentId={props.machineEnvironmentId}
        current={props.current}
        memberCount={props.memberCount}
        onSaved={props.onSaved}
      />
    </div>
  );
}

/** Team > company > Server. */
export function CompanyServerSection(props: PanelProps) {
  const t = useZenText(companyServerText);
  const ts = useZenText(securityText);
  const local = props.status.environment?.id ?? null;
  return (
    <Block title={t.serverTitle} icon={<ServerIcon className="size-4" />} testId="server-section">
      <p className="text-sm">{t.serverExplain}</p>
      {props.detail.runners.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="no-server">
          {props.manager ? t.noServer : t.noServerMember}
        </p>
      ) : (
        <ul data-testid="runners-list">
          {props.detail.runners.map((runner) => (
            <ServerLine key={runner.id} runner={runner} local={runner.id === local} />
          ))}
        </ul>
      )}
      {props.manager ? (
        <ServerChooser {...props} />
      ) : (
        <p className="text-muted-foreground text-xs" data-testid="server-read-only">
          {t.readOnly}
        </p>
      )}
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">{t.moreAbout}</summary>
        <p className="mt-1" data-testid="server-multi">
          {ts.serverMulti}
        </p>
      </details>
    </Block>
  );
}

/** Team > company > Cont AI. */
export function CompanyAiSection(props: PanelProps) {
  const t = useZenText(companyServerText);
  const runners = props.detail.runners;
  return (
    <Block title={t.aiTitle} icon={<BotIcon className="size-4" />} testId="runner-ai-section">
      <p className="text-sm">{t.aiExplain}</p>
      {runners.length === 0 ? (
        <>
          <p className="text-muted-foreground text-sm" data-testid="no-server">
            {props.manager ? t.noServer : t.noServerMember}
          </p>
          {props.manager ? <ServerChooser {...props} /> : null}
        </>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="runner-ai-list">
          {runners.map((runner) => (
            <ServerAccount key={runner.id} {...props} runner={runner} />
          ))}
        </ul>
      )}
      {props.manager ? null : (
        <p className="text-muted-foreground text-xs" data-testid="ai-read-only">
          {t.readOnly}
        </p>
      )}
    </Block>
  );
}

function AccountLine(props: { readonly account: ZenHubAiAccount | null | undefined }) {
  const t = useZenText(companyServerText);
  if (props.account == null) {
    return <p className="text-muted-foreground text-sm">{t.accountNotChosen}</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="ai-account">
      <span>{t.accountIs(props.account.label)}</span>
      <Badge variant="outline">
        {t.providerName[props.account.provider]} ·{" "}
        {props.account.mode === "seat" ? t.modeServer : t.modeKey}
      </Badge>
      {servesColleagues(props.account) ? null : (
        <Badge variant="warning" data-testid="not-for-colleagues">
          {t.notForColleagues}
        </Badge>
      )}
    </p>
  );
}

/** One company server: its account, and (for owners/admins) the choice, made on that server. */
function ServerAccount(props: PanelProps & { readonly runner: Runner }) {
  const t = useZenText(companyServerText);
  const machines = useMachines(props.environmentId);
  return (
    <li className="flex flex-col gap-2 rounded-lg border px-3 py-2" data-testid="server-account">
      <span className="flex items-center gap-2 font-medium text-sm">
        <ServerIcon className="size-3.5 text-muted-foreground" />
        <span>{t.onServer(props.runner.name)}</span>
        <Badge variant={props.runner.online ? "success" : "outline"}>
          {props.runner.online ? t.running : t.stopped}
        </Badge>
      </span>
      <AccountLine account={props.runner.aiAccount} />
      {props.manager ? <ServerAccountEditor {...props} machines={machines} /> : null}
    </li>
  );
}

/**
 * Finds which of my connected computers is this server (by its hub machine id) and shows the
 * form there; when none is, says where it is changed (hidden by CSS once a form is shown, so no
 * state has to travel up from the per-computer checks).
 */
function ServerAccountEditor(
  props: PanelProps & {
    readonly runner: Runner;
    readonly machines: ReadonlyArray<{ readonly environmentId: EnvironmentId }>;
  },
) {
  const t = useZenText(companyServerText);
  return (
    <div className="group/server-ai flex flex-col gap-2">
      {props.machines.map((machine) => (
        <MachineAccountForm
          key={machine.environmentId}
          {...props}
          machineEnvironmentId={machine.environmentId}
        />
      ))}
      <p
        className="text-muted-foreground text-xs group-has-data-[ai-account-form]/server-ai:hidden"
        data-testid="manage-on-server"
      >
        {t.manageOnServer(props.runner.name)}
      </p>
    </div>
  );
}

function MachineAccountForm(
  props: PanelProps & {
    readonly runner: Runner;
    readonly machineEnvironmentId: EnvironmentId;
  },
) {
  const { data: machineStatus, refresh } = useHubQuery<ZenHubStatus>(
    props.machineEnvironmentId,
    "status",
  );
  const state = machineState(machineStatus, {
    companyId: props.companyId,
    myUserId: props.status.user?.id ?? null,
  });
  if (
    machineStatus === null ||
    state.kind !== "ready" ||
    !state.serves ||
    state.hubEnvironmentId !== props.runner.id
  ) {
    return null;
  }
  return (
    <AiAccountForm
      key={JSON.stringify(machineStatus.companyAis?.[props.companyId] ?? null)}
      companyId={props.companyId}
      machineEnvironmentId={props.machineEnvironmentId}
      current={machineStatus.companyAis?.[props.companyId] ?? null}
      memberCount={props.detail.members.length}
      onSaved={() => {
        refresh();
        props.reload();
      }}
    />
  );
}

/**
 * Provider + "Cheie API a firmei" (the only choice once the company has colleagues) or, while the
 * owner is alone, "Abonamentul meu (doar pentru mine)"; saved on that server.
 */
function AiAccountForm(props: {
  readonly companyId: string;
  readonly machineEnvironmentId: EnvironmentId;
  readonly current: ZenHubAiAccount | null;
  readonly memberCount: number;
  readonly onSaved: () => void;
}) {
  const t = useZenText(companyServerText);
  const call = useHubCallOn(props.machineEnvironmentId);
  const modes = companyAiModes(props.memberCount);
  const [provider, setProvider] = useState<"claude" | "codex">(props.current?.provider ?? "claude");
  const [mode, setMode] = useState<"seat" | "api-key">(() =>
    initialCompanyAiMode(props.current, props.memberCount),
  );
  const [label, setLabel] = useState(props.current?.mode === mode ? props.current.label : "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const keyStored = props.current?.mode === "api-key" && props.current.hasKey === true;
  const needsKey = mode === "api-key" && !keyStored && apiKey.trim() === "";
  const save = () => {
    setBusy(true);
    void call("runner.aiAccount.set", {
      hubCompanyId: props.companyId,
      account: {
        provider,
        mode,
        label: label.trim() === "" ? t.defaultName[mode] : label.trim(),
        ...(mode === "api-key" && apiKey.trim() !== "" ? { apiKey: apiKey.trim() } : {}),
      },
    })
      .then(() => {
        setApiKey("");
        toastManager.add({ type: "success", title: t.saved });
        props.onSaved();
      }, fail(t.couldNotSave))
      .then(() => setBusy(false));
  };
  return (
    <form
      className="flex flex-col gap-2"
      data-testid="ai-account-form"
      data-ai-account-form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ZenNativeSelect
          aria-label={t.provider}
          value={provider}
          onChange={(event) => setProvider(event.target.value === "codex" ? "codex" : "claude")}
        >
          <option value="claude">{t.providerName.claude}</option>
          <option value="codex">{t.providerName.codex}</option>
        </ZenNativeSelect>
        {modes.length > 1 ? (
          <div className="flex gap-1" role="radiogroup" aria-label={t.howPaid}>
            {modes.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                role="radio"
                aria-checked={mode === option}
                variant={mode === option ? "default" : "outline"}
                onClick={() => setMode(option)}
                data-ai-mode={option}
              >
                {option === "seat" ? t.modeServer : t.modeKey}
              </Button>
            ))}
          </div>
        ) : (
          <span className="font-medium text-sm" data-ai-mode="api-key">
            {t.modeKey}
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {mode === "seat" ? t.modeSoloWarning : t.modeKeyHint}
        {modes.length === 1 ? ` ${t.keyOnlyForTeam}` : ""}
      </p>
      {mode === "api-key" ? (
        <p className="text-xs">
          <a
            className="underline underline-offset-2"
            href={PROVIDER_CONSOLE[provider]}
            target="_blank"
            rel="noreferrer"
            data-testid="provider-console"
          >
            {t.consoleLink}
          </a>{" "}
          <span className="text-muted-foreground">{t.capNote}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t.accountName}
          placeholder={t.defaultName[mode]}
          className="max-w-64"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {mode === "api-key" ? (
          <Input
            aria-label={t.apiKey}
            type="password"
            autoComplete="off"
            placeholder={
              keyStored ? t.apiKeyStored : provider === "codex" ? "sk-..." : "sk-ant-..."
            }
            className="max-w-64"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        ) : null}
        <Button type="submit" size="sm" disabled={busy || needsKey}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
