// Zen Staff: "Your company today", a compact card on the Office home and the Team page for someone
// signed in to a hub and in at least one hub company: what waits for their approval, the AI staff
// and what they do, devices and the company server online, packs that failed to install, and the
// hub's web app. Every number comes from ops the app already has (companyToday.logic.ts).
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenChatStatus } from "@t3tools/contracts/zenChat";
import type { ZenHubCompanyDetail, ZenHubStatus } from "@t3tools/contracts/zenHub";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { useChatQuery } from "../chat/chatClient";
import { companyOfProject } from "../companies/companiesModel";
import { useActiveCompanyId, useCompanyIndex } from "../companies/companiesState";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import type { CompanyPacksView } from "../office/companyPacksModel";
import { useStaffOverview } from "../staff/staffClient";
import { companyTodayText } from "./companyToday.i18n";
import {
  deriveCompanyToday,
  isHubAppUrl,
  localCompanyOf,
  pickCompanyTodayCompany,
  showCompanyToday,
  type CompanyTodaySources,
  type CompanyTodayView,
} from "./companyToday.logic";
import { useHubQuery } from "./hubClient";
import { ZenSelect } from "../ui/ZenSelect";

const STAFF_SHOWN = 5;

type TrustedDevices = CompanyTodaySources["trustedDevices"];

/** Opens only the hub's own /app address, in the system browser (Electron routes `_blank` there). */
function openHubApp(url: string, hubUrl: string | null) {
  if (!isHubAppUrl(url, hubUrl)) return;
  window.open(url, "_blank", "noopener");
}

export function CompanyTodayCard(props: {
  readonly environmentId: EnvironmentId;
  readonly className?: string;
}) {
  const { data: status } = useHubQuery<ZenHubStatus>(props.environmentId, "status");
  const index = useCompanyIndex();
  const activeLocal = useActiveCompanyId(index);
  const [chosen, setChosen] = useState<string | null>(null);
  if (status === null || !showCompanyToday(status)) return null;
  const hubCompanyId = pickCompanyTodayCompany(status, activeLocal, chosen);
  if (hubCompanyId === null) return null;
  const localCompanyId = localCompanyOf(status.links, hubCompanyId);
  const shared = {
    environmentId: props.environmentId,
    status,
    hubCompanyId,
    localCompanyId,
    onChoose: setChosen,
    className: props.className,
  };
  return localCompanyId === null ? (
    <CompanyTodayData key={hubCompanyId} {...shared} staff={undefined} />
  ) : (
    <CompanyTodayWithStaff key={hubCompanyId} {...shared} localCompanyId={localCompanyId} />
  );
}

interface DataProps {
  readonly environmentId: EnvironmentId;
  readonly status: ZenHubStatus;
  readonly hubCompanyId: string;
  readonly localCompanyId: string | null;
  readonly onChoose: (hubCompanyId: string) => void;
  readonly className?: string | undefined;
}

function CompanyTodayWithStaff(props: DataProps & { readonly localCompanyId: string }) {
  const locale = useZenLocale();
  const { data } = useStaffOverview(props.environmentId, props.localCompanyId, locale);
  return <CompanyTodayData {...props} staff={data} />;
}

