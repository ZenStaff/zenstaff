// Zen Staff sidebar "My workflows" (Fluxurile mele): the person's pinned workflows, then the most
// used ones, above the page rows. A click starts the workflow the way its Office home card does
// (chat-first in Office, the form in Code). Pure ordering in myWorkflowsModel.ts; pins, run log
// and the collapsed header in myWorkflowsState.ts. ZEN.md, "Sidebar navigation".
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { localizeWorkflowManifest, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { Building2Icon, ChevronRightIcon, PinIcon, PinOffIcon, RepeatIcon } from "lucide-react";
import { useEffect } from "react";

import { CollapsibleSectionHeader } from "../../components/ui/collapsible-section-header";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { openWorkflowChat } from "../intake/openWorkflowChat";
import { useCompanyPacks } from "../office/CompanyPacks";
import { officeWorkflows } from "../office/officeState";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { WorkflowIcon } from "../office/workflowIcons";
import { myWorkflowsText } from "./myWorkflows.i18n";
import {
  buildMyWorkflows,
  type MyWorkflowRow,
  type MyWorkflowSource,
  scheduledWorkflowIds,
} from "./myWorkflowsModel";
import { useMyWorkflowsStore } from "./myWorkflowsState";

/** A workflow as the sidebar lists it: localized name, company flag from its source or pack. */
function workflowSources(
  workflows: ReadonlyArray<ZenWorkflow>,
  locale: string,
  companyPackIds: ReadonlySet<string>,
): ReadonlyArray<MyWorkflowSource> {
  return workflows.map((workflow) => {
    const manifest = localizeWorkflowManifest(workflow.manifest, locale);
    return {
      id: manifest.id,
      name: manifest.name,
      icon: manifest.icon,
      company:
        workflow.source === "company" ||
        (workflow.packId !== null && companyPackIds.has(workflow.packId)),
    };
  });
}

export function ZenMyWorkflows() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <MyWorkflowsSection environmentId={environmentId} />;
}

function MyWorkflowsSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(myWorkflowsText);
  const collapsed = useMyWorkflowsStore((state) => state.collapsed);
  const setCollapsed = useMyWorkflowsStore((state) => state.setCollapsed);
  return (
    <section aria-label={t.title} data-zen-my-workflows className="flex min-w-0 flex-col">
      <CollapsibleSectionHeader
        expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        data-zen-my-workflows-toggle
      >
        {t.title}
      </CollapsibleSectionHeader>
      <MyWorkflowsCatalog environmentId={environmentId} expanded={!collapsed} />
    </section>
  );
}

/** Loads the workflows (shared with the Office home's query) and keeps the palette's copy. */
function MyWorkflowsCatalog(props: {
  readonly environmentId: EnvironmentId;
  readonly expanded: boolean;
}) {
  const locale = useZenLocale();
  const { workflowsInput } = useOfficeCompany();
  const result = useAtomValue(
    officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
  );
  const workflows = AsyncResult.isSuccess(result) ? result.value.workflows : null;
  const companyPacks = useCompanyPacks(props.environmentId);
  const companyPackIds = new Set(companyPacks.view?.packs.map((pack) => pack.packId) ?? []);
  const sources = workflows === null ? null : workflowSources(workflows, locale, companyPackIds);
  const setCatalog = useMyWorkflowsStore((state) => state.setCatalog);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the loaded workflow list into the store the command palette reads outside React
  useEffect(() => {
    if (sources !== null) setCatalog(sources);
  }, [sources, setCatalog]);
  if (!props.expanded || sources === null) return null;
  return <MyWorkflowsList environmentId={props.environmentId} sources={sources} />;
}

function MyWorkflowsList(props: {
  readonly environmentId: EnvironmentId;
  readonly sources: ReadonlyArray<MyWorkflowSource>;
}) {
  const t = useZenText(myWorkflowsText);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const pins = useMyWorkflowsStore((state) => state.pins);
  const runs = useMyWorkflowsStore((state) => state.runs);
  const togglePin = useMyWorkflowsStore((state) => state.togglePin);
  // Only while the section is open: which workflows a scheduled task repeats.
  const tasksResult = useAtomValue(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const tasks = AsyncResult.isSuccess(tasksResult) ? tasksResult.value.tasks : null;
  const scheduled = scheduledWorkflowIds(tasks ?? []);
  const { rows } = buildMyWorkflows({ workflows: props.sources, pins, runs, scheduled });
  const go = (open: () => Promise<void>) => {
    if (isMobile) setOpenMobile(false);
    void open();
  };
  return (
    <SidebarMenu>
      {rows.length === 0 ? (
        <li className="px-2 py-1 text-muted-foreground text-xs" data-zen-my-workflows-empty>
          {t.empty}
        </li>
      ) : null}
      {rows.map((row) => (
        <MyWorkflowItem
          key={row.id}
          row={row}
          onStart={() => go(() => openWorkflowChat(navigate, row.id))}
          onTogglePin={() => togglePin(row.id)}
        />
      ))}
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          aria-label={t.allLabel}
          onClick={() => go(() => navigate({ to: "/office" }))}
          data-zen-my-workflows-all
        >
          <ChevronRightIcon className="size-3.5" />
          <span>{t.all}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function MyWorkflowItem(props: {
  readonly row: MyWorkflowRow;
  readonly onStart: () => void;
  readonly onTogglePin: () => void;
}) {
  const t = useZenText(myWorkflowsText);
  const { row } = props;
  const pinLabel = row.pinned ? t.unpinNamed(row.name) : t.pinNamed(row.name);
  return (
    <SidebarMenuItem
      className="flex min-w-0 items-center"
      data-zen-my-workflow={row.id}
      data-pinned={row.pinned || undefined}
    >
      <SidebarMenuButton size="sm" onClick={props.onStart} aria-label={t.startNamed(row.name)}>
        <WorkflowIcon name={row.icon} className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        {row.company ? (
          <span role="img" aria-label={t.company} className="flex shrink-0">
            <Building2Icon aria-hidden className="size-3 text-muted-foreground" />
          </span>
        ) : null}
        {row.scheduled ? (
          <span role="img" aria-label={t.scheduled} className="flex shrink-0">
            <RepeatIcon aria-hidden className="size-3 text-muted-foreground" />
          </span>
        ) : null}
      </SidebarMenuButton>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={props.onTogglePin}
              aria-label={pinLabel}
              aria-pressed={row.pinned}
              data-zen-my-workflow-pin={row.id}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
            />
          }
        >
          {row.pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
        </TooltipTrigger>
        <TooltipPopup side="right">{row.pinned ? t.unpin : t.pin}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
