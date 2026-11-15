// Small pieces the upstream UI mounts: the sidebar company switcher, the project context-menu
// items, the "Company" row in project settings and the command palette entry.
import { RegistryContext } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ContextMenuItem, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { ZenCompany } from "@t3tools/contracts/zenCompanies";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import {
  BriefcaseIcon,
  Building2Icon,
  ChevronsUpDownIcon,
  CloudIcon,
  CodeIcon,
  FactoryIcon,
  HeartIcon,
  LayersIcon,
  LinkIcon,
  MonitorIcon,
  PlusIcon,
  RocketIcon,
  Settings2Icon,
  StarIcon,
  StoreIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useContext, useState } from "react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { SettingsRow } from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useSidebar } from "../../components/ui/sidebar";
import { toastManager } from "../../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { readProject } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { hubErrorMessage, useHubCall, useHubQuery } from "../hub/hubClient";
import { ZenEditionSwitch } from "../office/EditionSwitch";
import { useZenText, zenText } from "../i18n/zenI18n";
import { zenErrorMessage } from "../i18n/serverText";
import { COMPANIES_SEARCH_TERMS, companiesText } from "./companies.i18n";
import { clientsText } from "../clients/clients.i18n";
import { AddClientDialog } from "../clients/AddClientDialog";
import { speaksOfClients, useZenWorkMode } from "../clients/workMode";
import { companyOfProject, companyOfThread, sharedCompanyOf } from "./companiesModel";
import {
  buildSwitcherRows,
  HUB_ROW_PREFIX,
  shownCompanyName,
  type SwitcherHubCompany,
} from "./companySwitcherModel";
import {
  companiesListAtom,
  companyAssignProject,
  companyAssignThread,
  companyCreate,
  useActiveCompanyId,
  useCompanyIndex,
  useSelectedCompanyStore,
} from "./companiesState";

/** A company icon by name; unknown names show the building. */
export function CompanyIcon({
  icon,
  className,
}: {
  readonly icon: string;
  readonly className?: string;
}) {
  switch (icon) {
    case "briefcase":
      return <BriefcaseIcon className={className} aria-hidden />;
    case "store":
      return <StoreIcon className={className} aria-hidden />;
    case "factory":
      return <FactoryIcon className={className} aria-hidden />;
    case "rocket":
      return <RocketIcon className={className} aria-hidden />;
    case "user":
      return <UserIcon className={className} aria-hidden />;
    case "users":
      return <UsersIcon className={className} aria-hidden />;
    case "heart":
      return <HeartIcon className={className} aria-hidden />;
    case "star":
      return <StarIcon className={className} aria-hidden />;
    case "code":
      return <CodeIcon className={className} aria-hidden />;
    default:
      return <Building2Icon className={className} aria-hidden />;
  }
}

/** The company's icon on a tile of its color. */
export function CompanyBadge({
  company,
  className,
}: {
  readonly company: Pick<ZenCompany, "color" | "icon">;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-4 shrink-0 place-items-center rounded-sm text-white",
        className,
      )}
      style={{ backgroundColor: company.color }}
    >
      <CompanyIcon icon={company.icon} className="size-[70%]" />
    </span>
  );
}

/** Assigns projects (one per environment for grouped projects) and refreshes their lists. */
export function useAssignProjectsToCompany() {
  const t = useZenText(companiesText);
  const registry = useContext(RegistryContext);
  const assign = useAtomCommand(companyAssignProject, { reportFailure: false });
  return async (
    refs: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly projectId: ProjectId }>,
    company: Pick<ZenCompany, "id" | "name">,
  ) => {
    const results = await Promise.all(
      refs.map((ref) =>
        assign({
          environmentId: ref.environmentId,
          input: { projectId: ref.projectId, companyId: company.id },
        }),
      ),
    );
    for (const environmentId of new Set(refs.map((ref) => ref.environmentId))) {
      registry.refresh(companiesListAtom(environmentId));
    }
    const failure = results.find((result) => result._tag === "Failure");
    if (failure !== undefined && failure._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: t.moveFailed(company.name),
        description: zenErrorMessage(failure.cause, t.moveFailedDescription),
      });
      return false;
    }
    return true;
  };
}

