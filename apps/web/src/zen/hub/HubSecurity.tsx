// Zen Staff hub: two-factor authentication, passkeys, signed-in sessions, device keys and the
// devices this machine trusts as a runner. See docs/zen-hub.md, "Security" and "Auth".
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZenHubDevice,
  ZenHubPasskey,
  ZenHubSession,
  ZenHubTwoFactorStatus,
} from "@t3tools/contracts/zenHub";
import { FingerprintIcon, KeyRoundIcon, LaptopIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { QRCodeSvg } from "../../components/ui/qr-code";
import { toastManager } from "../../components/ui/toast";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { hubText } from "./hub.i18n";
import { hubErrorMessage, useHubQuery, type HubCall } from "./hubClient";

function Panel(props: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid="hub-security-panel"
    >
      <h2 className="flex items-center gap-2 font-medium text-sm">
        {props.icon}
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export function RecoveryCodes(props: { readonly codes: ReadonlyArray<string> }) {
  const t = useZenText(hubText);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3"
      data-testid="recovery-codes"
    >
      <b className="text-sm">{t.recoveryTitle}</b>
      <p className="text-muted-foreground text-xs">{t.recoveryHint}</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
        {props.codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Two-factor authentication. `gate` mode is what the Team page shows before anything else when a
 * session must enter a code or an owner/admin must set it up.
 */
export function TwoFactorPanel(props: {
  readonly status: ZenHubTwoFactorStatus;
  readonly call: HubCall;
  readonly refresh: () => void;
  readonly gate?: boolean;
  /** New recovery codes go here when given (the gate panel goes away once two-factor is on). */
  readonly onRecoveryCodes?: (codes: ReadonlyArray<string>) => void;
}) {
  const t = useZenText(hubText);
  const { status, call } = props;
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [codes, setCodes] = useState<ReadonlyArray<string> | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      toastManager.add({ type: "error", title: t.codeWrong, description: hubErrorMessage(cause) });
    }
    setBusy(false);
  };

  const needsVerify = status.enabled && !status.sessionVerified;
  const title = props.gate ? (needsVerify ? t.verifyTitle : t.enrollTitle) : t.twoFactorTitle;

  return (
    <Panel title={title} icon={<ShieldCheckIcon className="size-4" />}>
      {props.gate ? (
        <p className="text-muted-foreground text-sm">{needsVerify ? t.verifyHint : t.enrollHint}</p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={status.enabled ? "default" : "outline"} data-testid="two-factor-state">
            {status.enabled ? t.twoFactorOn : t.twoFactorOff}
          </Badge>
          <span className="text-muted-foreground">
            {status.required ? t.twoFactorRequired : t.twoFactorOptional}
          </span>
          {status.enabled ? (
            <span className="text-muted-foreground">
              · {t.recoveryLeft(status.recoveryCodesLeft)}
            </span>
          ) : null}
        </p>
      )}

      {needsVerify ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await call("twoFactor.verify", useRecovery ? { recoveryCode: recovery } : { code });
              props.refresh();
            });
          }}
        >
          {useRecovery ? (
            <Input
              aria-label={t.recoveryCode}
              placeholder="XXXX-XXXX"
              className="max-w-40"
              value={recovery}
              onChange={(event) => setRecovery(event.target.value)}
            />
          ) : (
            <Input
              aria-label={t.enterCode}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="max-w-32"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
          <Button type="submit" size="sm" disabled={busy}>
            {t.verify}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setUseRecovery((value) => !value)}
          >
            {useRecovery ? t.useCode : t.useRecovery}
          </Button>
        </form>
      ) : null}

      {!status.enabled ? (
        setup === null ? (
          <div>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(async () =>
                  setSetup(await call<{ secret: string; uri: string }>("twoFactor.setup")),
                )
              }
            >
              {t.setUp}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-4" data-testid="two-factor-setup">
            <div className="rounded-md bg-white p-2">
              <QRCodeSvg
                value={setup.uri}
                size={148}

                title={t.qrTitle}
              />
            </div>
            <div className="flex min-w-60 flex-1 flex-col gap-2 text-sm">
              <p className="text-muted-foreground">{t.scanQr}</p>
              <p>
                {t.secretKey}:{" "}
                <code className="break-all font-mono" data-testid="totp-secret">
                  {setup.secret}
                </code>
              </p>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    const result = await call<{ recoveryCodes: ReadonlyArray<string> }>(
                      "twoFactor.enable",
                      { code },
                    );
                    if (props.onRecoveryCodes) props.onRecoveryCodes(result.recoveryCodes);
                    else setCodes(result.recoveryCodes);
                    setSetup(null);
                    setCode("");
                    props.refresh();
                  });
                }}
              >
                <Input
                  aria-label={t.enterCode}
                  placeholder="123456"
                  inputMode="numeric"
                  className="max-w-32"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button type="submit" size="sm" disabled={busy || code.trim().length < 6}>
                  {t.enable}
                </Button>
              </form>
            </div>
          </div>
        )
      ) : null}

      {codes !== null ? <RecoveryCodes codes={codes} /> : null}

      {status.enabled && status.sessionVerified && !props.gate ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <Input
            aria-label={t.enterCode}
            placeholder="123456"
            inputMode="numeric"
            className="max-w-32"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || code.trim().length < 6}
            onClick={() =>
              void act(async () => {
                const result = await call<{ recoveryCodes: ReadonlyArray<string> }>(
                  "twoFactor.recoveryCodes",
                  { code },
                );
                setCodes(result.recoveryCodes);
                setCode("");
                props.refresh();
              })
            }
          >
            {t.newRecoveryCodes}
          </Button>
          {!status.required ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || code.trim().length < 6}
              onClick={() =>
                void act(async () => {
                  await call("twoFactor.disable", { code });
                  setCode("");
                  props.refresh();
                })
              }
            >
              {t.disable}
            </Button>
          ) : null}
        </form>
      ) : null}
    </Panel>
  );
}

