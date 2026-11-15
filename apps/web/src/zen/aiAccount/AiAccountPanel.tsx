// Zen Staff: the AI accounts found on this computer, each asked before use ("I found the Claude
// alex@firma.example (Claude Max) account on this computer. Shall I use it?" Use it / Connect another).
// Shown in the Office onboarding, in Settings > General, as a banner on the Office home until one
// is confirmed, and as a line on each AI employee. ZEN.md, "AI account".
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, KeyRoundIcon, XIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { AiConnectPanel } from "../aiConnect/AiConnectPanel";
import { useAiConnectDialog } from "../aiConnect/aiConnectClient";
import { aiConnectText } from "../aiConnect/aiConnect.i18n";
import { useZenText } from "../i18n/zenI18n";
import { useZenOffice } from "../office/useZenEdition";
import { aiAccountText } from "./aiAccount.i18n";
import {
  type AiAccount,
  aiAccountSignature,
  aiAccountTitle,
  aiAccountsOf,
  unconfirmedAccounts,
} from "./aiAccountModel";
import {
  confirmAiAccount,
  dismissAiAccountBanner,
  forgetAiAccount,
  useAiAccountBannerDismissed,
  useConfirmedAiAccounts,
} from "./aiAccountStore";

export function useAiAccounts(environmentId: EnvironmentId | null): {
  readonly accounts: ReadonlyArray<AiAccount>;
  readonly loading: boolean;
} {
  const providers = useAtomValue(
    serverEnvironment.providersValueAtom(environmentId ?? ("" as EnvironmentId)),
  );
  return { accounts: aiAccountsOf(providers), loading: environmentId !== null && !providers };
}

function KindBadge(props: { readonly account: AiAccount }) {
  const t = useZenText(aiAccountText);
  if (props.account.kind === "unknown") return null;
  return (
    <Badge variant={props.account.kind === "personal" ? "secondary" : "info"} size="sm">
      {t.kind[props.account.kind]}
    </Badge>
  );
}

