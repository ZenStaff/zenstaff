// Zen Staff chat integrations page (/chat-integrations, "Integrări chat"): connections to chat
// platforms with a guided install each, AI staff, channel bindings, people, scheduled reports,
// settings and the activity log. The browser never sees a token: it sends each one once to its
// own server, which keeps it in the company server's vault. See ZEN.md.
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_CHAT_PLATFORM_INFO,
  ZEN_CHAT_PLATFORMS,
  type ZenChatConnectionView,
  type ZenChatPlatform,
  type ZenChatStatus,
} from "@t3tools/contracts/zenChat";
import { LockIcon, PlugIcon, PlusIcon, RefreshCwIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SidebarInset } from "../../components/ui/sidebar";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { chatText } from "./chat.i18n";
import { useChatCall, useChatQuery, type ChatCall } from "./chatClient";
import { CHAT_TABS, isChatTab, stateTone, type ChatTab } from "./chatModel";
import { EmailApprovalsTab } from "./EmailApprovals";
import {
  ActivityTab,
  AgentsTab,
  ChannelsTab,
  PeopleTab,
  ReportsTab,
  SettingsTab,
} from "./ChatTabs";
import { Section, notifyError, notifySuccess } from "./chatUi";
import { ConnectionWizard } from "./ConnectionWizard";

export interface ChatIntegrationsSearch {
  readonly tab?: ChatTab;
}