/** How long the list keeps refreshing after the hub's passkey page was opened (its link lives 10 min). */
const PASSKEY_WAIT_MS = 10 * 60_000;

/**
 * Passkeys. Adding one opens the hub's own page in the browser (the hub is the relying party);
 * the list refreshes by itself until the new passkey shows up.
 */
export function PasskeysPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly call: HubCall;
  /** Owners and admins: the authenticator app stays required next to passkeys. */
  readonly twoFactorRequired: boolean;
}) {
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const { data, refresh } = useHubQuery<{ passkeys: ReadonlyArray<ZenHubPasskey> }>(
    props.environmentId,
    "passkeys.list",
  );
  const [label, setLabel] = useState("");
  const [waitingFor, setWaitingFor] = useState<{ count: number } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeys = data?.passkeys ?? [];
  // Waiting until the new passkey shows up in the list.
  const waiting = waitingFor !== null && passkeys.length <= waitingFor.count;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer asks the hub whether the passkey was added in the browser
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(refresh, 3000);
    // The hub's link lives 10 minutes; after that nothing can arrive.
    const stop = setTimeout(() => clearInterval(timer), PASSKEY_WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [refresh, waiting]);

  const fail = (title: string) => (cause: unknown) =>
    toastManager.add({ type: "error", title, description: hubErrorMessage(cause) });

  const add = () => {
    setBusy(true);
    props
      .call<{ url: string }>("passkeys.register", { label, lang: locale })
      .then((result) => {
        window.open(result.url, "_blank", "noopener");
        setWaitingFor({ count: passkeys.length });
        setLabel("");
      }, fail(t.addPasskey))
      .then(() => setBusy(false));
  };

  return (
    <Panel title={t.passkeysTitle} icon={<FingerprintIcon className="size-4" />}>
      <p className="text-muted-foreground text-sm">
        {t.passkeysHint}
        {props.twoFactorRequired ? ` ${t.passkeysOwnerHint}` : ""}
      </p>
      <ul className="flex flex-col divide-y text-sm" data-testid="passkeys-list">
        {passkeys.map((passkey) => (
          <li key={passkey.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              {passkey.label}
              <span className="text-muted-foreground">
                {" "}
                · {t.passkeyAdded(formatZenRelativeTime(locale, passkey.createdAt))} ·{" "}
                {passkey.lastUsedAt !== null
                  ? t.lastUsed(formatZenRelativeTime(locale, passkey.lastUsedAt))
                  : t.passkeyNeverUsed}
              </span>
            </span>
            {passkey.backedUp ? <Badge variant="outline">{t.passkeySynced}</Badge> : null}
            {confirming === passkey.id ? (
              <span className="flex basis-full flex-wrap items-center gap-2">
                <span className="flex-1 text-muted-foreground">
                  {t.removePasskeyConfirm(passkey.label)}
                </span>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => {
                    setConfirming(null);
                    void props
                      .call("passkeys.remove", { passkeyId: passkey.id })
                      .then(refresh, fail(t.removePasskey));
                  }}
                >
                  {t.removePasskey}
                </Button>
              </span>
            ) : (
              <Button size="xs" variant="outline" onClick={() => setConfirming(passkey.id)}>
                {t.removePasskey}
              </Button>
            )}
          </li>
        ))}
        {passkeys.length === 0 ? (
          <li className="py-1.5 text-muted-foreground">{t.passkeysEmpty}</li>
        ) : null}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label={t.passkeyName}
          placeholder={t.passkeyName}
          className="max-w-64"
          maxLength={120}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy}>
          <FingerprintIcon />
          {t.addPasskey}
        </Button>
      </form>
      {waiting ? <p className="text-muted-foreground text-sm">{t.passkeyOpened}</p> : null}
    </Panel>
  );
}

