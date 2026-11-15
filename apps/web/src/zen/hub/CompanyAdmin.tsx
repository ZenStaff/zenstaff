// Zen Staff hub: what a company's owners and admins manage on the hub (the source of truth):
// Enterprise grants (signed by this device), company memory ("Not set" until an address is saved
// under Advanced), the runner's AI account, admin activity and Academy team progress. Members see
// the read-only parts. The company server and its AI account are in CompanyServer.tsx.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenHubCompanyDetail, ZenHubNotification } from "@t3tools/contracts/zenHub";
import {
  BellIcon,
  BrainIcon,
  GraduationCapIcon,
  HistoryIcon,
  LockKeyholeOpenIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { hubText } from "./hub.i18n";
import { hubErrorMessage, useHubQuery, type HubCall } from "./hubClient";
import { MemoryZonesAdmin } from "../memory/MemoryV4";

function Block(props: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
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

const fail = (title: string) => (cause: unknown) =>
  toastManager.add({ type: "error", title, description: hubErrorMessage(cause) });

interface Grant {
  readonly id: string;
  readonly packId: string;
  readonly kind: "use" | "install";
  readonly userEmail: string | null;
  readonly grantedByName: string;
  readonly createdAt: string;
}

export function GrantsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly manager: boolean;
  readonly call: HubCall;
}) {
  const t = useZenText(hubText);
  const { data, refresh } = useHubQuery<{ grants: ReadonlyArray<Grant> }>(
    props.environmentId,
    "grants.list",
    {
      companyId: props.companyId,
    },
  );
  const [packId, setPackId] = useState("");
  const [email, setEmail] = useState("");
  const grant = (kind: "use" | "install") =>
    void props
      .call("grants.set", {
        companyId: props.companyId,
        packId,
        kind,
        ...(kind === "use" ? { email } : {}),
      })
      .then(() => {
        setEmail("");
        refresh();
      }, fail(t.grantsTitle));
  return (
    <Block
      title={t.grantsTitle}
      icon={<LockKeyholeOpenIcon className="size-4" />}
      testId="grants-section"
    >
      <p className="text-muted-foreground text-sm">{t.grantsHint}</p>
      <ul className="flex flex-col divide-y text-sm" data-testid="grants-list">
        {(data?.grants ?? []).map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <code className="text-xs">{item.packId}</code>
            <span className="flex-1">
              {item.kind === "install" ? t.installApproved : t.unlockedFor(item.userEmail ?? "")}{" "}
              <span className="text-muted-foreground">{t.grantedBy(item.grantedByName)}</span>
            </span>
            {props.manager ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void props
                    .call("grants.revoke", { companyId: props.companyId, grantId: item.id })
                    .then(refresh, fail(t.revoke))
                }
              >
                {t.revoke}
              </Button>
            ) : null}
          </li>
        ))}
        {(data?.grants ?? []).length === 0 ? (
          <li className="text-muted-foreground">{t.noGrants}</li>
        ) : null}
      </ul>
      {props.manager ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t.packId}
            placeholder={t.packId}
            className="max-w-56"
            value={packId}
            onChange={(event) => setPackId(event.target.value)}
          />
          <Input
            aria-label={t.memberEmail}
            placeholder={t.memberEmail}
            className="max-w-56"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            size="sm"
            disabled={packId.trim() === "" || email.trim() === ""}
            onClick={() => grant("use")}
          >
            {t.unlock}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={packId.trim() === ""}
            onClick={() => grant("install")}
          >
            {t.approveInstall}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t.adminOnly}</p>
      )}
    </Block>
  );
}

