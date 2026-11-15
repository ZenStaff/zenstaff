// Zen Staff hub page (/hub): sign in to a hub, companies and members, invitations, this machine as
// a company runner, sharing chats, chats shared with you and hand-overs. See docs/zen-hub.md.
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZenHubCompanyDetail,
  ZenHubRole,
  ZenHubShare,
  ZenHubStatus,
} from "@t3tools/contracts/zenHub";
import { AsyncResult } from "effect/reactivity";
import {
  BuildingIcon,
  CopyIcon,
  FingerprintIcon,
  LogOutIcon,
  MailIcon,
  Share2Icon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ZEN_HUB_DEFAULT_URL } from "@t3tools/contracts/zen";
import { isElectron } from "~/env";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { SidebarInset } from "../../components/ui/sidebar";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { companiesListAtom } from "../companies/companiesState";
import { hubErrorMessage, useHubCall, useHubQuery, type HubCall } from "./hubClient";
import { CompanyTodayCard } from "./CompanyTodayCard";
import { SharedChatView } from "./SharedChatView";
import {
  AcademyTeamSection,
  AuditSection,
  GrantsSection,
  MemorySettingsSection,
  NotificationsSection,
} from "./CompanyAdmin";
import { hubText } from "./hub.i18n";
import {
  DevicesPanel,
  PasskeysPanel,
  RecoveryCodes,
  SessionsPanel,
  TwoFactorPanel,
} from "./HubSecurity";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { useCopyTarget } from "./useCopyTarget";
import { CompanyRoles } from "./CompanyRoles";
import { CompanyAiSection, CompanyServerSection } from "./CompanyServer";
import { companyHasApiKey } from "./companyAiRule";
import { companyServerText } from "./companyServer.i18n";
import { securityText } from "./security.i18n";
import { companyGates } from "./permissionGates";
import { ZenNativeSelect } from "../ui/ZenSelect";
import { WhatOwnersSee } from "./WhatOwnersSee";
import { useOfficeCompany } from "../office/useOfficeCompany";

export type HubTab = "account" | "team" | "share" | "shared";
export interface HubSearch {
  readonly tab?: HubTab;
  readonly share?: string;
}

function notifyError(title: string, cause: unknown) {
  toastManager.add({ type: "error", title, description: hubErrorMessage(cause) });
}

function NativeSelect(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <ZenNativeSelect
      aria-label={props.label}
      className={cn(
        "h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground",
        props.className,
      )}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.children}
    </ZenNativeSelect>
  );
}

