// Zen Staff: the Office home ("Birou"), in the Registru look. A greeting on the painted panel, an
// "ask anything" box that starts a chat in the chosen folder, "Lucrezi în: <folder> · schimbă",
// "Your company today", "Continuă" (open chats, the ones waiting for you first) and the ready tasks
// as cards with a category filter. A card opens a chat (Office) or its form (Code).
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import {
  localizeWorkflowManifest,
  type ZenWorkflow,
  type ZenWorkflowCategory,
  type ZenWorkflowInput,
} from "@t3tools/contracts/zenOffice";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  CheckIcon,
  FolderIcon,
  FolderOpenIcon,
  HandIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StoreIcon,
  UnplugIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { ZenAiAccountBanner } from "../aiAccount/AiAccountPanel";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../components/ui/menu";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { CATEGORY_TEXT, officeText } from "./office.i18n";
import {
  groupWorkflowsByCategory,
  isScratchThreadFolder,
  matchesSearch,
  officeWorkflows,
} from "./officeState";
import { OfficePageShell } from "./OfficePageShell";
import { companyOfProject } from "../companies/companiesModel";
import { useOfficeCompany } from "./useOfficeCompany";
import { IntakeStarter } from "../intake/IntakeStarter";
import { clearOfficeIntake, useOfficeIntake } from "../intake/intakeHandover";
import { CompanyTodayCard } from "../hub/CompanyTodayCard";
import { WorkflowIcon } from "./workflowIcons";
import { WorkflowPinButton } from "../navigation/WorkflowPinButton";
import { ZenToolchainBadge } from "../toolchains/ToolchainBadge";
import { useHubQuery } from "../hub/hubClient";
import { Bone, EmptyState, PenWord, SectionHeading, Tag } from "../ui/Registru";
import { officeHomeText } from "./officeHome.i18n";
import { continueItems, dayPart, firstName, type ContinueState } from "./officeHome.logic";
import { useStartChat } from "./useStartChat";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { WorkflowFileInput, type WorkflowUploadTarget } from "./WorkflowFileInput";
import { CustomizeDialog, DraftReviewDialog, useCustomPacks } from "./CustomPacks";
import { customPacksText } from "./customPacks.i18n";
import { customPackFor, isCustomizable } from "./customPacksState";
import type { ZenCustomPackView } from "@t3tools/contracts/zenOffice";
import { peekOfficePrefill, takeOfficePrefill } from "./officePrefill";
import { useZenAddFolder } from "./addFolderStore";
import { useEnsureCompanyFolder } from "../companies/companyFolder";

const PROJECT_KEY = "zen:office:project";

