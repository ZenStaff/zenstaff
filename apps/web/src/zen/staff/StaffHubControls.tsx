// Zen Staff hub v6: AI staff that belongs to the company. "Publish to the company" for a local
// agent (owners/admins), the company badge, who may edit, and the sync line on the AI staff page.
import { zenHubCan, type ZenHubAccess, type ZenHubStatus } from "@t3tools/contracts/zenHub";
import type { StaffAgent, StaffOverview } from "@t3tools/contracts/zenStaff";
import { BuildingIcon, CloudUploadIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useHubQuery } from "../hub/hubClient";
import { companyGates } from "../hub/permissionGates";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { attempt, formatWhen, type StaffContext } from "./staffShared";
import { staffHubText } from "./staffHub.i18n";

/**
 * Hub v9: "angajați AI: administrează" for the whole company (`canAdminister`) or for this
 * agent's hub project (a scoped role). The runner and the hub check the same.
 */
function administers(overview: StaffOverview, hubProjectId: string | null): boolean {
  const hub = overview.hub;
  if (hub === null || hub === undefined) return false;
  if (hub.canAdminister) return true;
  return (
    hub.role === "member" &&
    hubProjectId !== null &&
    zenHubCan(hub.access ?? null, "angajati:administreaza", { projectId: hubProjectId })
  );
}

/** Owners/admins and "administrează" change any company agent; its manager changes its profile. */
export function canEditStaffAgent(overview: StaffOverview, agent: StaffAgent): boolean {
  if (agent.hub === undefined) return true;
  const hub = overview.hub;
  if (hub === null || hub === undefined) return false;
  return (
    administers(overview, agent.hubProjectId ?? null) ||
    (hub.role === "member" && agent.hub.managerUserId === hub.myUserId)
  );
}

export function canDeleteStaffAgent(overview: StaffOverview, agent: StaffAgent): boolean {
  return agent.hub === undefined || administers(overview, agent.hubProjectId ?? null);
}

/**
 * Hub v9: a company AI employee takes tasks only from roles with "angajati:creeaza" for the whole
 * company or for the agent's hub project; the hub and the runner refuse the rest, so the app
 * disables the button instead. Local agents, and a company whose role this machine does not know
 * yet, keep the button (the server decides).
 */
export function canGiveStaffTask(
  overview: StaffOverview,
  agent: StaffAgent,
  access: ZenHubAccess | null | undefined,
): boolean {
  if (agent.hub === undefined) return true;
  const hub = overview.hub;
  if (hub === null || hub === undefined || hub.role === null) return true;
  if (!companyGates(access, hub.role).giveTasks) return false;
  // An older hub (no access): the built-in role decided above.
  if (access === null || access === undefined) return true;
  return zenHubCan(access, "angajati:creeaza", { projectId: agent.hubProjectId ?? null });
}

/** My access in the hub company of this AI staff page (from the hub status; null: unknown). */
export function useStaffHubAccess(
  context: Pick<StaffContext, "environmentId" | "overview">,
): ZenHubAccess | null {
  const { data } = useHubQuery<ZenHubStatus>(context.environmentId, "status");
  const hubCompanyId = context.overview.hub?.hubCompanyId;
  if (hubCompanyId === undefined) return null;
  return data?.access?.[hubCompanyId] ?? null;
}

/** A task control: as is when allowed, else disabled by the caller and explained on hover. */
export function StaffTaskPermissionTooltip(props: {
  readonly allowed: boolean;
  readonly children: ReactNode;
}) {
  const t = useZenText(staffHubText);
  if (props.allowed) return props.children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" data-staff-no-task-permission />}>
        {props.children}
      </TooltipTrigger>
      <TooltipPopup className="max-w-72">{t.noTaskPermission}</TooltipPopup>
    </Tooltip>
  );
}

export function canPublishStaffAgent(overview: StaffOverview, agent: StaffAgent): boolean {
  // Published from a project, the agent belongs to that hub project (a scoped role may publish it).
  return (
    agent.hub === undefined && administers(overview, agent.hubProjectId ?? agent.projectId ?? null)
  );
}

export function StaffHubBadge(props: { readonly agent: StaffAgent }) {
  const t = useZenText(staffHubText);
  if (props.agent.hub === undefined) return null;
  return (
    <Badge variant="info" size="sm" title={t.badgeHelp} data-staff-hub={props.agent.hub.source}>
      <BuildingIcon />
      {t.badge(props.agent.hub.version)}
    </Badge>
  );
}

/** The company line inside an agent's panel. */
export function StaffHubDetails(props: {
  readonly overview: StaffOverview;
  readonly agent: StaffAgent;
}) {
  const t = useZenText(staffHubText);
  const locale = useZenLocale();
  const hub = props.agent.hub;
  if (hub === undefined) return null;
  return (
    <div
      className="flex flex-col gap-1 rounded-lg bg-info/8 px-3 py-2 text-xs"
      data-staff-hub-details
    >
      <span>{hub.source === "runner" ? t.onRunner : t.copy}</span>
      <span className="text-muted-foreground">
        {t.savedBy(hub.updatedBy, formatWhen(hub.updatedAt, locale))}
      </span>
      {!canEditStaffAgent(props.overview, props.agent) ? (
        <span className="text-muted-foreground">{t.readOnly}</span>
      ) : null}
    </div>
  );
}

export function PublishToCompanyButton(props: {
  readonly context: StaffContext;
  readonly agent: StaffAgent;
  readonly onDone: () => void;
}) {
  const t = useZenText(staffHubText);
  const [busy, setBusy] = useState(false);
  if (!canPublishStaffAgent(props.context.overview, props.agent)) return null;
  return (
    <Button
      variant="outline"
      disabled={busy}
      data-staff-publish
      onClick={() => {
        if (!globalThis.confirm(t.publishConfirm(props.agent.name))) return;
        setBusy(true);
        void attempt(
          () => props.context.call("agent.publish", { agentId: props.agent.id }),
          t.published(props.agent.name),
        ).then((result) => {
          setBusy(false);
          if (result !== null) {
            props.context.refresh();
            props.onDone();
          }
        });
      }}
    >
      <CloudUploadIcon />
      {t.publish}
    </Button>
  );
}

/** On the AI staff page: when this computer last synced the company's agents, and any problem. */
export function StaffHubStatus(props: { readonly overview: StaffOverview }) {
  const t = useZenText(staffHubText);
  const locale = useZenLocale();
  const hub = props.overview.hub;
  if (hub === null || hub === undefined) return null;
  if (!props.overview.agents.some((agent) => agent.hub !== undefined) && hub.problem === null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 text-xs" data-staff-hub-status>
      {hub.problem !== null ? (
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
          {hub.problem}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {hub.syncedAt === null ? t.neverSynced : t.syncedAt(formatWhen(hub.syncedAt, locale))}
      </p>
      {hub.refused.length > 0 ? (
        <div className="rounded-lg bg-warning/10 px-3 py-2">
          <p>{t.refused(hub.refused.length)}</p>
          <ul className="list-disc pl-5">
            {hub.refused.slice(0, 5).map((item) => (
              <li key={`${item.staffId}:${item.reason}`}>
                {t.reasons[item.reason] ?? item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