function Section(props: {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 font-medium text-sm">
        {props.icon}
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export function HubPage({ search }: { readonly search: HubSearch }) {
  const navigate = useNavigate();
  const { environmentId, call } = useHubCall();
  const t = useZenText(hubText);
  const setSearch = (next: HubSearch) => void navigate({ to: "/hub", search: next, replace: true });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel={t.teamBreadcrumb}>
            <WorkspaceBreadcrumbItem current={search.share === undefined}>
              <h1 className="truncate">{t.team}</h1>
            </WorkspaceBreadcrumbItem>
            {search.share !== undefined ? (
              <WorkspaceBreadcrumbItem current>{t.sharedChat}</WorkspaceBreadcrumbItem>
            ) : null}
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide" className="gap-4">
            {environmentId === null ? (
              <p className="text-muted-foreground text-sm">{t.noMachine}</p>
            ) : search.share !== undefined ? (
              <SharedChatView
                shareId={search.share}
                call={call}
                environmentId={environmentId}
                onBack={() => setSearch({ tab: "shared" })}
              />
            ) : (
              <HubTabs
                environmentId={environmentId}
                call={call}
                search={search}
                setSearch={setSearch}
              />
            )}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function HubTabs(props: {
  readonly environmentId: EnvironmentId;
  readonly call: HubCall;
  readonly search: HubSearch;
  readonly setSearch: (next: HubSearch) => void;
}) {
  const { environmentId, call, search, setSearch } = props;
  const t = useZenText(hubText);
  const { data: status, error, refresh } = useHubQuery<ZenHubStatus>(environmentId, "status");
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<ReadonlyArray<string> | null>(null);
  const tab: HubTab = search.tab ?? (status?.signedIn ? "shared" : "account");
  return (
    <>
      <ToggleGroup
        value={[tab]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "account" || next === "team" || next === "share" || next === "shared") {
            setSearch({ tab: next });
          }
        }}
        aria-label={t.tabsLabel}
      >
        <Toggle value="shared">
          {t.tabShared}
          {(status?.unreadNotifications ?? 0) > 0 ? (
            <Badge className="ml-1" data-testid="tab-unread">
              {status?.unreadNotifications}
            </Badge>
          ) : null}
        </Toggle>
        <Toggle value="share">{t.tabShare}</Toggle>
        <Toggle value="team">{t.tabTeam}</Toggle>
        <Toggle value="account">{t.tabAccount}</Toggle>
      </ToggleGroup>
      {error !== null ? <p className="text-destructive text-sm">{error}</p> : null}
      {status?.error ? (
        <p className="text-muted-foreground text-sm">{t.hubError(status.error)}</p>
      ) : null}
      {newRecoveryCodes !== null ? <RecoveryCodes codes={newRecoveryCodes} /> : null}
      {/* Shown by itself only when signed in, past two-factor, and in a hub company. */}
      {tab !== "account" ? <CompanyTodayCard environmentId={environmentId} /> : null}
      {status !== null &&
      status.signedIn &&
      status.twoFactor != null &&
      status.twoFactor.gate !== "ok" ? (
        <TwoFactorPanel
          status={status.twoFactor}
          call={call}
          refresh={refresh}
          gate
          onRecoveryCodes={setNewRecoveryCodes}
        />
      ) : status === null ? (
        <p className="text-muted-foreground text-sm">{t.loading}</p>
      ) : tab === "account" || !status.signedIn ? (
        <AccountTab
          key={String(status.signedIn)}
          status={status}
          call={call}
          refresh={refresh}
          environmentId={environmentId}
        />
      ) : tab === "team" ? (
        <TeamTab status={status} call={call} refresh={refresh} environmentId={environmentId} />
      ) : tab === "share" ? (
        <ShareTab status={status} call={call} environmentId={environmentId} />
      ) : (
        <SharedTab
          call={call}
          environmentId={environmentId}
          open={(shareId) => setSearch({ share: shareId })}
          notifyEmail={status.preferences?.notifyEmail ?? true}
        />
      )}
    </>
  );
}

function AccountTab(props: {
  readonly status: ZenHubStatus;
  readonly call: HubCall;
  readonly refresh: () => void;
  readonly environmentId: EnvironmentId;
}) {
  const { status, call, refresh } = props;
  const t = useZenText(hubText);
  const [hubUrl, setHubUrl] = useState(status.hubUrl ?? ZEN_HUB_DEFAULT_URL);
  const [email, setEmail] = useState("");
  const [machineName, setMachineName] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(status.user?.name ?? "");
  const [busy, setBusy] = useState(false);

  // A magic link opened on any device finishes the sign-in here.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer asks the hub whether the e-mailed link was opened
  useEffect(() => {
    if (status.signedIn) return;
    const timer = setInterval(() => {
      call<{ signedIn: boolean }>("signIn.poll").then(
        (result) => {
          if (result.signedIn) refresh();
        },
        () => undefined,
      );
    }, 3000);
    return () => clearInterval(timer);
  }, [call, refresh, status.signedIn]);

  const act = async (title: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      refresh();
    } catch (cause) {
      notifyError(title, cause);
    }
    setBusy(false);
  };

  if (status.signedIn && status.user !== null) {
    return (
      <div className="flex flex-col gap-4">
        <Section title={t.hubAccount} icon={<UsersIcon className="size-4" />}>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t.hubLabel}</dt>
            <dd data-testid="hub-url">{status.hubUrl}</dd>
            <dt className="text-muted-foreground">{t.signedInAs}</dt>
            <dd data-testid="hub-account">
              {status.user.name} ({status.user.email})
            </dd>
            <dt className="text-muted-foreground">{t.thisMachine}</dt>
            <dd>
              {status.environment?.name}{" "}
              <Badge variant={status.environment?.connected ? "default" : "outline"}>
                {status.environment?.connected ? t.connected : t.offline}
              </Badge>
            </dd>
          </dl>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act(t.couldNotRename, () => call("profile.setName", { name }));
            }}
          >
            <Input
              aria-label={t.yourName}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" variant="outline" size="sm" disabled={busy || name.trim() === ""}>
              {t.saveName}
            </Button>
          </form>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void act(t.couldNotSignOut, () => call("signOut"))}
            >
              <LogOutIcon />
              {t.signOutHub}
            </Button>
          </div>
        </Section>
        {status.twoFactor != null ? (
          <TwoFactorPanel status={status.twoFactor} call={call} refresh={refresh} />
        ) : null}
        {status.environment !== null ? (
          <>
            <PasskeysPanel
              environmentId={props.environmentId}
              call={call}
              twoFactorRequired={status.twoFactor?.required === true}
            />
            <SessionsPanel environmentId={props.environmentId} call={call} />
            <DevicesPanel environmentId={props.environmentId} call={call} />
          </>
        ) : null}
        {status.companies.length > 0 ? <WhatOwnersSee /> : null}
        <p className="text-muted-foreground text-sm">{t.agentsNeverRun}</p>
      </div>
    );
  }

  return (
    <Section title={t.signInTitle} icon={<MailIcon className="size-4" />}>
      <p className="text-muted-foreground text-sm">{t.signInHint}</p>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void act(t.couldNotSendCode, () =>
            call("signIn.start", { hubUrl, email, ...(machineName.trim() ? { machineName } : {}) }),
          );
        }}
      >
        <Input
          aria-label={t.emailLabel}
          placeholder={t.emailPlaceholder}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          aria-label={t.machineName}
          placeholder={t.machineNameOptional}
          value={machineName}
          onChange={(event) => setMachineName(event.target.value)}
        />
        <Button type="submit" disabled={busy || hubUrl.trim() === "" || email.trim() === ""}>
          {t.sendCode}
        </Button>
        <details className="text-sm sm:col-span-2">
          <summary className="text-muted-foreground cursor-pointer">
            {t.hubUsing(hubHost(hubUrl))} · {t.hubAdvanced}
          </summary>
          <div className="mt-2 grid gap-1">
            <Input
              aria-label={t.hubAddress}
              value={hubUrl}
              onChange={(event) => setHubUrl(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t.hubAdvancedHint}</p>
          </div>
        </details>
      </form>
      {status.pendingEmail !== null ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(t.couldNotSignIn, () => call("signIn.verify", { code }));
          }}
        >
          <span className="text-sm">{t.codeSentTo(status.pendingEmail)}</span>
          <Input
            aria-label={t.signInCode}
            inputMode="numeric"
            className="max-w-32"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" disabled={busy || code.trim().length < 6}>
            {t.signIn}
          </Button>
        </form>
      ) : null}
      <OauthButtons hubUrl={hubUrl} machineName={machineName} call={call} onStarted={refresh} />
    </Section>
  );
}