function CompanyTodayData(props: DataProps & { readonly staff: CompanyTodaySources["staff"] }) {
  const { environmentId, status, hubCompanyId, localCompanyId } = props;
  const index = useCompanyIndex();
  const shells = useThreadShells();
  const detail = useHubQuery<ZenHubCompanyDetail>(environmentId, "company.get", {
    companyId: hubCompanyId,
  });
  const packs = useHubQuery<CompanyPacksView>(environmentId, "companyPacks.list", {
    companyId: hubCompanyId,
  });
  const trusted = useHubQuery<NonNullable<TrustedDevices>>(environmentId, "devices.trusted");
  const chat = useChatQuery<ZenChatStatus>(environmentId, "status");
  const view = deriveCompanyToday({
    status,
    hubCompanyId,
    localCompanyId,
    threads: shells.map((shell) => ({
      environmentId: shell.environmentId,
      id: shell.id,
      hasPendingApprovals: shell.hasPendingApprovals,
      archivedAt: shell.archivedAt,
      companyId: companyOfProject(index, shell.environmentId, shell.projectId),
    })),
    staff: props.staff,
    // A source that failed counts as nothing waiting, so the total still shows.
    messageApprovals: chat.error !== null ? 0 : (chat.data?.pendingApprovals ?? null),
    trustedDevices: trusted.error !== null ? { devices: [] } : trusted.data,
    runners: detail.error !== null ? null : (detail.data?.runners ?? null),
    packStatus: packs.error !== null ? [] : (packs.data?.status ?? null),
  });
  return (
    <CompanyTodayBody
      view={view}
      status={status}
      hubCompanyId={hubCompanyId}
      localCompanyId={localCompanyId}
      runnerFailed={detail.error !== null}
      onChoose={props.onChoose}
      className={props.className}
    />
  );
}

function Tile(props: {
  readonly value: ReactNode;
  readonly label: string;
  readonly loud?: boolean;
  readonly loading: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2.5">
      {props.loading ? (
        <>
          <Skeleton className="h-7 w-10" />
          <Skeleton className="mt-1 h-3.5 w-24" />
        </>
      ) : (
        <>
          <span
            className={cn(
              "font-semibold text-2xl tabular-nums leading-tight",
              props.loud ? "text-primary" : "text-foreground",
            )}
          >
            {props.value}
          </span>
          <span className="truncate text-muted-foreground text-xs">{props.label}</span>
        </>
      )}
    </div>
  );
}

function StatusDot(props: { readonly status: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        props.status === "working"
          ? "bg-success"
          : props.status === "waiting-approval"
            ? "bg-warning"
            : "bg-muted-foreground/40",
      )}
    />
  );
}