function readStoredProject(): string | null {
  try {
    return globalThis.localStorage?.getItem(PROJECT_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeProject(key: string) {
  try {
    globalThis.localStorage?.setItem(PROJECT_KEY, key);
  } catch {
    // Remembering the folder is a convenience only.
  }
}

const projectKey = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;

export function OfficeHomePage() {
  const t = useZenText(officeText);
  const h = useZenText(officeHomeText);
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  // Chat-first in both editions: every task start (a card, the Bibliotecă, "Fluxurile mele",
  // Ctrl+K, a deep link, the onboarding hand-over) opens a chat where the agent asks for what it
  // needs. There is no launch form.
  const [open, setOpen] = useState<{
    readonly workflow: ZenWorkflow;
    readonly known?: Readonly<Record<string, string>>;
  } | null>(null);
  const company = useOfficeCompany();
  // With a company chosen in the sidebar, only its folders are offered. Internal chat folders
  // (Scratch) never show here.
  const { environments } = useEnvironments();
  const scratchRootOf = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.scratchWorkspaceRoot ?? null;
  const projects = useProjects()
    .filter((project) => project.archivedAt == null && !project.isScratch)
    .filter(
      (project) =>
        !isScratchThreadFolder(project.workspaceRoot, scratchRootOf(project.environmentId)),
    )
    .filter(
      (project) =>
        company.companyId === null ||
        companyOfProject(company.index, project.environmentId, project.id) === company.companyId,
    )
    .toSorted((left, right) => Number(right.pinnedAt != null) - Number(left.pinnedAt != null));
  const [chosenProject, setChosenProject] = useState<string | null>(readStoredProject);
  const project =
    projects.find((candidate) => projectKey(candidate) === chosenProject) ?? projects[0] ?? null;
  const choose = (next: EnvironmentProject) => {
    setChosenProject(projectKey(next));
    storeProject(projectKey(next));
  };
  // No folder yet: the company's own folder (~/Zen Staff/<Company>) is made and chosen, so a
  // first task never stops at "add a folder first".
  const ensureCompanyFolder = useEnsureCompanyFolder(environmentId);
  const [noFolder, setNoFolder] = useState(false);
  const folderForWork = async (): Promise<EnvironmentProject | null> => {
    if (project !== null) return project;
    const made = await ensureCompanyFolder(company.companyId ?? ZEN_PERSONAL_COMPANY_ID).catch(
      () => null,
    );
    if (made !== null) choose(made);
    return made;
  };

  return (
    <OfficePageShell
      title={t.officeTitle}
      registru
      actions={
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/library" })}>
            <StoreIcon />
            {t.marketplace}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigate({ to: "/workflow-editor" })}
          >
            <PlusIcon />
            {h.newTask}
          </Button>
        </div>
      }
    >
      <ZenAiAccountBanner />
      <HomeHero
        environmentId={environmentId}
        projects={projects}
        project={project}
        folderForWork={folderForWork}
        onChoose={choose}
      />
      {environmentId !== null ? <CompanyTodayCard environmentId={environmentId} /> : null}
      {environmentId !== null ? (
        <ContinueRow
          projects={projects}
          scratchRootOf={scratchRootOf}
          onOpen={(environmentId, threadId) =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
              ),
            })
          }
        />
      ) : null}
      {environmentId === null ? (
        <EmptyState icon={UnplugIcon} title={t.notConnected} body={t.waitingToConnect} />
      ) : (
        <WorkflowGrid
          environmentId={environmentId}
          onOpen={(workflow, known) => {
            void folderForWork().then((folder) => {
              if (folder === null) setNoFolder(true);
              else setOpen(known ? { workflow, known } : { workflow });
            });
          }}
        />
      )}
      {open && project ? (
        <IntakeStarter
          workflow={open.workflow}
          project={project}
          {...(open.known ? { known: open.known } : {})}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {noFolder ? <NoFolderDialog onClose={() => setNoFolder(false)} /> : null}
    </OfficePageShell>
  );
}

/** The greeting on the painted panel, the "ask anything" box and the folder line. */
function HomeHero(props: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly project: EnvironmentProject | null;
  readonly folderForWork: () => Promise<EnvironmentProject | null>;
  readonly onChoose: (project: EnvironmentProject) => void;
}) {
  const h = useZenText(officeHomeText);
  return (
    <section className="zr-art -mx-1 flex flex-col gap-6 px-6 pt-10 pb-6 sm:px-10 sm:pt-12">
      <div className="flex flex-col gap-2">
        {props.environmentId !== null ? (
          <HubGreeting environmentId={props.environmentId} />
        ) : (
          <Greeting name={null} />
        )}
        <p className="zr-soft max-w-xl text-base">{h.greetingSub}</p>
      </div>
      {props.environmentId !== null ? (
        <AskBox
          environmentId={props.environmentId}
          project={props.project}
          folderForWork={props.folderForWork}
        />
      ) : null}
      <FolderLine projects={props.projects} value={props.project} onChange={props.onChoose} />
    </section>
  );
}

/** With the signed-in hub person's first name, when there is one. */
function HubGreeting(props: { readonly environmentId: EnvironmentId }) {
  const { data: status } = useHubQuery<ZenHubStatus>(props.environmentId, "status");
  return <Greeting name={firstName(status?.user?.name)} />;
}

function Greeting(props: { readonly name: string | null }) {
  const h = useZenText(officeHomeText);
  const [now] = useState(() => new Date());
  return (
    <h2 className="zr-title" data-zen-greeting>
      {h.greeting[dayPart(now)]}
      {props.name ? (
        <>
          , <span className="zr-accent">{props.name}</span>
        </>
      ) : null}
      .<br />
      {h.whatToday[0]} <PenWord>{h.whatToday[1]}</PenWord>?
    </h2>
  );
}