/** The host shown on the collapsed hub-address line ("zenhub.zed-zen.com"). */
function hubHost(url: string): string {
  try {
    return new URL(url.trim()).host || url;
  } catch {
    return url.trim();
  }
}

/** Google / Microsoft sign-in when the hub has them configured, and passkeys. */
function OauthButtons(props: {
  readonly hubUrl: string;
  readonly machineName: string;
  readonly call: HubCall;
  readonly onStarted: () => void;
}) {
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const [providers, setProviders] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [passkeys, setPasskeys] = useState(false);
  const [started, setStarted] = useState(false);
  const { call, hubUrl } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the typed hub which sign-in methods it offers
  useEffect(() => {
    if (hubUrl.trim() === "") return;
    const timer = setTimeout(() => {
      call<{ providers: ReadonlyArray<{ id: string; name: string }>; passkeys?: boolean }>(
        "signIn.providers",
        { hubUrl },
      ).then(
        (result) => {
          setProviders(result.providers);
          setPasskeys(result.passkeys === true);
        },
        () => {
          setProviders([]);
          setPasskeys(false);
        },
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [call, hubUrl]);
  if (providers.length === 0 && !passkeys) return null;
  const opened = (result: { url?: string }) => {
    if (result.url !== undefined) window.open(result.url, "_blank", "noopener");
    setStarted(true);
    props.onStarted();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="oauth-buttons">
      <span className="text-muted-foreground">{t.orSignInWith}</span>
      {providers.map((provider) => (
        <Button
          key={provider.id}
          size="sm"
          variant="outline"
          onClick={() =>
            void call<{ url?: string }>("signIn.oauth", {
              hubUrl,
              provider: provider.id,
              ...(props.machineName.trim() ? { machineName: props.machineName } : {}),
            }).then(opened, (cause: unknown) => notifyError(t.continueWith(provider.name), cause))
          }
        >
          {t.continueWith(provider.name)}
        </Button>
      ))}
      {passkeys ? (
        <Button
          size="sm"
          variant="outline"
          data-testid="passkey-sign-in"
          onClick={() =>
            void call<{ url?: string }>("signIn.passkey", {
              hubUrl,
              lang: locale,
              ...(props.machineName.trim() ? { machineName: props.machineName } : {}),
            }).then(opened, (cause: unknown) => notifyError(t.signInWithPasskey, cause))
          }
        >
          <FingerprintIcon />
          {t.signInWithPasskey}
        </Button>
      ) : null}
      {started ? <span className="text-muted-foreground">{t.openedBrowser}</span> : null}
    </div>
  );
}

function useLocalCompanies(environmentId: EnvironmentId) {
  const result = useAtomValue(companiesListAtom(environmentId));
  return AsyncResult.getOrElse(result, () => null);
}

function TeamTab(props: {
  readonly status: ZenHubStatus;
  readonly call: HubCall;
  readonly refresh: () => void;
  readonly environmentId: EnvironmentId;
}) {
  const { status, call, refresh } = props;
  const t = useZenText(hubText);
  const local = useLocalCompanies(props.environmentId);
  // Review P1-5: Echipă opens on the company chosen in the sidebar switcher; a company picked
  // here holds until the switcher changes.
  const { companyId: switcherLocal } = useOfficeCompany();
  const switcherHub = switcherLocal === null ? null : (status.links[switcherLocal] ?? null);
  const [picked, setPicked] = useState<{
    readonly forSwitcher: string | null;
    readonly id: string;
  } | null>(null);
  const selected = picked !== null && picked.forSwitcher === switcherHub ? picked.id : switcherHub;
  const setSelected = (id: string) => setPicked({ forSwitcher: switcherHub, id });
  const [newName, setNewName] = useState("");
  const [newLocal, setNewLocal] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const current =
    status.companies.find((company) => company.id === selected) ?? status.companies[0] ?? null;

  const act = async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
      refresh();
    } catch (cause) {
      notifyError(title, cause);
    }
  };

  const joinOrCreate = (
    <>
      <Section title={t.acceptInvitation} icon={<MailIcon className="size-4" />}>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(t.couldNotJoin, async () => {
              await call("invite.accept", { token: inviteLink });
              setInviteLink("");
            });
          }}
        >
          <Input
            aria-label={t.invitationLink}
            placeholder={t.pasteInvitation}
            value={inviteLink}
            onChange={(event) => setInviteLink(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={inviteLink.trim() === ""}>
            {t.join}
          </Button>
        </form>
      </Section>
      <Section title={t.createCompanyTitle} icon={<BuildingIcon className="size-4" />}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(t.couldNotCreateCompany, async () => {
              const created = await call<{ id: string }>("company.create", {
                name: newName,
                ...(newLocal !== "" ? { localCompanyId: newLocal } : {}),
              });
              setNewName("");
              setSelected(created.id);
            });
          }}
        >
          <Input
            aria-label={t.companyName}
            placeholder={t.companyName}
            className="max-w-64"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <NativeSelect
            label={t.linkToLocal}
            value={newLocal}
            onChange={(value) => {
              setNewLocal(value);
              const company = local?.companies.find((item) => item.id === value);
              if (company !== undefined && newName.trim() === "") setNewName(company.name);
            }}
          >
            <option value="">{t.noLocalCompany}</option>
            {local?.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {t.linkTo(company.name)}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" disabled={newName.trim() === ""}>
            {t.create}
          </Button>
        </form>
      </Section>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {status.invites.length > 0 ? (
        <Section title={t.invitationsTitle} icon={<MailIcon className="size-4" />}>
          {status.invites.map((invite) => (
            <div key={invite.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {t.inviteAs(invite.companyName, t.roles[invite.role] ?? invite.role)}
              </span>
              <Button
                size="sm"
                onClick={() =>
                  void act(t.couldNotJoin, () => call("invite.accept", { inviteId: invite.id }))
                }
              >
                {t.join}
              </Button>
            </div>
          ))}
        </Section>
      ) : null}
      {status.companies.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {status.companies.map((company) => (
            <Button
              key={company.id}
              size="sm"
              variant={company.id === current?.id ? "default" : "outline"}
              onClick={() => setSelected(company.id)}
            >
              {company.name}
              <span className="text-xs opacity-70">{t.roles[company.role] ?? company.role}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {current !== null ? (
        <CompanyPanel
          key={current.id}
          companyId={current.id}
          status={status}
          call={call}
          refresh={refresh}
          localCompanies={local?.companies ?? []}
          environmentId={props.environmentId}
        />
      ) : null}
      {/* Your company first; joining or creating another one is folded (review P1-14). */}
      {status.companies.length > 0 ? (
        <details className="rounded-xl border p-4" data-testid="more-companies">
          <summary className="cursor-pointer font-medium text-sm">{t.moreCompanies}</summary>
          <div className="mt-4 flex flex-col gap-4">{joinOrCreate}</div>
        </details>
      ) : (
        joinOrCreate
      )}
    </div>
  );
}

/** The company page, grouped: one group visible at a time. */
const COMPANY_SECTIONS = [
  "members",
  "roles",
  "server",
  "ai",
  "enterprise",
  "memory",
  "activity",
] as const;
type CompanySection = (typeof COMPANY_SECTIONS)[number];

function CompanyPanel(props: {
  readonly companyId: string;
  readonly status: ZenHubStatus;
  readonly call: HubCall;
  readonly refresh: () => void;
  readonly localCompanies: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly environmentId: EnvironmentId;
}) {
  const { companyId, status, call } = props;
  const t = useZenText(hubText);
  const ts = useZenText(securityText);
  const { data: detail, refresh: refreshDetail } = useHubQuery<ZenHubCompanyDetail>(
    props.environmentId,
    "company.get",
    { companyId },
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ZenHubRole>("member");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [section, setSection] = useState<CompanySection>("members");
  // Invitations need no company key: colleagues work with their own AI account. The key is only
  // for the company server to work for them (companyAiRule.ts); without it we just say so.
  const cs = useZenText(companyServerText);
  const noCompanyKey = detail !== null && !companyHasApiKey(detail);
  const reload = () => {
    refreshDetail();
    props.refresh();
  };
  const act = async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
      reload();
    } catch (cause) {
      notifyError(title, cause);
    }
  };
  if (detail === null) return <p className="text-muted-foreground text-sm">{t.loadingCompany}</p>;
  const manager = detail.role === "owner" || detail.role === "admin";
  // Hub v9: what my role allows here (the hub checks it again); older hubs send no access.
  const gates = companyGates(detail.access ?? status.access?.[companyId] ?? null, detail.role);
  const linkedLocal =
    Object.entries(status.links).find(([, hubId]) => hubId === companyId)?.[0] ?? "";

  return (
    <div className="flex flex-col gap-4" data-testid="company-panel">
      <ToggleGroup
        value={[section]}
        onValueChange={(value) => {
          const next = COMPANY_SECTIONS.find((entry) => entry === value[0]);
          if (next !== undefined) setSection(next);
        }}
        aria-label={t.companySectionsLabel}
        className="flex-wrap"
      >
        {COMPANY_SECTIONS.map((entry) => (
          <Toggle key={entry} value={entry}>
            {entry === "roles" ? ts.rolesSection : t.companySections[entry]}
          </Toggle>
        ))}
      </ToggleGroup>
      {section === "members" ? (
        <>
          <Section title={t.membersOf(detail.company.name)} icon={<UsersIcon className="size-4" />}>
            <ul className="flex flex-col divide-y text-sm" data-testid="members-list">
              {detail.members.map((member) => (
                <li key={member.userId} className="flex items-center gap-2 py-1.5">
                  <span className="flex-1">
                    {member.name} <span className="text-muted-foreground">{member.email}</span>
                  </span>
                  {manager && member.userId !== status.user?.id ? (
                    <>
                      <NativeSelect
                        label={t.roleOf(member.name)}
                        value={member.role}
                        onChange={(role) =>
                          void act(t.couldNotChangeRole, () =>
                            call("member.setRole", { companyId, userId: member.userId, role }),
                          )
                        }
                      >
                        {(["owner", "admin", "member", "guest"] as const).map((role) => (
                          <option key={role} value={role}>
                            {t.roles[role] ?? role}
                          </option>
                        ))}
                      </NativeSelect>
                      <Button
                        size="xs"
                        variant="ghost-destructive"
                        onClick={() =>
                          void act(t.couldNotRemove, () =>
                            call("member.remove", { companyId, userId: member.userId }),
                          )
                        }
                      >
                        {t.remove}
                      </Button>
                    </>
                  ) : (
                    <Badge variant="outline">{t.roles[member.role] ?? member.role}</Badge>
                  )}
                  {member.customRoleName ? (
                    <Badge data-testid="custom-role">{member.customRoleName}</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
          {gates.invite ? (
            <Section title={t.invite} icon={<MailIcon className="size-4" />}>
              {noCompanyKey ? (
                <div
                  className="flex flex-col items-start gap-2 rounded-md bg-muted/50 p-3 text-sm"
                  data-testid="invite-no-company-key"
                >
                  <p>{cs.inviteNoKey}</p>
                  <Button size="sm" variant="outline" onClick={() => setSection("ai")}>
                    {cs.addCompanyKey}
                  </Button>
                </div>
              ) : null}
              <fieldset className="contents">
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(t.couldNotInvite, async () => {
                      const invite = await call<{ link: string }>("invite.create", {
                        companyId,
                        role: inviteRole,
                        ...(inviteEmail.trim() ? { email: inviteEmail } : {}),
                      });
                      setLastLink(invite.link);
                      setInviteEmail("");
                    });
                  }}
                >
                  <Input
                    aria-label={t.inviteEmail}
                    placeholder={t.inviteEmailPlaceholder}
                    className="max-w-64"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                  <NativeSelect
                    label={t.inviteRole}
                    value={inviteRole}
                    onChange={(value) => setInviteRole(value as ZenHubRole)}
                  >
                    {(["member", "admin", "guest"] as const).map((role) => (
                      <option key={role} value={role}>
                        {t.roles[role] ?? role}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="submit" size="sm">
                    {t.invite}
                  </Button>
                </form>
              </fieldset>
              {lastLink !== null ? (
                <div className="flex items-center gap-2 text-sm">
                  <code className="truncate rounded bg-muted px-2 py-1" data-testid="invite-link">
                    {lastLink}
                  </code>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t.copyInviteLink}
                    onClick={() => void navigator.clipboard?.writeText(lastLink)}
                  >
                    <CopyIcon />
                  </Button>
                </div>
              ) : null}
              {detail.invites.length > 0 ? (
                <ul className="text-sm">
                  {detail.invites.map((invite) => (
                    <li key={invite.id} className="flex items-center gap-2 py-1">
                      <span className="flex-1">
                        {invite.email ?? t.linkInvitation} · {t.roles[invite.role] ?? invite.role} ·{" "}
                        {t.pending}
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void act(t.couldNotRevoke, () =>
                            call("invite.revoke", { companyId, inviteId: invite.id }),
                          )
                        }
                      >
                        {t.revoke}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ) : null}
          <Section title={t.localCompanyTitle} icon={<BuildingIcon className="size-4" />}>
            <p className="text-muted-foreground text-sm">{t.localCompanyHint}</p>
            <NativeSelect
              label={t.linkedLocal}
              value={linkedLocal}
              onChange={(value) =>
                void act(t.couldNotLink, async () => {
                  if (linkedLocal !== "")
                    await call("company.link", { localCompanyId: linkedLocal, hubCompanyId: null });
                  if (value !== "")
                    await call("company.link", { localCompanyId: value, hubCompanyId: companyId });
                })
              }
            >
              <option value="">{t.notLinked}</option>
              {props.localCompanies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </NativeSelect>
          </Section>
        </>
      ) : null}
      {section === "roles" ? (
        <Section title={ts.rolesTitle} icon={<UsersIcon className="size-4" />}>
          <CompanyRoles
            companyId={companyId}
            environmentId={props.environmentId}
            call={call}
            hubUrl={status.hubUrl}
            roleLabel={(role) => t.roles[role as ZenHubRole] ?? role}
          />
        </Section>
      ) : null}
      {section === "server" ? (
        <CompanyServerSection
          companyId={companyId}
          status={status}
          detail={detail}
          manager={manager}
          environmentId={props.environmentId}
          reload={reload}
        />
      ) : null}
      {section === "ai" ? (
        <CompanyAiSection
          companyId={companyId}
          status={status}
          detail={detail}
          manager={manager}
          environmentId={props.environmentId}
          reload={reload}
        />
      ) : null}
      {section === "enterprise" ? (
        <GrantsSection
          environmentId={props.environmentId}
          companyId={companyId}
          manager={manager}
          call={call}
        />
      ) : null}
      {section === "memory" ? (
        <MemorySettingsSection
          key={`${detail.settings?.memory.url ?? ""}:${String(detail.settings?.memory.saveConversations)}`}
          companyId={companyId}
          manager={manager}
          detail={detail}
          call={call}
          reload={reload}
        />
      ) : null}
      {section === "activity" ? (
        <>
          <AcademyTeamSection environmentId={props.environmentId} companyId={companyId} />
          {manager ? (
            <AuditSection environmentId={props.environmentId} companyId={companyId} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ShareTab(props: {
  readonly status: ZenHubStatus;
  readonly call: HubCall;
  readonly environmentId: EnvironmentId;
}) {
  const { status, call, environmentId } = props;
  const t = useZenText(hubText);
  const local = useLocalCompanies(environmentId);
  const shells = useThreadShells();
  const threads = shells
    .filter((thread) => thread.environmentId === environmentId && thread.archivedAt === null)
    .slice(0, 100);
  const { data: shareList, refresh: refreshShares } = useHubQuery<{
    shares: ReadonlyArray<ZenHubShare>;
  }>(environmentId, "shares.list", {}, { live: true });
  const mine = (shareList?.shares ?? []).filter((share) => share.mine);
  const kindOf = (projectId: string) => {
    const localCompany =
      local?.projectCompanies.find((entry) => entry.projectId === projectId)?.companyId ??
      "personal";
    const hubCompany = status.links[localCompany] ?? null;
    return {
      kind:
        hubCompany !== null && hubCompany === status.runnerCompanyId
          ? ("company" as const)
          : ("personal" as const),
      hubCompany,
    };
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        <b>{t.personalChats}</b> {t.personalChatsHint} <b>{t.companyChats}</b> {t.companyChatsHint}
      </p>
      {status.companies.length === 0 ? <p className="text-sm">{t.createOrJoinFirst}</p> : null}
      <Section title={t.yourChats} icon={<Share2Icon className="size-4" />}>
        <ul className="flex flex-col divide-y" data-testid="share-threads">
          {threads.map((thread) => (
            <ShareRow
              key={thread.id}
              threadId={thread.id}
              title={thread.title}
              {...kindOf(thread.projectId)}
              status={status}
              call={call}
              environmentId={environmentId}
              onShared={refreshShares}
            />
          ))}
          {threads.length === 0 ? (
            <li className="text-muted-foreground text-sm">{t.noChats}</li>
          ) : null}
        </ul>
      </Section>
      <Section title={t.sharedByYou} icon={<Share2Icon className="size-4" />}>
        <ul className="text-sm" data-testid="my-shares">
          {mine.map((share) => (
            <li key={share.id} className="flex items-center gap-2 py-1">
              <span className="flex-1">
                {share.title || t.untitledChat} ·{" "}
                {share.kind === "handover"
                  ? t.handOverTo(share.audienceName ?? "")
                  : `${t.shareKind[share.kind] ?? share.kind} · ${share.audienceName ?? t.everyoneIn(share.companyName)}`}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void call("share.revoke", { shareId: share.id }).then(
                    refreshShares,
                    (cause: unknown) => notifyError(t.couldNotStopSharing, cause),
                  )
                }
              >
                {t.stopSharing}
              </Button>
            </li>
          ))}
          {mine.length === 0 ? <li className="text-muted-foreground">{t.nothingShared}</li> : null}
        </ul>
      </Section>
    </div>
  );
}

function ShareRow(props: {
  readonly threadId: string;
  readonly title: string;
  readonly kind: "personal" | "company";
  readonly hubCompany: string | null;
  readonly status: ZenHubStatus;
  readonly call: HubCall;
  readonly environmentId: EnvironmentId;
  readonly onShared: () => void;
}) {
  const { status, call } = props;
  const t = useZenText(hubText);
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(props.hubCompany ?? status.companies[0]?.id ?? "");
  const [audience, setAudience] = useState("");
  const submit = async (handover: boolean) => {
    try {
      await call(handover ? "handover.create" : "share.create", {
        threadId: props.threadId,
        companyId,
        audienceUserId: audience === "" ? null : audience,
      });
      toastManager.add({
        type: "success",
        title: handover ? t.handoverSent : t.chatShared,
        description: handover
          ? t.handoverSentHint
          : props.kind === "company"
            ? t.companyShareHint
            : t.personalShareHint,
      });
      setOpen(false);
      props.onShared();
    } catch (cause) {
      notifyError(t.couldNotShare, cause);
    }
  };
  return (
    <li
      className="flex flex-col gap-2 py-2 text-sm"
      data-thread-title={props.title}
      data-thread-id={props.threadId}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate">{props.title}</span>
        <Badge variant={props.kind === "company" ? "info" : "outline"}>
          {props.kind === "company" ? t.companyChat : t.personalChat}
        </Badge>
        <Button
          size="xs"
          variant="outline"
          disabled={status.companies.length === 0}
          onClick={() => setOpen((value) => !value)}
        >
          {t.shareEllipsis}
        </Button>
      </div>
      {open ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
          <NativeSelect label={t.company} value={companyId} onChange={setCompanyId}>
            {status.companies
              .filter((company) => props.kind === "personal" || company.id === props.hubCompany)
              .map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
          </NativeSelect>
          <AudienceSelect
            environmentId={props.environmentId}
            companyId={companyId}
            selfId={status.user?.id ?? ""}
            value={audience}
            onChange={setAudience}
          />
          <Button size="xs" onClick={() => void submit(false)}>
            {t.share}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={audience === ""}
            onClick={() => void submit(true)}
          >
            {t.handOver}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function AudienceSelect(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly selfId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const { data } = useHubQuery<ZenHubCompanyDetail>(props.environmentId, "company.get", {
    companyId: props.companyId,
  });
  const t = useZenText(hubText);
  const members = (data?.members ?? []).filter((member) => member.userId !== props.selfId);
  return (
    <NativeSelect label={t.audience} value={props.value} onChange={props.onChange}>
      <option value="">{t.everyoneInCompany}</option>
      {members.map((member) => (
        <option key={member.userId} value={member.userId}>
          {member.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function SharedTab(props: {
  readonly call: HubCall;
  readonly environmentId: EnvironmentId;
  readonly open: (shareId: string) => void;
  readonly notifyEmail: boolean;
}) {
  const { call } = props;
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const target = useCopyTarget(props.environmentId);
  const navigate = useNavigate();
  const { data, refresh } = useHubQuery<{ shares: ReadonlyArray<ZenHubShare> }>(
    props.environmentId,
    "shares.list",
    {},
    { live: true },
  );
  const shares = data === null ? null : data.shares.filter((share) => !share.mine);
  if (shares === null) return <p className="text-muted-foreground text-sm">{t.loading}</p>;
  const handovers = shares.filter((share) => share.kind === "handover");
  const chats = shares.filter((share) => share.kind !== "handover");
  return (
    <div className="flex flex-col gap-4">
      <NotificationsSection
        environmentId={props.environmentId}
        call={call}
        open={props.open}
        notifyEmail={props.notifyEmail}
      />
      {handovers.length > 0 ? (
        <Section title={t.handoversTitle} icon={<Share2Icon className="size-4" />}>
          {handovers.map((share) => (
            <div key={share.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1">
                {t.handsOver(share.ownerName, share.title || t.untitledChat)}
              </span>
              {target.picker}
              <Button
                size="sm"
                disabled={target.selection === null}
                onClick={() =>
                  void (async () => {
                    try {
                      const result = await call<{ threadId: string }>("handover.accept", {
                        shareId: share.id,
                        ...target.selection,
                        language: locale,
                      });
                      await target.openThread(navigate, result.threadId);
                    } catch (cause) {
                      notifyError(t.couldNotTakeOver, cause);
                    }
                  })()
                }
              >
                {t.takeOver}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void call("handover.decline", { shareId: share.id }).then(refresh)}
              >
                {t.decline}
              </Button>
            </div>
          ))}
        </Section>
      ) : null}
      <Section title={t.sharedWithYouTitle} icon={<Share2Icon className="size-4" />}>
        <ul className="flex flex-col divide-y text-sm" data-testid="shared-with-me">
          {chats.map((share) => (
            <li key={share.id} className="flex items-center gap-2 py-2">
              <button
                type="button"
                className="flex-1 truncate text-left hover:underline"
                onClick={() => props.open(share.id)}
              >
                {share.title || t.untitledChat}
              </button>
              <span className="text-muted-foreground">
                {share.ownerName} · {share.companyName}
              </span>
              <Badge variant={share.kind === "company" ? "info" : "outline"}>
                {share.kind === "company" ? t.companyChatCanWrite : t.personalWatch}
              </Badge>
              <Badge variant={share.online ? "default" : "outline"}>
                {share.online ? t.online : t.offline}
              </Badge>
            </li>
          ))}
          {chats.length === 0 ? (
            <li className="text-muted-foreground">{t.nothingSharedWithYou}</li>
          ) : null}
        </ul>
      </Section>
    </div>
  );
}