export function SessionsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly call: HubCall;
}) {
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const { data, refresh } = useHubQuery<{ sessions: ReadonlyArray<ZenHubSession> }>(
    props.environmentId,
    "sessions.list",
  );
  return (
    <Panel title={t.sessionsTitle} icon={<LaptopIcon className="size-4" />}>
      <p className="text-muted-foreground text-sm">{t.sessionsHint}</p>
      <ul className="flex flex-col divide-y text-sm" data-testid="sessions-list">
        {(data?.sessions ?? []).map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              {session.label}
              <span className="text-muted-foreground">
                {" "}
                · {t.methodLabel[session.method] ?? session.method}
                {session.lastUsedAt !== null
                  ? ` · ${t.lastUsed(formatZenRelativeTime(locale, session.lastUsedAt))}`
                  : ""}
                {session.ip !== null ? ` · ${session.ip}` : ""}
              </span>
            </span>
            {session.twoFactor ? <Badge variant="outline">{t.withTwoFactor}</Badge> : null}
            {session.current ? (
              <Badge>{t.thisSession}</Badge>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void props
                    .call("sessions.revoke", { sessionId: session.id })
                    .then(refresh, (cause: unknown) =>
                      toastManager.add({
                        type: "error",
                        title: t.signOutSession,
                        description: hubErrorMessage(cause),
                      }),
                    )
                }
              >
                {t.signOutSession}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function DevicesPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly call: HubCall;
}) {
  const t = useZenText(hubText);
  const { data, refresh } = useHubQuery<{ devices: ReadonlyArray<ZenHubDevice> }>(
    props.environmentId,
    "devices.list",
  );
  const { data: trusted, refresh: refreshTrusted } = useHubQuery<{
    canDecide?: boolean;
    devices: ReadonlyArray<{
      userId: string;
      keyId: string;
      via: string;
      at: string;
      label: string | null;
      pending?: boolean;
      fingerprint?: string;
      approvedBy?: string | null;
    }>;
  }>(props.environmentId, "devices.trusted");
  const live = (data?.devices ?? []).filter((device) => !device.revoked);
  const waiting = (trusted?.devices ?? []).filter((device) => device.pending === true);
  const pinned = (trusted?.devices ?? []).filter((device) => device.pending !== true);
  const decide = (device: { userId: string; keyId: string }, approve: boolean) =>
    void props
      .call("devices.decide", { userId: device.userId, keyId: device.keyId, approve })
      .then(refreshTrusted, (cause: unknown) =>
        toastManager.add({
          type: "error",
          title: approve ? t.approve : t.rejectDevice,
          description: hubErrorMessage(cause),
        }),
      );
  return (
    <Panel title={t.devicesTitle} icon={<KeyRoundIcon className="size-4" />}>
      <p className="text-muted-foreground text-sm">{t.devicesHint}</p>
      <ul className="flex flex-col divide-y text-sm" data-testid="devices-list">
        {live.map((device) => (
          <li key={device.keyId} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              {device.label}{" "}
              <code className="text-muted-foreground text-xs">{device.keyId.slice(0, 8)}</code>
              {device.fingerprint ? (
                <span className="block text-muted-foreground text-xs">
                  {t.fingerprint}: <code>{device.fingerprint}</code>
                </span>
              ) : null}
            </span>
            {device.current ? (
              <Badge>{t.thisDevice}</Badge>
            ) : device.certifiedBy.length > 0 ? (
              <Badge variant="outline">{t.approved}</Badge>
            ) : (
              <>
                <Badge variant="outline">{t.notApproved}</Badge>
                <Button
                  size="xs"
                  onClick={() =>
                    void props
                      .call("devices.approve", { keyId: device.keyId })
                      .then(refresh, (cause: unknown) =>
                        toastManager.add({
                          type: "error",
                          title: t.approve,
                          description: hubErrorMessage(cause),
                        }),
                      )
                  }
                >
                  {t.approve}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {waiting.length > 0 ? (
        <>
          <h3 className="mt-2 font-medium text-sm">{t.pendingTitle}</h3>
          <p className="text-muted-foreground text-xs">{t.pendingHint}</p>
          <ul className="flex flex-col divide-y text-sm" data-testid="pending-devices">
            {waiting.map((device) => (
              <li key={device.keyId} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="flex-1">
                  {device.label ?? device.userId}
                  <span className="block text-muted-foreground text-xs">
                    {t.fingerprint}:{" "}
                    <code data-testid="pending-fingerprint">{device.fingerprint}</code>
                  </span>
                </span>
                <Badge variant="outline">{t.pendingBadge}</Badge>
                {trusted?.canDecide === true ? (
                  <>
                    <Button size="xs" onClick={() => decide(device, true)}>
                      {t.approve}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => decide(device, false)}>
                      {t.rejectDevice}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {trusted?.canDecide === true ? null : (
            <p className="text-muted-foreground text-xs">{t.onlyManagersDecide}</p>
          )}
        </>
      ) : null}
      <h3 className="mt-2 font-medium text-sm">{t.trustedTitle}</h3>
      <p className="text-muted-foreground text-xs">{t.trustedHint}</p>
      <ul className="flex flex-col divide-y text-sm" data-testid="trusted-devices">
        {pinned.map((device) => (
          <li key={device.keyId} className="flex items-center gap-2 py-1.5">
            <span className="flex-1">
              {device.label ?? device.userId}{" "}
              <code className="text-muted-foreground text-xs">{device.keyId.slice(0, 8)}</code>
            </span>
            <Badge variant="outline">
              {device.via === "own"
                ? t.viaOwn
                : device.via === "approved"
                  ? t.viaApproved
                  : device.approvedBy
                    ? t.approvedByWho(device.approvedBy)
                    : t.viaFirstUse}
            </Badge>
            {device.via !== "own" ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void props
                    .call("devices.untrust", { userId: device.userId, keyId: device.keyId })
                    .then(refreshTrusted)
                }
              >
                {t.remove}
              </Button>
            ) : null}
          </li>
        ))}
        {pinned.length === 0 ? <li className="text-muted-foreground">{t.noTrusted}</li> : null}
      </ul>
    </Panel>
  );
}