function AskBox(props: {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject | null;
  readonly folderForWork: () => Promise<EnvironmentProject | null>;
}) {
  const h = useZenText(officeHomeText);
  const startChat = useStartChat(props.environmentId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setError(null);
    setBusy(true);
    const folder = await props.folderForWork();
    if (folder === null) {
      setBusy(false);
      setError(h.askNoFolder);
      return;
    }
    const failure = await startChat({ project: folder, text });
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="zr-ask max-w-3xl">
        <textarea
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={h.askPlaceholder}
          aria-label={h.askLabel}
          data-zen-ask
        />
        <button
          type="submit"
          className="zr-btn zr-btn-loud shrink-0"
          disabled={busy || !text.trim()}
          data-zen-ask-send
        >
          {busy ? <Spinner className="size-4" /> : <ArrowUpIcon />}
          {busy ? h.askStarting : h.askSend}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive-foreground text-sm">
          {error}
        </p>
      ) : (
        <p className="zr-muted hidden text-xs sm:block">{h.askHint}</p>
      )}
    </form>
  );
}

/** No folder yet: one is made on the first task; "Alege un dosar" adds one now. */
function FolderLineEmpty() {
  const t = useZenText(officeText);
  const showAddFolder = useZenAddFolder((store) => store.show);
  return (
    <p className="zr-soft flex flex-wrap items-center gap-1.5 text-sm" data-zen-folder>
      <FolderOpenIcon className="size-4" aria-hidden />
      <span>{t.addFolderToStart}</span>
      <button type="button" className="zr-link" onClick={showAddFolder}>
        {t.chooseFolder}
      </button>
    </p>
  );
}