/** Under the sidebar header: which company's projects and threads the sidebar shows. */
export function CompanySwitcher() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? (
    <SwitcherMenu environmentId={null} hub={null} />
  ) : (
    <HubAwareSwitcher environmentId={environmentId} />
  );
}

/** The same hub status the Team page reads, so joining, leaving or linking there shows here. */
function HubAwareSwitcher({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { data, refresh } = useHubQuery<ZenHubStatus>(environmentId, "status");
  return <SwitcherMenu environmentId={environmentId} hub={{ status: data, refresh }} />;
}

function SwitcherMenu({
  environmentId,
  hub,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly hub: { readonly status: ZenHubStatus | null; readonly refresh: () => void } | null;
}) {
  const t = useZenText(companiesText);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const registry = useContext(RegistryContext);
  const { call } = useHubCall();
  const create = useAtomCommand(companyCreate, { reportFailure: false });
  const index = useCompanyIndex();
  const activeId = useActiveCompanyId(index);
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  const [busy, setBusy] = useState(false);
  const [addingClient, setAddingClient] = useState(false);
  const tc = useZenText(clientsText);
  // Freelancers (first run "Lucrez pentru clienți"): the switcher speaks of clients.
  const clientsMode = speaksOfClients(useZenWorkMode((store) => store.mode));
  const allLabel = clientsMode ? tc.allClients : t.allCompanies;
  const status = hub?.status ?? null;
  const signedIn = status?.signedIn === true;
  const rows = buildSwitcherRows({
    localCompanies: index.companies,
    links: status?.links ?? {},
    hubCompanies: status?.companies ?? [],
    signedIn,
  });
  const active = index.companies.find((company) => company.id === activeId) ?? null;
  // One company, one name: a company linked to the team shows the team's name (review P1-5).
  const label = active === null ? allLabel : shownCompanyName(rows, active);

  const refreshAll = () => {
    if (environmentId !== null) registry.refresh(companiesListAtom(environmentId));
    hub?.refresh();
  };

  /** Links a local company to the hub company (creating it first when none is given). */
  const linkToHub = async (
    envId: EnvironmentId,
    hubCompany: SwitcherHubCompany,
    existing: ZenCompany | null,
  ) => {
    let localId = existing?.id ?? null;
    if (localId === null) {
      const created = await create({ environmentId: envId, input: { name: hubCompany.name } });
      if (created._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: t.addHubCompanyFailed(hubCompany.name),
          description: zenErrorMessage(created.cause, t.tryAgain),
        });
        return;
      }
      localId = created.value.id;
    }
    try {
      await call("company.link", { localCompanyId: localId, hubCompanyId: hubCompany.id });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: t.linkFailed,
        description: hubErrorMessage(cause, t.tryAgain),
      });
      setSelected(localId);
      return;
    }
    setSelected(localId);
    if (existing !== null) {
      toastManager.add({ type: "success", title: t.linked(existing.name) });
    }
  };

  const bring = async (hubCompany: SwitcherHubCompany, existing: ZenCompany | null) => {
    if (environmentId === null || busy) return;
    setBusy(true);
    // No `try`/`finally`: React Compiler skips components that use one.
    await linkToHub(environmentId, hubCompany, existing).catch((cause: unknown) => {
      toastManager.add({
        type: "error",
        title: t.linkFailed,
        description: hubErrorMessage(cause, t.tryAgain),
      });
    });
    refreshAll();
    setBusy(false);
  };

  const choose = (value: string) => {
    if (value === "__all__") return setSelected(null);
    if (!value.startsWith(HUB_ROW_PREFIX)) return setSelected(value);
    const row = rows.find((candidate) => candidate.key === value);
    if (row?.kind === "hub-only") void bring(row.hubCompany, null);
  };

  return (
    <>
      <Menu onOpenChange={(open) => open && hub?.refresh()}>
        <div className="@container flex shrink-0 items-center gap-1 px-2 pb-1">
          <MenuTrigger
            aria-label={t.switcherLabel(label)}
            render={<Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" />}
            data-zen-company-switcher
          >
            {active ? (
              <CompanyBadge company={active} className="size-5" />
            ) : (
              <LayersIcon className="size-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
          </MenuTrigger>
          <ZenEditionSwitch />
        </div>
        <MenuPopup align="start" className="w-(--anchor-width) min-w-60">
          <MenuRadioGroup
            value={activeId ?? "__all__"}
            onValueChange={(value) => choose(String(value))}
          >
            <MenuRadioItem value="__all__" closeOnClick>
              <span className="flex min-w-0 items-center gap-2">
                <LayersIcon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{allLabel}</span>
              </span>
            </MenuRadioItem>
            {clientsMode ? (
              <div
                className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs"
                data-zen-switcher-clients-label
              >
                {tc.clients}
              </div>
            ) : null}
            {rows.map((row) =>
              row.kind === "hub-only" ? (
                <MenuRadioItem
                  key={row.key}
                  value={row.key}
                  closeOnClick
                  disabled={busy || environmentId === null}
                  data-zen-company-row="hub-only"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-grid size-4 shrink-0 place-items-center rounded-sm border border-dashed text-muted-foreground"
                    >
                      <Building2Icon className="size-[70%]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{row.hubCompany.name}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {t.notOnThisComputer}
                      </span>
                    </span>
                    <PlaceMarker place="hub" label={t.hubCompany} />
                  </span>
                </MenuRadioItem>
              ) : (
                <div key={row.key} className="relative">
                  <MenuRadioItem
                    value={row.company.id}
                    closeOnClick
                    data-zen-company-row={row.kind}
                  >
                    <span
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2",
                        row.kind === "matched" && row.canLink && "me-14",
                      )}
                    >
                      <CompanyBadge company={row.company} />
                      <span className="min-w-0 flex-1 truncate">
                        {clientsMode && row.company.isDefault
                          ? tc.myCompany
                          : shownCompanyName(rows, row.company)}
                      </span>
                      {row.kind === "linked" ? (
                        <PlaceMarker place="both" label={t.onHubAndHere} />
                      ) : row.kind === "matched" ? (
                        <PlaceMarker place="local" label={t.localOnly} />
                      ) : signedIn ? (
                        <PlaceMarker place="local" label={t.localOnly} />
                      ) : null}
                    </span>
                  </MenuRadioItem>
                  {row.kind === "matched" && row.canLink ? (
                    // Outside the radio item, so a click links instead of choosing the company.
                    <button
                      type="button"
                      className="absolute top-1/2 right-1.5 inline-flex -translate-y-1/2 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                      disabled={busy || environmentId === null}
                      aria-label={t.linkNamed(row.company.name)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void bring(row.hubCompany, row.company);
                      }}
                      data-zen-company-link={row.company.id}
                    >
                      <LinkIcon className="size-3" aria-hidden />
                      {t.link}
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </MenuRadioGroup>
          <MenuSeparator />
          {clientsMode && environmentId !== null ? (
            <MenuItem onClick={() => setAddingClient(true)} data-zen-switcher-add-client>
              <PlusIcon className="size-4" aria-hidden />
              {tc.addClient}
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              void navigate({
                to: "/companies",
                search: activeId === null ? {} : { company: activeId },
              });
            }}
          >
            <Settings2Icon className="size-4" aria-hidden />
            {t.manageCompanies}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {addingClient && environmentId !== null ? (
        <AddClientDialog environmentId={environmentId} onClose={() => setAddingClient(false)} />
      ) : null}
    </>
  );
}

/** Where a company lives: on the hub (cloud) or only on this computer. */
function PlaceMarker({
  place,
  label,
}: {
  readonly place: "hub" | "local" | "both";
  readonly label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className="inline-flex shrink-0 text-muted-foreground"
            data-zen-company-place={place}
          />
        }
      >
        <span className="inline-flex items-center gap-0.5">
          {place !== "local" ? <CloudIcon className="size-3.5" aria-hidden /> : null}
          {place !== "hub" ? <MonitorIcon className="size-3.5" aria-hidden /> : null}
        </span>
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

const MENU_PREFIX = "zen-company:";

/**
 * Context-menu items for a sidebar project folder: a "Company" submenu with a check on the
 * current company, and the handler for the chosen item.
 */
export function useZenProjectCompanyMenu() {
  const t = useZenText(companiesText);
  const index = useCompanyIndex();
  const assign = useAssignProjectsToCompany();
  type Group = {
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }>;
  };
  const currentOf = (group: Group) =>
    sharedCompanyOf(
      group.memberProjectRefs.map((ref) => ({
        environmentId: ref.environmentId,
        id: ref.projectId,
      })),
      index,
    );
  return {
    items: (group: Group): ContextMenuItem[] =>
      index.companies.length === 0
        ? []
        : [
            {
              id: `${MENU_PREFIX}menu`,
              label: t.company,
              icon: "briefcase",
              children: index.companies.map((company) => ({
                id: `${MENU_PREFIX}${company.id}`,
                label: company.name,
                checked: currentOf(group) === company.id,
              })),
            },
          ],
    /** True when the clicked item was ours. */
    handle: (group: Group, clicked: string | null): boolean => {
      if (clicked === null || !clicked.startsWith(MENU_PREFIX)) return false;
      const company = index.companies.find(
        (candidate) => candidate.id === clicked.slice(MENU_PREFIX.length),
      );
      if (company !== undefined) void assign(group.memberProjectRefs, company);
      return true;
    },
  };
}

const THREAD_MENU_PREFIX = "zen-thread-company:";
type ZenThreadCompanyMenuId = `${typeof THREAD_MENU_PREFIX}${string}`;

/**
 * Context-menu items for a "No project" thread in the sidebar: a "Company" submenu that moves
 * the chat to another company (its tag, on the thread's own machine). Threads in a real project
 * follow their project, which moves from the project folder's menu instead.
 */
export function useZenThreadCompanyMenu() {
  const t = useZenText(companiesText);
  const registry = useContext(RegistryContext);
  const index = useCompanyIndex();
  const assign = useAtomCommand(companyAssignThread, { reportFailure: false });
  type Thread = {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
  };
  const isScratch = (thread: Thread) =>
    readProject(scopeProjectRef(thread.environmentId, thread.projectId))?.isScratch === true;
  return {
    items: (thread: Thread): ContextMenuItem<ZenThreadCompanyMenuId>[] =>
      index.companies.length < 2 || !isScratch(thread)
        ? []
        : [
            {
              id: `${THREAD_MENU_PREFIX}menu` as const,
              label: t.company,
              icon: "briefcase",
              children: index.companies.map((company) => ({
                id: `${THREAD_MENU_PREFIX}${company.id}` as const,
                label: company.name,
                checked: companyOfThread(index, thread) === company.id,
              })),
            },
          ],
    /** True when the clicked item was ours. */
    handle: (thread: Thread, clicked: string | null): clicked is ZenThreadCompanyMenuId => {
      if (clicked === null || !clicked.startsWith(THREAD_MENU_PREFIX)) return false;
      const company = index.companies.find(
        (candidate) => candidate.id === clicked.slice(THREAD_MENU_PREFIX.length),
      );
      if (company === undefined) return true;
      void (async () => {
        const result = await assign({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, companyId: company.id },
        });
        registry.refresh(companiesListAtom(thread.environmentId));
        if (result._tag === "Failure") {
          toastManager.add({
            type: "error",
            title: t.moveFailed(company.name),
            description: zenErrorMessage(result.cause, t.moveFailedDescription),
          });
        }
      })();
      return true;
    },
  };
}

/** "Company" row for the project settings panel. */
export function ZenProjectCompanyRow({
  projects,
}: {
  readonly projects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }>;
}) {
  const t = useZenText(companiesText);
  const index = useCompanyIndex();
  const assign = useAssignProjectsToCompany();
  if (projects.length === 0 || index.companies.length === 0) return null;
  const current =
    sharedCompanyOf(projects, index) ??
    companyOfProject(index, projects[0]!.environmentId, projects[0]!.id);
  return (
    <SettingsRow
      title={t.company}
      description={t.projectCompanyDescription}
      control={
        <Select
          value={current}
          items={Object.fromEntries(index.companies.map((company) => [company.id, company.name]))}
          onValueChange={(value) => {
            const company = index.companies.find((candidate) => candidate.id === value);
            if (company === undefined) return;
            void assign(
              projects.map((project) => ({
                environmentId: project.environmentId,
                projectId: project.id,
              })),
              company,
            );
          }}
        >
          <SelectTrigger className="w-44" aria-label={t.projectCompany}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {index.companies.map((company) => (
              <SelectItem key={company.id} value={company.id}>
                <span className="flex items-center gap-2">
                  <CompanyBadge company={company} />
                  {company.name}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function companiesCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:zen-companies",
    searchTerms: COMPANIES_SEARCH_TERMS,
    title: zenText(companiesText).paletteTitle,
    icon: <Building2Icon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/companies" });
    },
  };
}