export function ChatIntegrationsPage({ search }: { readonly search: ChatIntegrationsSearch }) {
  const t = useZenText(chatText);
  const { environmentId, call } = useChatCall();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel={t.title}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{t.title}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide" className="gap-4">
            {environmentId === null ? (
              <p className="text-muted-foreground text-sm">{t.noMachine}</p>
            ) : (
              <ChatTabsView environmentId={environmentId} call={call} search={search} />
            )}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function ChatTabsView(props: {
  readonly environmentId: EnvironmentId;
  readonly call: ChatCall;
  readonly search: ChatIntegrationsSearch;
}) {
  const t = useZenText(chatText);
  const navigate = useNavigate();
  const {
    data: status,
    error,
    refresh,
  } = useChatQuery<ZenChatStatus>(props.environmentId, "status");
  const tab: ChatTab = props.search.tab ?? "connections";
  const canManage = status?.access.canManage === true;
  return (
    <>
      <p className="text-muted-foreground text-sm">{t.intro}</p>
      <ToggleGroup
        value={[tab]}
        onValueChange={(value) => {
          const next = value[0];
          if (isChatTab(next)) {
            void navigate({ to: "/chat-integrations", search: { tab: next }, replace: true });
          }
        }}
        aria-label={t.title}
      >
        {CHAT_TABS.map((item) => (
          <Toggle key={item} value={item}>
            {t.tabs[item]}
          </Toggle>
        ))}
      </ToggleGroup>
      {error !== null ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      {status === null ? (
        error === null ? (
          <p className="text-muted-foreground text-sm">{t.loading}</p>
        ) : null
      ) : (
        <>
          {status.access.lock !== null ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/8 p-3 text-sm"
            >
              <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{status.access.lock}</span>
            </div>
          ) : !canManage ? (
            <p className="text-muted-foreground text-xs">{t.readOnly}</p>
          ) : null}
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <ServerIcon className="size-3.5" aria-hidden />
            {status.access.isRunner ? t.runner(status.access.runnerSource) : t.notRunner}
            <span aria-hidden>·</span>
            {t.summary(status.connections.length, status.conversations, status.pendingApprovals)}
          </p>
          {tab === "connections" ? (
            <ConnectionsTab
              environmentId={props.environmentId}
              status={status}
              call={props.call}
              refresh={refresh}
              canManage={canManage}
            />
          ) : tab === "agents" ? (
            <AgentsTab
              status={status}
              call={props.call}
              refresh={refresh}
              canManage={canManage}
              environmentId={props.environmentId}
            />
          ) : tab === "channels" ? (
            <ChannelsTab
              status={status}
              call={props.call}
              refresh={refresh}
              canManage={canManage}
            />
          ) : tab === "people" ? (
            <PeopleTab status={status} call={props.call} refresh={refresh} canManage={canManage} />
          ) : tab === "reports" ? (
            <ReportsTab status={status} call={props.call} refresh={refresh} canManage={canManage} />
          ) : tab === "settings" ? (
            <SettingsTab
              status={status}
              call={props.call}
              refresh={refresh}
              canManage={canManage}
            />
          ) : tab === "approvals" ? (
            <EmailApprovalsTab
              environmentId={props.environmentId}
              status={status}
              call={props.call}
            />
          ) : (
            <ActivityTab environmentId={props.environmentId} />
          )}
        </>
      )}
    </>
  );
}

function ConnectionsTab(props: {
  readonly environmentId: EnvironmentId;
  readonly status: ZenChatStatus;
  readonly call: ChatCall;
  readonly refresh: () => void;
  readonly canManage: boolean;
}) {
  const t = useZenText(chatText);
  const locale = useZenLocale();
  const [wizard, setWizard] = useState<{
    platform: ZenChatPlatform;
    connection: ZenChatConnectionView | null;
  } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const act = async (
    op: "connection.restart" | "connection.remove" | "connection.save",
    input: Record<string, unknown>,
  ) => {
    try {
      await props.call(op, input);
      if (op === "connection.remove") notifySuccess(t.removed);
      props.refresh();
    } catch (error) {
      notifyError(t.failed, error);
    }
  };

  const test = async (connection: ZenChatConnectionView) => {
    setTesting(connection.id);
    try {
      const result = await props.call<{ ok: boolean; detail: string }>("connection.test", {
        connectionId: connection.id,
      });
      if (result.ok) notifySuccess(t.testOk, result.detail);
      else notifyError(t.failed, new Error(result.detail));
      props.refresh();
      setTesting(null);
    } catch (error) {
      notifyError(t.failed, error);
      setTesting(null);
    }
  };

  return (
    <>
      <Section title={t.addConnection} icon={<PlusIcon className="size-4" />}>
        <div className="flex flex-wrap gap-2">
          {ZEN_CHAT_PLATFORMS.map((platform) => (
            <Button
              key={platform}
              size="sm"
              variant="outline"
              disabled={!props.canManage}
              onClick={() => setWizard({ platform, connection: null })}
            >
              <PlugIcon className="size-4" />
              {ZEN_CHAT_PLATFORM_INFO[platform].name}
            </Button>
          ))}
        </div>
      </Section>
      {props.status.connections.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noConnections}</p>
      ) : (
        props.status.connections.map((connection) => {
          const info = ZEN_CHAT_PLATFORM_INFO[connection.platform];
          const tone = stateTone(connection.state);
          return (
            <Section
              key={connection.id}
              title={connection.name}
              icon={<PlugIcon className="size-4" />}
              actions={
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setWizard({ platform: connection.platform, connection })}
                  >
                    {t.setUp}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={testing === connection.id}
                    onClick={() => void test(connection)}
                  >
                    {testing === connection.id ? t.testing : t.test}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!props.canManage}
                    onClick={() => void act("connection.restart", { connectionId: connection.id })}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    {t.restart}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!props.canManage}
                    onClick={() =>
                      void act("connection.save", {
                        connection: {
                          id: connection.id,
                          platform: connection.platform,
                          name: connection.name,
                          scope: connection.scope,
                          enabled: !connection.enabled,
                          workspaceAllowlist: connection.workspaceAllowlist,
                          channelAllowlist: connection.channelAllowlist,
                          settings: connection.settings,
                        },
                      })
                    }
                  >
                    {connection.enabled ? t.disable : t.enable}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!props.canManage}
                    onClick={() => {
                      if (window.confirm(t.confirmRemove(connection.name))) {
                        void act("connection.remove", { id: connection.id });
                      }
                    }}
                  >
                    {t.remove}
                  </Button>
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{info.name}</Badge>
                <Badge variant="outline">
                  {connection.scope === "company" ? t.scopeCompany : t.scopePersonal}
                </Badge>
                <Badge
                  variant={
                    tone === "ok"
                      ? "success"
                      : tone === "error"
                        ? "error"
                        : tone === "wait"
                          ? "warning"
                          : "outline"
                  }
                >
                  {t.states[connection.state]}
                </Badge>
                <span className="text-muted-foreground">{t.transport(info.transportName)}</span>
                {connection.lastEventAt ? (
                  <span className="text-muted-foreground">
                    {t.lastEvent(formatZenRelativeTime(locale, connection.lastEventAt))}
                  </span>
                ) : null}
              </div>
              {connection.detail ? (
                <p className="text-muted-foreground text-xs">{connection.detail}</p>
              ) : null}
              {connection.webhookUrl ? (
                <p className="text-xs">
                  {t.webhookUrl}:{" "}
                  <code className="break-all font-mono">{connection.webhookUrl}</code>
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {t.workspaceAllowlist}:{" "}
                <span className="font-mono">{connection.workspaceAllowlist.join(", ") || "-"}</span>
              </p>
            </Section>
          );
        })
      )}
      {wizard !== null ? (
        <ConnectionWizard
          key={wizard.connection?.id ?? wizard.platform}
          platform={wizard.platform}
          connection={wizard.connection}
          environmentId={props.environmentId}
          canManage={props.canManage}
          call={props.call}
          onChanged={props.refresh}
          onClose={() => setWizard(null)}
        />
      ) : null}
    </>
  );
}