/** "Lucrezi în: Marketing · schimbă". Only folders a person made; never internal chat folders. */
function FolderLine(props: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly value: EnvironmentProject | null;
  readonly onChange: (project: EnvironmentProject) => void;
}) {
  const h = useZenText(officeHomeText);
  if (props.projects.length === 0) {
    return <FolderLineEmpty />;
  }
  return (
    <div className="zr-soft flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm" data-zen-folder>
      <FolderOpenIcon className="size-4" aria-hidden />
      <span>{h.workingIn}:</span>
      <span className="font-semibold text-zr-ink">{props.value?.title ?? h.noFolder}</span>
      {props.projects.length > 1 ? (
        <>
          <span aria-hidden>·</span>
          <Menu>
            <MenuTrigger
              render={<button type="button" className="zr-link" />}
              aria-label={h.chooseFolderTitle}
            >
              {h.change}
            </MenuTrigger>
            <MenuPopup align="start" className="min-w-56">
              <MenuGroup>
                <MenuGroupLabel>{h.chooseFolderTitle}</MenuGroupLabel>
                {props.projects.map((project) => (
                  <MenuItem key={projectKey(project)} onClick={() => props.onChange(project)}>
                    <FolderIcon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{project.title}</span>
                    {props.value && projectKey(props.value) === projectKey(project) ? (
                      <CheckIcon className="size-4" aria-hidden />
                    ) : null}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        </>
      ) : null}
    </div>
  );
}

const CONTINUE_ICON: Record<ContinueState, LucideIcon> = {
  "needs-you": HandIcon,
  working: LoaderCircleIcon,
  recent: MessageSquareIcon,
};

/** "Continuă": open chats in these folders, the ones waiting for the person first. */
function ContinueRow(props: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly scratchRootOf: (environmentId: string) => string | null;
  readonly onOpen: (environmentId: string, threadId: string) => void;
}) {
  const h = useZenText(officeHomeText);
  const locale = useZenLocale();
  const shells = useThreadShells();
  const folders = new Map(props.projects.map((project) => [projectKey(project), project]));
  const items = continueItems(
    shells.map((shell) => ({
      id: shell.id,
      environmentId: shell.environmentId,
      projectId: shell.projectId,
      title: shell.title,
      updatedAt: shell.updatedAt,
      archivedAt: shell.archivedAt,
      settled: shell.settledOverride === "settled",
      needsYou: shell.hasPendingApprovals || shell.hasPendingUserInput,
      working: threadRuntimeIsActive(shell.runtime),
    })),
    (environmentId, projectId) => folders.has(`${environmentId}:${projectId}`),
  );
  return (
    <section className="flex flex-col gap-4" aria-label={h.continueTitle}>
      <SectionHeading title={h.continueTitle} />
      {items.length === 0 ? (
        <p className="zr-muted text-sm">{h.continueEmpty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-zen-continue>
          {items.map((item) => {
            const Icon = CONTINUE_ICON[item.state];
            const folder = folders.get(`${item.thread.environmentId}:${item.thread.projectId}`);
            return (
              <button
                key={`${item.thread.environmentId}:${item.thread.id}`}
                type="button"
                onClick={() => props.onOpen(item.thread.environmentId, item.thread.id)}
                className="zr-card zr-card-hover flex flex-col gap-3 p-4 text-left"
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-semibold text-xs",
                    item.state === "needs-you" ? "text-zr-loud-text" : "zr-muted",
                  )}
                >
                  <Icon
                    className={cn("size-3.5", item.state === "working" && "animate-spin")}
                    aria-hidden
                  />
                  {h.continueState[item.state]}
                </span>
                <span className="line-clamp-2 font-semibold text-base leading-snug">
                  {item.thread.title}
                </span>
                <span className="zr-muted mt-auto truncate text-xs">
                  {folder?.title}
                  {folder ? " · " : ""}
                  {formatRelative(item.thread.updatedAt, locale)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatRelative(iso: string, locale: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale === "ro" ? "ro" : "en", { numeric: "auto" });
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return format.format(-Math.max(minutes, 0), "minute");
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), "hour");
  return format.format(-Math.round(minutes / (60 * 24)), "day");
}

function WorkflowGrid(props: {
  readonly environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
  readonly onOpen: (workflow: ZenWorkflow, known?: Readonly<Record<string, string>>) => void;
}) {
  const t = useZenText(officeText);
  const h = useZenText(officeHomeText);
  const categories = useZenText(CATEGORY_TEXT);
  const locale = useZenLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ZenWorkflowCategory | null>(null);
  const { workflowsInput } = useOfficeCompany();
  const result = useAtomValue(
    officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
  );
  // A first task handed over by the onboarding interview opens once, as a chat that already
  // knows its sample answers.
  const loaded = AsyncResult.isSuccess(result) ? result.value.workflows : null;
  const pendingPrefill = peekOfficePrefill()?.workflowId ?? null;
  const prefillSource = loaded?.find((workflow) => workflow.manifest.id === pendingPrefill);
  const prefillOpened = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the chat once for the sessionStorage hand-over from the onboarding interview, when the list arrives.
  useEffect(() => {
    if (prefillSource === undefined || prefillOpened.current === prefillSource.manifest.id) return;
    prefillOpened.current = prefillSource.manifest.id;
    const target = {
      ...prefillSource,
      manifest: localizeWorkflowManifest(prefillSource.manifest, locale),
    };
    const known = takeOfficePrefill(
      prefillSource.manifest.id,
      target.manifest.inputs,
      prefillSource.manifest.inputs,
    );
    props.onOpen(target, known);
  }, [prefillSource, locale, props]);
  // "Folosește" in the Magazin, the sidebar's "My workflows" or the command palette: that
  // workflow's chat (the form in Code) opens once, when the list arrives.
  const pendingIntake = useOfficeIntake();
  const intakeSource = loaded?.find((workflow) => workflow.manifest.id === pendingIntake);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the chat once for the sessionStorage hand-over from the Magazin, when the list arrives.
  useEffect(() => {
    if (intakeSource === undefined) return;
    clearOfficeIntake();
    props.onOpen({
      ...intakeSource,
      manifest: localizeWorkflowManifest(intakeSource.manifest, locale),
    });
  }, [intakeSource, locale, props]);

  const heading = (
    <SectionHeading
      title={h.tasksTitle}
      detail={<span className="hidden md:inline">{h.tasksSub}</span>}
    />
  );
  if (result._tag === "Failure") {
    return (
      <section className="flex flex-col gap-4">
        {heading}
        <p className="text-destructive-foreground text-sm">{t.tasksLoadFailed}</p>
      </section>
    );
  }
  if (!AsyncResult.isSuccess(result)) {
    return (
      <section className="flex flex-col gap-4" aria-busy>
        {heading}
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Bone key={index} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="zr-card flex flex-col gap-3 p-5">
              <Bone className="size-11 rounded-xl" />
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </section>
    );
  }
  // Cards, forms and thread titles use the workflow's text in the app's language.
  const all = result.value.workflows.map((workflow) => ({
    ...workflow,
    manifest: localizeWorkflowManifest(workflow.manifest, locale),
  }));
  const groups = groupWorkflowsByCategory(all);
  const workflows = all
    .filter((workflow) => category === null || workflow.manifest.category === category)
    .filter((workflow) =>
      matchesSearch(query, [
        workflow.manifest.name,
        workflow.manifest.description,
        categories[workflow.manifest.category],
      ]),
    );
  const search = (
    <label className="zr-search w-full sm:w-64">
      <SearchIcon className="zr-muted size-4 shrink-0" aria-hidden />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={h.searchPlaceholder}
        aria-label={h.searchTasks}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zr-ink-4"
      />
    </label>
  );
  // "Toate" without a search shows the tasks grouped by category; a filter or search, one grid.
  const sections =
    category === null && query.trim() === ""
      ? groupWorkflowsByCategory(workflows).map((group) => ({
          key: group.category,
          title: categories[group.category] as string | null,
          workflows: group.workflows,
        }))
      : [{ key: "all", title: null, workflows }];
  return (
    <section className="flex flex-col gap-5" aria-label={h.tasksTitle}>
      <SectionHeading
        title={h.tasksTitle}
        detail={<span className="hidden lg:inline">{h.tasksSub}</span>}
        action={search}
      />
      <div className="zr-tabs" role="tablist" aria-label={h.tasksTitle}>
        <button
          type="button"
          role="tab"
          aria-selected={category === null}
          className="zr-tab"
          onClick={() => setCategory(null)}
        >
          {h.allCategories}
        </button>
        {groups.map((group) => (
          <button
            key={group.category}
            type="button"
            role="tab"
            aria-selected={category === group.category}
            className="zr-tab"
            onClick={() => setCategory(group.category)}
            data-zen-category={group.category}
          >
            {categories[group.category]}
          </button>
        ))}
      </div>
      <WorkflowCards
        environmentId={props.environmentId}
        sections={sections}
        query={query}
        problems={result.value.problems}
        onOpen={props.onOpen}
      />
    </section>
  );
}

function WorkflowCards(props: {
  readonly environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
  readonly sections: ReadonlyArray<{
    readonly key: string;
    readonly title: string | null;
    readonly workflows: ReadonlyArray<ZenWorkflow>;
  }>;
  readonly query: string;
  readonly problems: ReadonlyArray<{ readonly location: string; readonly message: string }>;
  readonly onOpen: (workflow: ZenWorkflow) => void;
}) {
  const t = useZenText(officeText);
  const customPacks = useCustomPacks(props.environmentId);
  const [customizing, setCustomizing] = useState<ZenWorkflow | null>(null);
  const [reviewing, setReviewing] = useState<ZenCustomPackView | null>(null);
  return (
    <>
      {props.sections.every((section) => section.workflows.length === 0) ? (
        <EmptyState icon={SearchIcon} title={t.noTaskMatches(props.query)} />
      ) : (
        props.sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-3" data-zen-workflows={section.key}>
            {section.title ? <h4 className="zr-h3 mt-3">{section.title}</h4> : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {section.workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.manifest.id}
                  workflow={workflow}
                  showCategory={section.title === null}
                  customPack={customPackFor(customPacks, workflow.manifest.id)}
                  onOpen={() => props.onOpen(workflow)}
                  onCustomize={() => setCustomizing(workflow)}
                  onReview={setReviewing}
                />
              ))}
            </div>
          </div>
        ))
      )}
      {customizing ? (
        <CustomizeDialog
          environmentId={props.environmentId}
          workflowId={customizing.manifest.id}
          name={customizing.manifest.name}
          onClose={() => setCustomizing(null)}
        />
      ) : null}
      {reviewing ? (
        <DraftReviewDialog
          environmentId={props.environmentId}
          pack={reviewing}
          onClose={() => setReviewing(null)}
        />
      ) : null}
      {props.problems.length > 0 ? (
        <details className="zr-muted text-xs">
          <summary>{t.workflowsNotLoaded(props.problems.length)}</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {props.problems.map((problem) => (
              <li key={problem.location}>
                {problem.location}: {problem.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function WorkflowCard(props: {
  readonly workflow: ZenWorkflow;
  /** Off inside a category's own section, where the heading already says it. */
  readonly showCategory: boolean;
  readonly customPack: ZenCustomPackView | null;
  readonly onOpen: () => void;
  readonly onCustomize: () => void;
  readonly onReview: (pack: ZenCustomPackView) => void;
}) {
  const t = useZenText(officeText);
  const h = useZenText(officeHomeText);
  const k = useZenText(customPacksText);
  const categories = useZenText(CATEGORY_TEXT);
  const { manifest, source, editable, customization } = props.workflow;
  const draft = props.customPack?.hasDraft ? props.customPack : null;
  const owner = customization
    ? h.customized
    : source === "company"
      ? h.companyTask
      : source !== "builtin" && !props.workflow.packId
        ? h.yourTask
        : null;
  return (
    <div className="group relative flex" data-zen-workflow={manifest.id}>
      <button
        type="button"
        onClick={props.onOpen}
        className="zr-card zr-card-hover flex w-full flex-col gap-3 p-5 text-left"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zr-ink text-zr-paper">
            <WorkflowIcon name={manifest.icon} className="size-5" />
          </span>
          <span className="flex flex-wrap justify-end gap-1.5">
            {props.showCategory ? <Tag>{categories[manifest.category]}</Tag> : null}
            {owner ? <Tag>{owner}</Tag> : null}
            <ZenToolchainBadge workflowId={manifest.id} hideReady />
          </span>
        </span>
        <span className="line-clamp-2 font-semibold text-base leading-snug">{manifest.name}</span>
        <span className="zr-muted line-clamp-2 text-sm leading-relaxed">
          {manifest.description}
        </span>
      </button>
      {draft ? (
        <button
          type="button"
          onClick={() => props.onReview(draft)}
          className="zr-tag zr-tag-loud absolute right-4 bottom-4"
        >
          {h.draftWaiting}
        </button>
      ) : null}
      <WorkflowPinButton
        workflowIds={[manifest.id]}
        name={manifest.name}
        className={cn(
          "absolute bottom-2.5 hidden focus-visible:flex group-hover:flex data-pinned:flex",
          isCustomizable(props.workflow) || editable ? "right-10" : "right-2.5",
        )}
      />
      {isCustomizable(props.workflow) ? (
        <button
          type="button"
          onClick={props.onCustomize}
          aria-label={k.customizeNamed(manifest.name)}
          className="zr-muted absolute right-3 bottom-3 hidden rounded-md p-1.5 hover:bg-zr-tint focus-visible:flex group-hover:flex"
          data-zen-customize={manifest.id}
        >
          <WandSparklesIcon className="size-3.5" />
        </button>
      ) : null}
      {editable ? (
        <Link
          to="/workflow-editor"
          search={{ id: manifest.id }}
          aria-label={t.editNamed(manifest.name)}
          className="zr-muted absolute right-3 bottom-3 hidden rounded-md p-1.5 hover:bg-zr-tint group-hover:flex"
        >
          <PencilIcon className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function NoFolderDialog({ onClose }: { readonly onClose: () => void }) {
  const t = useZenText(officeText);
  const showAddFolder = useZenAddFolder((store) => store.show);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.addFolderFirst}</DialogTitle>
          <DialogDescription>{t.addFolderFirstBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t.ok}
          </Button>
          <Button
            onClick={() => {
              onClose();
              showAddFolder();
            }}
          >
            {t.chooseFolder}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function WorkflowInputField(props: {
  readonly input: ZenWorkflowInput;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly folderName?: string;
  /** Where "Choose a file" copies a file input's file; without it only a path can be typed. */
  readonly upload?: WorkflowUploadTarget;
}) {
  const t = useZenText(officeText);
  const { input } = props;
  const id = `workflow-input-${input.id}`;
  const label = (
    <Label htmlFor={id}>
      {input.label}
      {input.required ? null : (
        <span className="font-normal text-muted-foreground"> {t.optional}</span>
      )}
    </Label>
  );
  let control;
  if (input.type === "longtext") {
    control = (
      <Textarea
        id={id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={input.placeholder}
        rows={4}
      />
    );
  } else if (input.type === "select") {
    control = (
      <Select value={props.value} onValueChange={(value) => props.onChange(String(value ?? ""))}>
        <SelectTrigger id={id} aria-label={input.label}>
          <SelectValue>{props.value || t.choose}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          {(input.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  } else if (input.type === "file") {
    control = (
      <WorkflowFileInput
        id={id}
        value={props.value}
        placeholder={input.placeholder}
        onChange={props.onChange}
        upload={props.upload}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        type={input.type === "url" ? "url" : "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={input.placeholder ?? (input.type === "url" ? "https://" : undefined)}
      />
    );
  }
  const help = input.help ?? (input.type === "file" ? t.fileHelp(props.folderName) : undefined);
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {control}
      {help ? <p className="text-muted-foreground text-xs">{help}</p> : null}
    </div>
  );
}