export function MemorySettingsSection(props: {
  readonly companyId: string;
  readonly manager: boolean;
  readonly detail: ZenHubCompanyDetail;
  readonly call: HubCall;
  readonly reload: () => void;
}) {
  const t = useZenText(hubText);
  const current = props.detail.settings?.memory ?? { url: null, saveConversations: false };
  const hosted = props.detail.settings?.hosted ?? null;
  const [url, setUrl] = useState(current.url ?? "");
  const [save, setSave] = useState(current.saveConversations);
  const [activating, setActivating] = useState(false);
  const activate = () => {
    setActivating(true);
    void props
      .call("memoryHosted.activate", { companyId: props.companyId, saveConversations: true })
      .then(() => {
        toastManager.add({ type: "success", title: t.memoryHostedActivated });
        props.reload();
      }, fail(t.memorySettingsTitle))
      .finally(() => setActivating(false));
  };
  return (
    <Block
      title={t.memorySettingsTitle}
      icon={<BrainIcon className="size-4" />}
      testId="memory-settings-section"
    >
      <p className="text-muted-foreground text-sm">{t.memorySettingsHint}</p>
      {hosted?.available === true ? (
        hosted.active ? (
          <div className="flex flex-col gap-1 text-sm" data-testid="memory-hosted-active">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="success">{t.memoryHostedActive}</Badge>
              <span className="text-muted-foreground text-xs">{hosted.url}</span>
            </p>
            <p className="text-muted-foreground text-xs">{t.memoryHostedActiveHint}</p>
            {props.manager ? <MemoryZonesAdmin companyId={props.companyId} /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm" data-testid="memory-hosted-off">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t.memoryHostedOff}</Badge>
              <span className="text-muted-foreground">{t.memoryHostedOffHint}</span>
            </p>
            {current.url !== null ? <p className="text-xs">{t.memoryAt(current.url)}</p> : null}
            {props.manager ? (
              <Button size="sm" className="self-start" disabled={activating} onClick={activate}>
                {t.memoryHostedActivate}
              </Button>
            ) : (
              <span className="text-muted-foreground text-xs">{t.memoryHostedAdminOnly}</span>
            )}
          </div>
        )
      ) : current.url === null ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="memory-unset">
          <Badge variant="outline">{t.memoryUnset}</Badge>
          <span className="text-muted-foreground">{t.memoryUnsetHint}</span>
        </p>
      ) : (
        <p className="text-sm">{t.memoryAt(current.url)}</p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void props
            .call("settings.set", {
              companyId: props.companyId,
              memory: { url: url.trim() === "" ? null : url, saveConversations: save },
            })
            .then(() => {
              toastManager.add({ type: "success", title: t.saved });
              props.reload();
            }, fail(t.memorySettingsTitle));
        }}
      >
        <details className="text-sm" open={current.url !== null && hosted?.active !== true}>
          <summary className="cursor-pointer text-muted-foreground">{t.memoryAdvanced}</summary>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Input
              aria-label={t.memoryUrl}
              className="max-w-80"
              disabled={!props.manager}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={save}
                disabled={!props.manager || url.trim() === ""}
                onCheckedChange={(value) => setSave(value)}
              />
              {t.memorySave}
            </label>
            {props.manager ? (
              <Button type="submit" size="sm">
                {t.save}
              </Button>
            ) : (
              <span className="text-muted-foreground text-xs">{t.adminOnly}</span>
            )}
          </div>
        </details>
      </form>
    </Block>
  );
}

export function AuditSection(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
}) {
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const { data } = useHubQuery<{
    entries: ReadonlyArray<{
      id: string;
      action: string;
      detail: string;
      createdAt: string;
      actorName: string | null;
    }>;
  }>(props.environmentId, "audit.list", { companyId: props.companyId });
  const entries = data?.entries ?? [];
  return (
    <Block title={t.auditTitle} icon={<HistoryIcon className="size-4" />} testId="audit-section">
      <ul className="flex max-h-56 flex-col divide-y overflow-y-auto text-sm">
        {entries.slice(0, 30).map((entry) => (
          <li key={entry.id} className="flex gap-2 py-1">
            <span className="flex-1">{entry.detail}</span>
            <span className="text-muted-foreground text-xs">
              {entry.actorName ?? ""} · {formatZenRelativeTime(locale, entry.createdAt)}
            </span>
          </li>
        ))}
        {entries.length === 0 ? <li className="text-muted-foreground">{t.auditEmpty}</li> : null}
      </ul>
    </Block>
  );
}