/** One account row: found (ask), in use, not connected or not installed. */
function AccountRow(props: { readonly account: AiAccount; readonly confirmed: boolean }) {
  const t = useZenText(aiAccountText);
  const navigate = useNavigate();
  const office = useZenOffice();
  const showConnect = useAiConnectDialog((state) => state.show);
  const { account } = props;
  // Office never sends people to the terminal-based provider settings: "Connect your AI" instead.
  const openProviders = () =>
    office ? showConnect() : void navigate({ to: "/settings/providers" });
  const title = aiAccountTitle(account);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center"
      data-zen-ai-account={account.instanceId}
    >
      <KeyRoundIcon className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm" data-zen-no-translate>
        {account.state === "signed-in" ? (
          <>
            <span className="flex flex-wrap items-center gap-2">
              {props.confirmed ? (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CheckIcon className="size-4 text-success-foreground" aria-hidden />
                  {t.inUse(title)}
                </span>
              ) : (
                <span className="font-medium">{t.found(title)}</span>
              )}
              <KindBadge account={account} />
            </span>
          </>
        ) : account.state === "signed-out" ? (
          <span>{t.notSignedIn(account.service)}</span>
        ) : account.state === "checking" ? (
          <Skeleton className="h-4 w-56" />
        ) : (
          <span className="text-muted-foreground">{t.notInstalled(account.service)}</span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {account.state === "signed-in" && !props.confirmed ? (
          <Button size="sm" onClick={() => confirmAiAccount(aiAccountSignature(account))}>
            {t.use}
          </Button>
        ) : null}
        {account.state === "signed-in" && props.confirmed ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => forgetAiAccount(aiAccountSignature(account))}
          >
            {t.stopUsing}
          </Button>
        ) : null}
        {account.state === "signed-in" ? (
          <Button size="sm" variant="outline" onClick={openProviders}>
            {t.connectOther}
          </Button>
        ) : account.state === "signed-out" ? (
          <Button size="sm" variant="outline" onClick={openProviders}>
            {t.connect(account.service)}
          </Button>
        ) : account.state === "not-installed" ? (
          <Button size="sm" variant="outline" onClick={openProviders}>
            {t.install}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const CONNECT_CARD_DRIVERS = new Set(["claudeAgent", "codex", "antigravity"]);

/** Every AI account on the machine, each with its own question. */
export function AiAccountList(props: {
  readonly environmentId: EnvironmentId | null;
  /** Only the accounts the "Connect your AI" cards do not already show. */
  readonly othersOnly?: boolean;
}) {
  const t = useZenText(aiAccountText);
  const { accounts: all, loading } = useAiAccounts(props.environmentId);
  const confirmed = useConfirmedAiAccounts();
  const accounts = props.othersOnly
    ? all.filter((account) => !CONNECT_CARD_DRIVERS.has(account.driver))
    : all;
  if (props.othersOnly && (loading || accounts.length === 0)) return null;
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-label={t.checking}>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-zen-ai-accounts>
      {accounts.map((account) => (
        <AccountRow
          key={account.instanceId}
          account={account}
          confirmed={confirmed.has(aiAccountSignature(account))}
        />
      ))}
    </div>
  );
}

/** Settings > General: "AI accounts" (connect, confirm). Rendered by ZenEditionSettingsSection. */
export function ZenAiAccountSettingsSection() {
  const t = useZenText(aiAccountText);
  const connect = useZenText(aiConnectText);
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SettingsSection title={t.accountsTitle}>
      <SettingsRow title={connect.title} description={connect.intro}>
        <div className="flex w-full flex-col gap-2 pt-2" data-zen-ai-accounts-settings>
          <AiConnectPanel environmentId={environmentId} />
          <AiAccountList environmentId={environmentId} othersOnly />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * Office home, no AI account at all yet (the AI staff cannot work): one compact line that opens
 * "Conectează-ți AI-ul". Not dismissible: without an account nothing runs.
 */
function ZenAiConnectBanner() {
  const t = useZenText(aiConnectText);
  const show = useAiConnectDialog((state) => state.show);
  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-sm"
      aria-label={t.bannerTitle}
      data-zen-ai-connect-banner
    >
      <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t.bannerTitle}</span>{" "}
        <span className="text-muted-foreground">{t.bannerBody}</span>
      </span>
      <Button size="sm" onClick={show} data-zen-ai-connect-open>
        {t.bannerButton}
      </Button>
    </section>
  );
}

/**
 * Office home: one compact line while a found account is not confirmed and none is in use
 * ("Folosim contul Claude alex@… (Ultra) de pe acest calculator? Da · Alt cont"). After a choice
 * it is gone; Settings > General keeps the full list.
 */
export function ZenAiAccountBanner() {
  const t = useZenText(aiAccountText);
  const navigate = useNavigate();
  const office = useZenOffice();
  const showConnect = useAiConnectDialog((state) => state.show);
  const environmentId = usePrimaryEnvironmentId();
  const { accounts } = useAiAccounts(environmentId);
  const confirmed = useConfirmedAiAccounts();
  const dismissed = useAiAccountBannerDismissed();
  const inUse = accounts.some(
    (account) => account.state === "signed-in" && confirmed.has(aiAccountSignature(account)),
  );
  const first = unconfirmedAccounts(accounts, confirmed)[0];
  const anySignedIn = accounts.some((account) => account.state === "signed-in");
  const loaded = accounts.length > 0 && accounts.every((account) => account.state !== "checking");
  if (!inUse && !anySignedIn && loaded) return <ZenAiConnectBanner />;
  if (inUse || dismissed || first === undefined) return null;
  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-sm"
      aria-label={t.bannerTitle}
      data-zen-ai-account-banner
    >
      <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1" data-zen-no-translate>
        {t.bannerAsk(aiAccountTitle(first))}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={() => confirmAiAccount(aiAccountSignature(first))}>
          {t.bannerYes}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            dismissAiAccountBanner();
            // Office: "Conectează-ți AI-ul", never the terminal-based provider settings.
            if (office) showConnect();
            else void navigate({ to: "/settings/providers" });
          }}
        >
          {t.bannerOther}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t.bannerDismiss}
          onClick={dismissAiAccountBanner}
        >
          <XIcon />
        </Button>
      </span>
    </section>
  );
}