function CompanyTodayBody(props: {
  readonly view: CompanyTodayView;
  readonly status: ZenHubStatus;
  readonly hubCompanyId: string;
  readonly localCompanyId: string | null;
  readonly runnerFailed: boolean;
  readonly onChoose: (hubCompanyId: string) => void;
  readonly className?: string | undefined;
}) {
  const t = useZenText(companyTodayText);
  const { view, status } = props;
  const { approvals } = view;
  const company = status.companies.find((item) => item.id === props.hubCompanyId);
  const staffSearch =
    props.localCompanyId === null
      ? {}
      : { company: props.localCompanyId, tab: "approvals" as const };
  const runnerLabel =
    view.runner === null
      ? t.runnerUnknown
      : view.runner === "none"
        ? t.runnerNone
        : view.runner.online
          ? t.runnerOnline
          : t.runnerOffline;
  const staffList = typeof view.staff === "object" && view.staff !== null ? view.staff : null;
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4", props.className)}
      data-testid="company-today"
      aria-label={t.title}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 font-medium text-base">
          {t.title}
          {company !== undefined && status.companies.length === 1 ? (
            <span className="text-muted-foreground font-normal"> · {company.name}</span>
          ) : null}
        </h2>
        {status.companies.length > 1 ? (
          <ZenSelect
            value={props.hubCompanyId}
            onChange={props.onChoose}
            options={status.companies.map((item) => ({ value: item.id, label: item.name }))}
            label={t.chooseCompany}
            size="sm"
            className="max-w-56"
            testId="company-today-select"
          />
        ) : null}
        <div className="min-w-0 flex-1" />
        {view.appUrl !== null ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => openHubApp(view.appUrl!, status.hubUrl)}
            data-testid="company-today-open"
          >
            <ExternalLinkIcon />
            {t.openInBrowser}
          </Button>
        ) : null}
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <Tile
          loading={approvals.total === null}
          value={approvals.total ?? 0}
          label={
            approvals.total === 0 ? t.nothingWaiting : t.approvalsWaiting(approvals.total ?? 0)
          }
          loud={(approvals.total ?? 0) > 0}
        />
        {view.staff !== "unlinked" ? (
          <Tile
            loading={staffList === null}
            value={staffList?.working ?? 0}
            label={t.staffWorking(staffList?.total ?? 0)}
          />
        ) : null}
        <Tile
          loading={false}
          value={view.devices === null ? "–" : `${view.devices.online}/${view.devices.total}`}
          label={view.devices === null ? t.devicesUnknown : t.devicesOnline}
        />
        <Tile
          loading={view.runner === null && !props.runnerFailed}
          value={
            <span className="flex h-8 items-center">
              <span
                aria-hidden
                className={cn(
                  "size-3 rounded-full",
                  view.runner !== null && view.runner !== "none" && view.runner.online
                    ? "bg-success"
                    : "bg-muted-foreground/40",
                )}
              />
            </span>
          }
          label={runnerLabel}
        />
      </div>

      {(approvals.chats ?? 0) +
        (approvals.staff ?? 0) +
        (approvals.messages ?? 0) +
        (approvals.devices ?? 0) >
      0 ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="company-today-approvals">
          {(approvals.chats ?? 0) > 0 && approvals.firstChat !== null ? (
            <li>
              <Link
                to="/$environmentId/$threadId"
                params={{
                  environmentId: approvals.firstChat.environmentId,
                  threadId: approvals.firstChat.threadId,
                }}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {t.approvalChats(approvals.chats ?? 0)}
              </Link>
            </li>
          ) : null}
          {(approvals.staff ?? 0) > 0 ? (
            <li>
              <Link
                to="/staff"
                search={staffSearch}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {t.approvalStaff(approvals.staff ?? 0)}
              </Link>
            </li>
          ) : null}
          {(approvals.messages ?? 0) > 0 ? (
            <li>
              <Link
                to="/chat-integrations"
                search={{ tab: "approvals" }}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {t.approvalMessages(approvals.messages ?? 0)}
              </Link>
            </li>
          ) : null}
          {(approvals.devices ?? 0) > 0 ? (
            <li>
              <Link
                to="/hub"
                search={{ tab: "account" }}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {t.approvalDevices(approvals.devices ?? 0)}
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}

      {view.staff === "unlinked" ? (
        <p className="text-muted-foreground text-xs">{t.staffUnlinked}</p>
      ) : staffList === null ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : staffList.total === 0 ? (
        <p className="text-muted-foreground text-xs">{t.staffEmpty}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <ul className="flex min-w-0 flex-col gap-1 text-sm" data-testid="company-today-staff">
            {staffList.agents.slice(0, STAFF_SHOWN).map((agent) => (
              <li key={agent.id} className="flex min-w-0 items-center gap-2">
                <StatusDot status={agent.status} />
                <span className="min-w-0 truncate">
                  <span className="font-medium">{agent.name}</span>
                  {agent.role !== "" ? (
                    <span className="text-muted-foreground"> · {agent.role}</span>
                  ) : null}
                </span>
                <span className="ms-auto shrink-0 text-muted-foreground text-xs">
                  {t.staffStatus[agent.status] ?? agent.status}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/staff"
            search={props.localCompanyId === null ? {} : { company: props.localCompanyId }}
            className="self-start text-muted-foreground text-xs underline-offset-4 hover:underline"
          >
            {staffList.total > STAFF_SHOWN
              ? `${t.staffMore(staffList.total - STAFF_SHOWN)} · `
              : ""}
            {t.openStaff}
          </Link>
        </div>
      )}

      {view.packIssues !== null && view.packIssues.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm" data-testid="company-today-packs">
          <h3 className="font-medium text-destructive-foreground">{t.packsTitle}</h3>
          <ul className="flex flex-col gap-0.5">
            {view.packIssues.map((issue) => (
              <li key={issue.key} className="min-w-0 truncate text-xs">
                <span className="font-medium">{issue.packId}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {t.packOn(issue.machine, issue.person)}
                  {issue.error ? ` · ${issue.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/library"
            className="self-start text-muted-foreground text-xs underline-offset-4 hover:underline"
          >
            {t.openPacks}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