export function AcademyTeamSection(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
}) {
  const t = useZenText(hubText);
  const { data } = useHubQuery<{
    team: boolean;
    progress: ReadonlyArray<{ userId: string; name: string; email: string; lessonId: string }>;
  }>(props.environmentId, "academy.progress.get", { companyId: props.companyId });
  const byPerson = new Map<string, { name: string; lessons: Array<string> }>();
  for (const row of data?.progress ?? []) {
    const entry = byPerson.get(row.userId) ?? { name: row.name, lessons: [] };
    entry.lessons.push(row.lessonId);
    byPerson.set(row.userId, entry);
  }
  return (
    <Block
      title={t.academyTitle}
      icon={<GraduationCapIcon className="size-4" />}
      testId="academy-team-section"
    >
      <ul className="flex flex-col divide-y text-sm">
        {[...byPerson.entries()].map(([userId, entry]) => (
          <li key={userId} className="flex flex-wrap items-center gap-2 py-1">
            <span className="flex-1">{entry.name}</span>
            <Badge variant="outline">{t.lessonsDone(entry.lessons.length)}</Badge>
          </li>
        ))}
        {byPerson.size === 0 ? <li className="text-muted-foreground">{t.academyEmpty}</li> : null}
      </ul>
    </Block>
  );
}

/**
 * The hub sends routing only (kind, who, which share); the text is written here, in the person's
 * language, with the chat title this app got from the runner. Older rows keep the hub's text.
 */
function notificationText(
  t: (typeof hubText)["en"],
  item: ZenHubNotification,
): { readonly title: string; readonly body: string } {
  const who = item.actorName ?? null;
  if (who === null) return { title: item.title, body: item.body };
  const title = item.shareTitle ?? null;
  switch (item.kind) {
    case "share":
      return { title: t.notifShare(who, title), body: "" };
    case "comment":
      return { title: t.notifComment(who, title), body: "" };
    case "handover":
      return { title: t.notifHandover(who, title), body: "" };
    case "handover.accepted":
      return { title: t.notifHandoverAccepted(who), body: title ?? "" };
    case "handover.declined":
      return { title: t.notifHandoverDeclined(who), body: title ?? "" };
    case "device": {
      // The hub's text carries the runner's name and the key fingerprint to compare.
      const fingerprint = /fingerprint: ([0-9A-F ]{39})/i.exec(item.body)?.[1] ?? null;
      return {
        title: t.notifDevice(who),
        body: `${t.notifDeviceHint}${fingerprint === null ? "" : ` ${t.fingerprint}: ${fingerprint}`}`,
      };
    }
    default:
      return { title: item.title, body: item.body };
  }
}

export function NotificationsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly call: HubCall;
  readonly open: (shareId: string) => void;
  readonly notifyEmail: boolean;
}) {
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const { data, refresh } = useHubQuery<{
    notifications: ReadonlyArray<ZenHubNotification>;
    unread: number;
  }>(props.environmentId, "notifications.list", {}, { live: true });
  const items = data?.notifications ?? [];
  return (
    <Block
      title={t.notificationsTitle}
      icon={<BellIcon className="size-4" />}
      testId="notifications-section"
    >
      <div className="flex flex-wrap items-center gap-2">
        {data !== null && data.unread > 0 ? (
          <Badge data-testid="unread-count">{t.unread(data.unread)}</Badge>
        ) : null}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={props.notifyEmail}
            onCheckedChange={(value) =>
              void props.call("preferences.set", { notifyEmail: value }).then(refresh)
            }
          />
          {t.emailNotifications}
        </label>
        {data !== null && data.unread > 0 ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => void props.call("notifications.read", {}).then(refresh)}
          >
            {t.markAllRead}
          </Button>
        ) : null}
      </div>
      <ul
        className="flex max-h-64 flex-col divide-y overflow-y-auto text-sm"
        data-testid="notifications-list"
      >
        {items.slice(0, 20).map((item) => (
          <li key={item.id} className="flex items-start gap-2 py-1.5">
            <span
              className={
                item.readAt === null
                  ? "mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                  : "mt-1.5 size-2 shrink-0"
              }
            />
            <button
              type="button"
              className="flex-1 text-left hover:underline disabled:no-underline"
              disabled={item.shareId === null}
              onClick={() => {
                void props.call("notifications.read", { ids: [item.id] }).then(refresh);
                if (item.shareId !== null) props.open(item.shareId);
              }}
            >
              <span className={item.readAt === null ? "font-medium" : ""}>
                {notificationText(t, item).title}
              </span>
              <span className="block text-muted-foreground text-xs">
                {notificationText(t, item).body}
              </span>
            </button>
            <span className="text-muted-foreground text-xs">
              {formatZenRelativeTime(locale, item.createdAt)}
            </span>
          </li>
        ))}
        {items.length === 0 ? <li className="text-muted-foreground">{t.noNotifications}</li> : null}
      </ul>
    </Block>
  );
}
