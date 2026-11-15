import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_COMPANY_COLORS,
  ZEN_COMPANY_ICONS,
  type ZenCompany,
  type ZenCompanyMemoryFile,
} from "@t3tools/contracts/zenCompanies";
import { AsyncResult } from "effect/reactivity";
import { CheckIcon, FileTextIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";

import { isElectron } from "~/env";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";
import { RefreshIcon } from "../../components/ui/refresh-icon";
import { SidebarInset } from "../../components/ui/sidebar";
import { Skeleton } from "../../components/ui/skeleton";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { CompanyMemoryConnection } from "../memory/CompanyMemoryConnection";
import { CompanyProfileSection } from "../onboarding/CompanyProfileSection";
import { CompanyMemoryTab } from "../memory/CompanyMemoryTab";
import { PersonalMemoryPanel } from "../memory/MemoryV4";
import { CompanyBadge, CompanyIcon, useAssignProjectsToCompany } from "./CompaniesEntryPoints";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { zenErrorMessage } from "../i18n/serverText";
import { companiesText, formatZenRelativeTime } from "./companies.i18n";
import { buildCompanyIndex, companyOfProject, formatBytes } from "./companiesModel";
import {
  companiesListAtom,
  companyCreate,
  companyDelete,
  companyMemoryList,
  companyReadMemory,
  companyUpdate,
  useSelectedCompanyStore,
} from "./companiesState";
import { useIsInternalFolder } from "../office/useInternalFolders";

export type CompaniesTab = "projects" | "memory" | "files" | "settings";

export interface CompaniesSearch {
  readonly company?: string;
  readonly tab?: CompaniesTab;
}

export function CompaniesPage({ search }: { readonly search: CompaniesSearch }) {
  const t = useZenText(companiesText);
  const environmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const navigate = useNavigate();
  const refresh = () => {
    if (environmentId !== null) registry.refresh(companiesListAtom(environmentId));
  };
  const setSearch = (next: CompaniesSearch) =>
    void navigate({ to: "/companies", search: next, replace: true });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel={t.breadcrumb}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{t.title}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          <Button size="icon-sm" variant="ghost" aria-label={t.refresh} onClick={refresh}>
            <RefreshIcon refreshing={false} />
          </Button>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide" className="gap-4">
            <p className="text-muted-foreground text-sm">{t.intro}</p>
            {environmentId === null ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t.noMachineTitle}</EmptyTitle>
                  <EmptyDescription>{t.noMachineDescription}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <CompaniesForEnvironment
                environmentId={environmentId}
                search={search}
                setSearch={setSearch}
                refresh={refresh}
              />
            )}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function CompaniesForEnvironment({
  environmentId,
  search,
  setSearch,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly search: CompaniesSearch;
  readonly setSearch: (next: CompaniesSearch) => void;
  readonly refresh: () => void;
}) {
  const t = useZenText(companiesText);
  const result = useAtomValue(companiesListAtom(environmentId));
  const data = AsyncResult.getOrElse(result, () => null);
  const isInternal = useIsInternalFolder();
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !isInternal(project),
  );
  const index = buildCompanyIndex([{ environmentId, data }]);
  const selected =
    data?.companies.find((company) => company.id === search.company) ?? data?.companies[0] ?? null;
  const tab = search.tab ?? "projects";

  if (result._tag === "Failure" && data === null) {
    return (
      <p className="text-destructive-foreground text-sm">
        {zenErrorMessage(result.cause, t.loadFailed)}
      </p>
    );
  }
  if (data === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  const projectCount = (companyId: string) =>
    projects.filter((project) => companyOfProject(index, environmentId, project.id) === companyId)
      .length;

  return (
    <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2" aria-label={t.listLabel}>
        <ul className="flex flex-col gap-1">
          {data.companies.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                data-zen-company={company.id}
                onClick={() => setSearch({ company: company.id, tab })}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left outline-hidden ring-ring hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset",
                  selected?.id === company.id
                    ? "border-primary/50 bg-accent"
                    : "border-transparent",
                )}
              >
                <CompanyBadge company={company} className="size-7 rounded-md" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-sm">{company.name}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {t.projectCount(projectCount(company.id))}
                    {company.isDefault ? t.defaultSuffix : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <NewCompanyForm
          environmentId={environmentId}
          onCreated={(company) => {
            refresh();
            setSearch({ company: company.id, tab: "projects" });
          }}
        />
      </aside>
      {selected === null ? null : (
        <section
          className="flex min-w-0 flex-col gap-4 rounded-xl border p-4"
          aria-label={selected.name}
        >
          <header className="flex min-w-0 flex-wrap items-center gap-3">
            <CompanyBadge company={selected} className="size-9 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 className="truncate font-semibold text-base">{selected.name}</h2>
              <span className="truncate font-mono text-muted-foreground text-xs">
                {selected.memoryDirectory ?? t.ownMemorySetting}
              </span>
            </div>
            <ShowCompanyInSidebar companyId={selected.id} />
          </header>
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[tab]}
            onValueChange={(next) => {
              const value = next[0];
              if (
                value === "projects" ||
                value === "memory" ||
                value === "files" ||
                value === "settings"
              ) {
                setSearch({ company: selected.id, tab: value });
              }
            }}
          >
            <Toggle value="projects">{t.tabProjects}</Toggle>
            <Toggle value="memory">{t.tabMemory}</Toggle>
            <Toggle value="files">{t.tabMemoryFiles}</Toggle>
            <Toggle value="settings">{t.tabSettings}</Toggle>
          </ToggleGroup>
          {tab === "projects" ? (
            <ProjectsTab
              environmentId={environmentId}
              company={selected}
              projects={projects}
              companyOf={(projectId) => companyOfProject(index, environmentId, projectId)}
              companies={data.companies}
            />
          ) : null}
          {tab === "memory" && !selected.isDefault ? (
            <CompanyMemoryTab
              environmentId={environmentId}
              company={selected}
              companies={data.companies}
              onOpenSettings={() => setSearch({ company: selected.id, tab: "settings" })}
            />
          ) : null}
          {tab === "memory" && selected.isDefault ? (
            <PersonalMemoryPanel environmentId={environmentId} companies={data.companies} />
          ) : null}
          {tab === "files" ? <MemoryTab environmentId={environmentId} company={selected} /> : null}
          {tab === "settings" ? (
            <div className="flex flex-col gap-6">
              <SettingsTab
                key={selected.id}
                environmentId={environmentId}
                company={selected}
                onSaved={refresh}
                onDeleted={() => {
                  refresh();
                  setSearch({});
                }}
              />
              <CompanyProfileSection environmentId={environmentId} company={selected} />
              <CompanyMemoryConnection environmentId={environmentId} company={selected} />
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function ShowCompanyInSidebar({ companyId }: { readonly companyId: string }) {
  const t = useZenText(companiesText);
  const selected = useSelectedCompanyStore((store) => store.selectedCompanyId);
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  if (selected === companyId) {
    return (
      <Badge variant="secondary" size="sm">
        <CheckIcon className="size-3" aria-hidden /> {t.shownInSidebar}
      </Badge>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={() => setSelected(companyId)}>
      {t.showInSidebar}
    </Button>
  );
}

function NewCompanyForm({
  environmentId,
  onCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly onCreated: (company: ZenCompany) => void;
}) {
  const t = useZenText(companiesText);
  const create = useAtomCommand(companyCreate, { reportFailure: false });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    const result = await create({ environmentId, input: { name: trimmed } });
    setBusy(false);
    if (result._tag === "Success") {
      setName("");
      onCreated(result.value);
      return;
    }
    toastManager.add({
      type: "error",
      title: t.createFailed,
      description: zenErrorMessage(result.cause, t.tryAgain),
    });
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        aria-label={t.newCompanyName}
        placeholder={t.newCompanyPlaceholder}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        type="submit"
        size="icon-sm"
        variant="outline"
        aria-label={t.createCompany}
        disabled={busy || name.trim().length === 0}
      >
        <PlusIcon />
      </Button>
    </form>
  );
}

function ProjectsTab({
  environmentId,
  company,
  projects,
  companyOf,
  companies,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
  readonly projects: ReturnType<typeof useProjects>;
  readonly companyOf: (projectId: string) => string;
  readonly companies: ReadonlyArray<ZenCompany>;
}) {
  const t = useZenText(companiesText);
  const assign = useAssignProjectsToCompany();
  const personal = companies.find((candidate) => candidate.isDefault) ?? null;
  const inCompany = projects.filter((project) => companyOf(project.id) === company.id);
  const others = projects.filter((project) => companyOf(project.id) !== company.id);
  const nameOf = (companyId: string) =>
    companies.find((candidate) => candidate.id === companyId)?.name ?? companyId;
  const move = (projectId: (typeof projects)[number]["id"], target: ZenCompany) =>
    void assign([{ environmentId, projectId }], target);

  return (
    <div className="flex flex-col gap-4">
      <ProjectList
        title={t.inCompany(company.name)}
        empty={company.isDefault ? t.emptyDefault : t.emptyCompany}
        rows={inCompany.map((project) => ({
          key: project.id,
          project,
          detail: project.workspaceRoot,
          action:
            company.isDefault || personal === null ? null : (
              <Button size="xs" variant="ghost" onClick={() => move(project.id, personal)}>
                {t.remove}
              </Button>
            ),
        }))}
      />
      <ProjectList
        title={t.otherProjects}
        empty={t.noOtherProjects}
        rows={others.map((project) => ({
          key: project.id,
          project,
          detail: nameOf(companyOf(project.id)),
          action: (
            <Button size="xs" variant="outline" onClick={() => move(project.id, company)}>
              {t.moveHere}
            </Button>
          ),
        }))}
      />
    </div>
  );
}

function ProjectList({
  title,
  empty,
  rows,
}: {
  readonly title: string;
  readonly empty: string;
  readonly rows: ReadonlyArray<{
    readonly key: string;
    readonly project: ReturnType<typeof useProjects>[number];
    readonly detail: string;
    readonly action: ReactNode;
  }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="px-1 font-medium text-muted-foreground text-xs">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-1 text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.key} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
              <ProjectFavicon project={row.project} className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{row.project.title}</span>
                <span className="truncate text-muted-foreground text-xs">{row.detail}</span>
              </span>
              {row.action}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemoryTab({
  environmentId,
  company,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
}) {
  const t = useZenText(companiesText);
  const locale = useZenLocale();
  const result = useAtomValue(
    companyMemoryList({ environmentId, input: { companyId: company.id } }),
  );
  const data = AsyncResult.getOrElse(result, () => null);
  const read = useAtomCommand(companyReadMemory, { reportFailure: false });
  const [open, setOpen] = useState<{
    readonly relativePath: string;
    readonly content: string;
    readonly truncated: boolean;
  } | null>(null);
  const openFile = async (file: ZenCompanyMemoryFile) => {
    const response = await read({
      environmentId,
      input: { companyId: company.id, relativePath: file.relativePath },
    });
    if (response._tag === "Success") {
      setOpen(response.value);
      return;
    }
    toastManager.add({
      type: "error",
      title: t.openMemoryFailed,
      description: zenErrorMessage(response.cause, t.tryAgain),
    });
  };

  if (data === null) {
    return result._tag === "Failure" ? (
      <p className="text-destructive-foreground text-sm">
        {zenErrorMessage(result.cause, t.listMemoryFailed)}
      </p>
    ) : (
      <Skeleton className="h-24 w-full" />
    );
  }
  if (data.directory === null) {
    return <p className="text-muted-foreground text-sm">{t.usesOwnMemory(company.name)}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
        <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate font-mono">{data.directory}</span>
      </div>
      {data.files.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noMemory}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-label={t.memoryFiles}>
          {data.files.map((file) => (
            <li key={file.relativePath}>
              <button
                type="button"
                onClick={() => void openFile(file)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left hover:bg-accent",
                  open?.relativePath === file.relativePath && "bg-accent",
                )}
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {file.relativePath}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {formatBytes(file.sizeBytes)} · {formatZenRelativeTime(locale, file.modifiedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open === null ? null : (
        <div className="flex min-w-0 flex-col gap-1.5" aria-label={t.contentsOf(open.relativePath)}>
          <div className="flex items-center gap-2 px-1">
            <span className="truncate font-medium font-mono text-xs">{open.relativePath}</span>
            {open.truncated ? (
              <Badge variant="secondary" size="sm">
                {t.firstMegabyte}
              </Badge>
            ) : null}
            <div className="flex-1" />
            <Button size="xs" variant="ghost" onClick={() => setOpen(null)}>
              {t.close}
            </Button>
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {open.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  environmentId,
  company,
  onSaved,
  onDeleted,
}: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
  readonly onSaved: () => void;
  readonly onDeleted: () => void;
}) {
  const t = useZenText(companiesText);
  const update = useAtomCommand(companyUpdate, { reportFailure: false });
  const remove = useAtomCommand(companyDelete, { reportFailure: false });
  const [name, setName] = useState(company.name);
  const [color, setColor] = useState(company.color);
  const [icon, setIcon] = useState(company.icon);
  const [memoryDirectory, setMemoryDirectory] = useState(company.customMemoryDirectory ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    name.trim() !== company.name ||
    color !== company.color ||
    icon !== company.icon ||
    memoryDirectory.trim() !== (company.customMemoryDirectory ?? "");

  const save = async () => {
    setBusy(true);
    const result = await update({
      environmentId,
      input: {
        id: company.id,
        ...(name.trim().length > 0 ? { name: name.trim() } : {}),
        color,
        icon,
        memoryDirectory: memoryDirectory.trim().length === 0 ? null : memoryDirectory.trim(),
      },
    });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: t.saved });
      onSaved();
      return;
    }
    toastManager.add({
      type: "error",
      title: t.saveFailed,
      description: zenErrorMessage(result.cause, t.tryAgain),
    });
  };
  const doDelete = async () => {
    setBusy(true);
    const result = await remove({ environmentId, input: { id: company.id } });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: t.deleted(company.name),
        description: t.deletedDescription(result.value.reassignedProjectCount),
      });
      onDeleted();
      return;
    }
    toastManager.add({
      type: "error",
      title: t.deleteFailed,
      description: zenErrorMessage(result.cause, t.tryAgain),
    });
  };

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t.name}</span>
        <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium">{t.color}</legend>
        <div className="flex flex-wrap gap-2">
          {ZEN_COMPANY_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={t.colorOption(swatch)}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
              className={cn(
                "grid size-7 place-items-center rounded-md text-white ring-offset-2 ring-offset-background",
                color === swatch && "ring-2 ring-ring",
              )}
              style={{ backgroundColor: swatch }}
            >
              {color === swatch ? <CheckIcon className="size-4" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium">{t.icon}</legend>
        <div className="flex flex-wrap gap-2">
          {ZEN_COMPANY_ICONS.map((name) => {
            return (
              <button
                key={name}
                type="button"
                aria-label={t.iconOption(name)}
                aria-pressed={icon === name}
                onClick={() => setIcon(name)}
                className={cn(
                  "grid size-8 place-items-center rounded-md border hover:bg-accent",
                  icon === name && "border-primary bg-accent",
                )}
              >
                <CompanyIcon icon={name} className="size-4" />
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t.memoryDirectory}</span>
        <Input
          value={memoryDirectory}
          placeholder={
            company.isDefault
              ? t.memoryPlaceholderDefault
              : t.memoryPlaceholder(company.memoryDirectory)
          }
          onChange={(event) => setMemoryDirectory(event.target.value)}
        />
        <span className="text-muted-foreground text-xs">{t.memoryHint}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !dirty}>
          {t.save}
        </Button>
        <div className="flex-1" />
        {company.isDefault ? null : confirmDelete ? (
          <>
            <span className="text-muted-foreground text-xs">{t.deleteWarning}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void doDelete()}
            >
              {t.deleteCompany}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            onClick={() => setConfirmDelete(true)}
          >
            {t.delete}
          </Button>
        )}
      </div>
    </form>
  );
}
