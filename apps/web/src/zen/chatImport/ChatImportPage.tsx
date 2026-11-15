// Zen Staff chat imports: upload an export, pick conversations and their projects (ChatGPT /
// Claude.ai projects become folders), import them as read-only threads, continue any in a new
// chat, and optionally send their useful parts to company memory (previewed, opt-in).
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import {
  ZEN_IMPORT_LIMITS,
  type ZenImportSource,
  type ZenImportedThread,
  type ZenImportsMemoryItem,
} from "@t3tools/contracts/zenImports";
import { useNavigate } from "@tanstack/react-router";
import JSZip from "jszip";
import {
  BotIcon,
  BrainIcon,
  FileUpIcon,
  FolderIcon,
  FolderTreeIcon,
  MessagesSquareIcon,
  SquareTerminalIcon,
  StarIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useContext, useRef, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { InputGroup, InputGroupInput } from "../../components/ui/input-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner";
import { toastManager } from "../../components/ui/toast";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { OfficePageShell } from "../office/OfficePageShell";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import {
  companiesListAtom,
  companyAssignProject,
  useActiveCompanyId,
  useCompanyIndex,
} from "../companies/companiesState";
import { chatImportText } from "./chatImport.i18n";
import {
  continueImport,
  createImportProject,
  createImports,
  importBatches,
  importedThreadsList,
  previewImportMemory,
  saveImportMemory,
  sendImportMemory,
} from "./chatImportState";
import {
  detectExport,
  pickExportEntry,
  pickMemoriesEntry,
  pickProjectEntries,
  toImportedConversation,
  type ExportExtras,
  type ParsedExport,
  type ParsedProject,
} from "./exportParsers";
import { SkeletonRows } from "../ui/ZenSkeletons";
import { useIsInternalFolder } from "../office/useInternalFolders";

const SOURCE_KEY = {
  chatgpt: "sourceChatgpt",
  claude: "sourceClaude",
  gemini: "sourceGemini",
} as const satisfies Record<ZenImportSource, keyof typeof chatImportText.en>;

/** Below the app connection's comfortable message size; bigger selections go in several calls. */
const MAX_CHARS_PER_CALL = 4_000_000;

function errorText(cause: unknown, fallback: string): string {
  const error = Cause.isCause(cause) ? Cause.squash(cause) : cause;
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

async function readExport(
  file: File,
  chatgptProjectName: NonNullable<ExportExtras["chatgptProjectName"]>,
): Promise<ParsedExport | null> {
  if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir);
    const entry = pickExportEntry(names);
    if (entry === null) return null;
    // Claude.ai keeps projects and memory next to conversations.json.
    const projectTexts = await Promise.all(
      pickProjectEntries(names).map((name) => zip.file(name)!.async("string")),
    );
    const memoriesEntry = pickMemoriesEntry(names);
    const memoriesText =
      memoriesEntry === null ? null : await zip.file(memoriesEntry)!.async("string");
    return detectExport(entry, await zip.file(entry)!.async("string"), {
      projectTexts,
      memoriesText,
      chatgptProjectName,
    });
  }
  return detectExport(file.name, await file.text(), { chatgptProjectName });
}

const SOURCE_SHORT = { chatgpt: "ChatGPT", claude: "Claude" } as const;

interface ProjectChoice {
  readonly name: string;
  readonly include: boolean;
}

const projectKey = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;

export function ChatImportPage() {
  const t = useZenText(chatImportText);
  const navigate = useNavigate();
  const isInternal = useIsInternalFolder();
  const projects = useProjects().filter(
    (project) => project.archivedAt == null && !isInternal(project),
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const project =
    projects.find((candidate) => projectKey(candidate) === chosen) ?? projects[0] ?? null;

  return (
    <OfficePageShell title={t.title}>
      <p className="text-muted-foreground text-sm">{t.intro}</p>
      <section className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <SquareTerminalIcon aria-hidden className="size-5 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <h2 className="font-medium text-sm">{t.terminalTitle}</h2>
          <p className="text-muted-foreground text-xs">{t.terminalBody}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void navigate({ to: "/terminal-sessions" })}
        >
          {t.openTerminalSessions}
        </Button>
      </section>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">{t.folder}</span>
        {projects.length === 0 ? (
          <span className="text-muted-foreground text-sm">{t.noFolders}</span>
        ) : (
          <Select
            value={project ? projectKey(project) : ""}
            onValueChange={(key) => setChosen(String(key))}
          >
            <SelectTrigger className="w-64" aria-label={t.folder}>
              <FolderIcon aria-hidden className="size-4 text-muted-foreground" />
              <SelectValue>{project?.title ?? t.chooseFolder}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {projects.map((candidate) => (
                <SelectItem key={projectKey(candidate)} value={projectKey(candidate)}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
      </div>
      <ExportImporter project={project} />
      {project !== null ? <ImportedChats environmentId={project.environmentId} /> : null}
    </OfficePageShell>
  );
}

function ExportImporter(props: { readonly project: EnvironmentProject | null }) {
  const t = useZenText(chatImportText);
  const locale = useZenLocale();
  const registry = useContext(RegistryContext);
  const create = useAtomCommand(createImports, { reportFailure: false });
  const createProject = useAtomCommand(createImportProject, { reportFailure: false });
  const saveMemory = useAtomCommand(saveImportMemory, { reportFailure: false });
  const assignCompany = useAtomCommand(companyAssignProject, { reportFailure: false });
  const activeCompanyId = useActiveCompanyId(useCompanyIndex());
  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, ProjectChoice>>>({});
  // Conversation -> source project id ("" = the chosen folder, no project).
  const [assignment, setAssignment] = useState<Readonly<Record<string, string>>>({});
  const [baseFolder, setBaseFolder] = useState("");
  const [keepGlobalMemory, setKeepGlobalMemory] = useState(true);
  const [bulkTarget, setBulkTarget] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    projects?: boolean;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const projectSource = parsed === null || parsed.source === "gemini" ? null : parsed.source;
  const sourceProjects = projectSource === null ? [] : (parsed?.projects ?? []);
  const includedProjects = sourceProjects.filter(
    (project) => choices[project.externalId]?.include === true,
  );
  const defaultBase =
    projectSource === null ? "" : t.defaultBaseFolder(SOURCE_SHORT[projectSource]);
  const baseName = baseFolder.trim() === "" ? defaultBase : baseFolder.trim();
  /** Where a conversation goes: an included source project, or "" for the chosen folder. */
  const targetOf = (externalId: string): string => {
    const target = assignment[externalId] ?? "";
    return target !== "" && choices[target]?.include === true ? target : "";
  };
  const chatsPerProject = new Map<string, number>();
  for (const conversation of parsed?.conversations ?? []) {
    const target = assignment[conversation.externalId] ?? "";
    if (target !== "") chatsPerProject.set(target, (chatsPerProject.get(target) ?? 0) + 1);
  }
  const projectLabel = (target: string) =>
    target === ""
      ? t.noProject(props.project?.title ?? t.chooseFolder)
      : (choices[target]?.name ?? target);
  const projectOptions = ["", ...includedProjects.map((project) => project.externalId)];

  const needle = filter.trim().toLowerCase();
  const shown =
    parsed === null
      ? []
      : parsed.conversations.filter(
          (conversation) =>
            needle === "" ||
            conversation.title.toLowerCase().includes(needle) ||
            conversation.messages.some((message) => message.text.toLowerCase().includes(needle)),
        );

  const onFile = async (file: File) => {
    setReading(true);
    setError(null);
    setParsed(null);
    try {
      const result = await readExport(file, t.chatgptProjectName);
      if (result === null || result.conversations.length === 0) setError(t.notRecognized);
      else {
        setParsed(result);
        setSelected(new Set());
        setChoices(
          Object.fromEntries(
            result.projects.map((project) => [
              project.externalId,
              { name: project.name, include: true },
            ]),
          ),
        );
        setAssignment(
          Object.fromEntries(
            result.conversations.map((conversation) => [
              conversation.externalId,
              conversation.projectExternalId ?? "",
            ]),
          ),
        );
        setBaseFolder("");
        setKeepGlobalMemory(true);
      }
    } catch (cause) {
      setError(errorText(cause, t.readFailed));
    }
    setReading(false);
  };

  const failed = (title: string, cause: unknown) =>
    toastManager.add({ type: "error", title, description: errorText(cause, title) });

  /** Creates (or finds again) the folder + Zen project of each included source project. */
  const recreateProjects = async (
    environmentId: EnvironmentId,
    folderProjectId: ProjectId,
    source: "chatgpt" | "claude",
  ): Promise<Map<string, ProjectId> | null> => {
    const created = new Map<string, ProjectId>();
    const companyId =
      activeCompanyId !== null && activeCompanyId !== ZEN_PERSONAL_COMPANY_ID
        ? activeCompanyId
        : null;
    setProgress({ done: 0, total: includedProjects.length, projects: true });
    for (const project of includedProjects) {
      const name = (choices[project.externalId]?.name ?? "").trim().slice(0, 200) || project.name;
      const result = await createProject({
        environmentId,
        input: {
          folderProjectId,
          baseFolderName: baseName.slice(0, 120),
          source,
          language: locale === "ro" ? "ro" : "en",
          project: projectPayload(project, name),
        },
      });
      if (result._tag !== "Success") {
        failed(t.projectFailed(name), result.cause);
        return null;
      }
      created.set(project.externalId, result.value.projectId);
      if (companyId !== null) {
        await assignCompany({
          environmentId,
          input: { projectId: result.value.projectId, companyId },
        });
      }
      setProgress((current) => (current === null ? null : { ...current, done: current.done + 1 }));
    }
    if (companyId !== null && created.size > 0) registry.refresh(companiesListAtom(environmentId));
    return created;
  };

  const runImport = async () => {
    if (parsed === null || props.project === null) return;
    const environmentId = props.project.environmentId;
    let projectIds = new Map<string, ProjectId>();
    if (projectSource !== null) {
      if (includedProjects.length > 0) {
        const created = await recreateProjects(environmentId, props.project.id, projectSource);
        if (created === null) {
          setProgress(null);
          return;
        }
        projectIds = created;
        toastManager.add({ type: "success", title: t.projectsCreated(created.size) });
      }
      if (keepGlobalMemory && parsed.globalMemory !== null) {
        const saved = await saveMemory({
          environmentId,
          input: {
            folderProjectId: props.project.id,
            baseFolderName: baseName.slice(0, 120),
            source: projectSource,
            language: locale === "ro" ? "ro" : "en",
            memory: parsed.globalMemory,
          },
        });
        if (saved._tag === "Success")
          toastManager.add({ type: "success", title: t.memorySaved(saved.value.path) });
        else failed(t.memorySaveFailed, saved.cause);
      }
    }
    const chosen = parsed.conversations.filter((conversation) =>
      selected.has(conversation.externalId),
    );
    // One group per destination project, each split into calls the server accepts.
    const groups = new Map<ProjectId, Array<(typeof chosen)[number]>>();
    for (const conversation of chosen) {
      const projectId = projectIds.get(targetOf(conversation.externalId)) ?? props.project.id;
      groups.set(projectId, [...(groups.get(projectId) ?? []), conversation]);
    }
    let created = 0;
    let existing = 0;
    setProgress({ done: 0, total: chosen.length });
    groups: for (const [projectId, conversations] of groups) {
      const batches = importBatches(conversations, {
        perCall: ZEN_IMPORT_LIMITS.conversationsPerCall,
        maxChars: MAX_CHARS_PER_CALL,
      });
      for (const batch of batches) {
        const result = await create({
          environmentId,
          input: {
            projectId,
            source: parsed.source,
            conversations: batch.map(toImportedConversation),
          },
        });
        if (result._tag !== "Success") {
          failed(t.importFailed, result.cause);
          break groups;
        }
        created += result.value.created.length;
        existing += result.value.existing.length;
        setProgress((current) =>
          current === null ? null : { ...current, done: current.done + batch.length },
        );
      }
    }
    setProgress(null);
    if (created + existing > 0) {
      toastManager.add({ type: "success", title: t.imported(created, existing) });
      setSelected(new Set());
      registry.refresh(importedThreadsList({ environmentId, input: {} }));
    }
  };

  const moveSelected = () =>
    setAssignment((current) => {
      const next = { ...current };
      for (const externalId of selected) next[externalId] = bulkTarget;
      return next;
    });

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <MessagesSquareIcon aria-hidden className="size-5 text-muted-foreground" />
        <h2 className="font-medium text-sm">{t.exportTitle}</h2>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground text-xs">
        <li>{t.howChatgpt}</li>
        <li>{t.howClaude}</li>
        <li>{t.howGemini}</li>
      </ul>
      <p className="text-muted-foreground text-xs">{t.privacyNote}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
          <FileUpIcon />
          {t.chooseFile}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.zip,.html,application/json,application/zip,text/html"
          className="sr-only"
          aria-label={t.chooseFile}
          data-zen-chat-import-file
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void onFile(file);
            event.currentTarget.value = "";
          }}
        />
        {reading ? (
          <span className="animate-pulse text-muted-foreground text-xs">{t.reading}</span>
        ) : null}
        {error !== null ? <span className="text-destructive text-xs">{error}</span> : null}
      </div>
      {parsed !== null ? (
        <>
          <p className="text-sm">
            {t.foundIn(parsed.conversations.length, t[SOURCE_KEY[parsed.source]])}
          </p>
          {projectSource !== null && (sourceProjects.length > 0 || parsed.globalMemory !== null) ? (
            <div className="flex flex-col gap-2 rounded-md border p-3" data-zen-import-projects>
              <div className="flex items-center gap-2">
                <FolderTreeIcon aria-hidden className="size-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">{t.projectsTitle}</h3>
              </div>
              <p className="text-muted-foreground text-xs">{t.projectsBody(baseName)}</p>
              <p className="text-muted-foreground text-xs">
                {projectSource === "chatgpt" ? t.chatgptProjectsGap : t.claudeSuggestGap}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-xs">{t.baseFolder}</span>
                <InputGroup className="w-64">
                  <InputGroupInput
                    aria-label={t.baseFolder}
                    placeholder={defaultBase}
                    value={baseFolder}
                    maxLength={120}
                    onChange={(event) => setBaseFolder(event.currentTarget.value)}
                  />
                </InputGroup>
                {props.project !== null ? (
                  <span className="text-muted-foreground text-xs">
                    {t.baseFolderHint(props.project.title)}
                  </span>
                ) : null}
              </div>
              {sourceProjects.length > 0 ? (
                <ul className="flex flex-col divide-y rounded-md border" data-zen-no-translate>
                  {sourceProjects.map((project) => {
                    const choice = choices[project.externalId];
                    return (
                      <li
                        key={project.externalId}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                      >
                        <Checkbox
                          aria-label={t.includeProject(choice?.name ?? project.name)}
                          checked={choice?.include === true}
                          onCheckedChange={(checked) =>
                            setChoices((current) => ({
                              ...current,
                              [project.externalId]: {
                                name: current[project.externalId]?.name ?? project.name,
                                include: checked === true,
                              },
                            }))
                          }
                        />
                        <InputGroup className="w-64 min-w-0">
                          <InputGroupInput
                            aria-label={t.projectName}
                            value={choice?.name ?? project.name}
                            maxLength={200}
                            onChange={(event) => {
                              const name = event.currentTarget.value;
                              setChoices((current) => ({
                                ...current,
                                [project.externalId]: {
                                  name,
                                  include: current[project.externalId]?.include ?? true,
                                },
                              }));
                            }}
                          />
                        </InputGroup>
                        <span className="text-muted-foreground text-xs">
                          {[
                            t.projectChats(chatsPerProject.get(project.externalId) ?? 0),
                            project.instructions.trim() !== "" ? t.hasInstructions : null,
                            project.files.length > 0 ? t.projectFiles(project.files.length) : null,
                            project.memory !== null ? t.hasMemory : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {parsed.skippedFiles.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t.skippedFiles(
                    parsed.skippedFiles.length,
                    parsed.skippedFiles.map((file) => `${file.project}/${file.name}`).join(", "),
                  )}
                </p>
              ) : null}
              {parsed.globalMemory !== null ? (
                <div className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-2 text-xs">
                  <span className="font-medium">
                    {t.globalMemoryTitle(t[SOURCE_KEY[projectSource]])}
                  </span>
                  <p className="line-clamp-6 whitespace-pre-wrap" data-zen-no-translate>
                    {parsed.globalMemory}
                  </p>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={keepGlobalMemory}
                      onCheckedChange={(checked) => setKeepGlobalMemory(checked === true)}
                    />
                    {t.globalMemoryKeep(`MEMORIE-${SOURCE_SHORT[projectSource]}.md`)}
                  </label>
                  <span className="text-muted-foreground">{t.globalMemoryNote}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="min-w-0 flex-1 basis-64">
              <InputGroupInput
                type="search"
                aria-label={t.searchLabel}
                placeholder={t.searchPlaceholder}
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
              />
            </InputGroup>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSelected(new Set(shown.map((conversation) => conversation.externalId)))
              }
            >
              {t.selectAll}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t.selectNone}
            </Button>
            <span className="text-muted-foreground text-xs">{t.selectedCount(selected.size)}</span>
          </div>
          {includedProjects.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">{t.moveSelected}</span>
              <ProjectPicker
                label={t.moveSelected}
                value={bulkTarget}
                options={projectOptions}
                labelOf={projectLabel}
                onChange={setBulkTarget}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0}
                onClick={moveSelected}
              >
                {t.move}
              </Button>
            </div>
          ) : null}
          <ul
            className="flex max-h-[28rem] flex-col divide-y overflow-y-auto rounded-md border"
            data-zen-no-translate
          >
            {shown.slice(0, 500).map((conversation) => (
              <li key={conversation.externalId} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-label={conversation.title || t.untitled}
                    checked={selected.has(conversation.externalId)}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(conversation.externalId);
                        else next.delete(conversation.externalId);
                        return next;
                      })
                    }
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                    onClick={() =>
                      setExpanded(
                        expanded === conversation.externalId ? null : conversation.externalId,
                      )
                    }
                  >
                    <span className="truncate font-medium text-sm">
                      {conversation.title || t.untitled}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
                      {conversation.starred ? (
                        <StarIcon aria-label={t.starred} className="size-3 fill-current" />
                      ) : null}
                      <span>
                        {conversation.createdAt
                          ? `${formatZenRelativeTime(locale, conversation.createdAt)} · `
                          : ""}
                        {t.messages(conversation.messages.length)}
                        {conversation.model ? ` · ${conversation.model}` : ""}
                        {conversation.archived ? ` · ${t.archived}` : ""}
                      </span>
                      {conversation.gptId !== null ? (
                        <Badge variant="outline" size="sm">
                          {t.gptLabel(conversation.gptId)}
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                  {includedProjects.length > 0 ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {conversation.projectSuggested &&
                      targetOf(conversation.externalId) === conversation.projectExternalId ? (
                        <Badge variant="secondary" size="sm">
                          {t.suggested}
                        </Badge>
                      ) : null}
                      <ProjectPicker
                        label={t.chatProject}
                        value={targetOf(conversation.externalId)}
                        options={projectOptions}
                        labelOf={projectLabel}
                        onChange={(target) =>
                          setAssignment((current) => ({
                            ...current,
                            [conversation.externalId]: target,
                          }))
                        }
                      />
                    </div>
                  ) : null}
                </div>
                {expanded === conversation.externalId ? (
                  <div
                    className="ml-7 flex flex-col gap-1.5 rounded-md bg-muted/40 p-2 text-xs"
                    aria-label={t.preview}
                  >
                    {conversation.messages.slice(0, 6).map((message) => (
                      <p
                        key={`${message.role}:${message.createdAt}:${message.text.slice(0, 32)}`}
                        className="line-clamp-4 whitespace-pre-wrap"
                      >
                        {message.role === "user" ? (
                          <UserIcon aria-hidden className="mr-1 inline size-3" />
                        ) : message.role === "tool" ? (
                          <WrenchIcon aria-hidden className="mr-1 inline size-3" />
                        ) : (
                          <BotIcon aria-hidden className="mr-1 inline size-3" />
                        )}
                        {message.role === "tool" && message.toolName ? (
                          <span className="font-medium">{message.toolName}: </span>
                        ) : null}
                        {message.text}
                      </p>
                    ))}
                    {conversation.messages.length > 6 ? (
                      <p className="text-muted-foreground">
                        {t.moreMessages(conversation.messages.length - 6)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={
                (selected.size === 0 && includedProjects.length === 0) ||
                props.project === null ||
                progress !== null
              }
              onClick={() => void runImport()}
            >
              {progress !== null ? <Spinner /> : null}
              {progress === null
                ? includedProjects.length > 0
                  ? t.importAll(selected.size, includedProjects.length)
                  : t.importSelected(selected.size)
                : progress.projects === true
                  ? t.creatingProjects(progress.done, progress.total)
                  : t.importing(progress.done, progress.total)}
            </Button>
            {props.project !== null ? (
              <span className="text-muted-foreground text-xs">
                {t.folder}: {props.project.title}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** A source project as the server takes it, under the name the person chose. */
function projectPayload(project: ParsedProject, name: string) {
  return {
    externalId: project.externalId,
    name,
    description: project.description,
    instructions: project.instructions,
    memory: project.memory,
    files: project.files.map((file) => ({ name: file.name, content: file.content })),
  };
}

function ProjectPicker(props: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly labelOf: (value: string) => string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Select value={props.value} onValueChange={(value) => props.onChange(String(value ?? ""))}>
      <SelectTrigger size="xs" className="w-48 min-w-0" aria-label={props.label}>
        <SelectValue>{props.labelOf(props.value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={option || "none"} value={option}>
            {props.labelOf(option)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const MEMORY_STATUS = {
  ready: "memoryStatusReady",
  nothing: "memoryStatusNothing",
  skipped: "memoryStatusSkipped",
  off: "memoryStatusOff",
  queued: "memoryStatusQueued",
  failed: "memoryStatusFailed",
} as const satisfies Record<ZenImportsMemoryItem["status"], keyof typeof chatImportText.en>;

function ImportedChats(props: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(chatImportText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const query = importedThreadsList({ environmentId: props.environmentId, input: {} });
  const result = useAtomValue(query);
  const threads = AsyncResult.getOrElse(result, () => null)?.threads ?? null;
  const continueThread = useAtomCommand(continueImport, { reportFailure: false });
  const preview = useAtomCommand(previewImportMemory, { reportFailure: false });
  const send = useAtomCommand(sendImportMemory, { reportFailure: false });
  const [continuing, setContinuing] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [memory, setMemory] = useState<ReadonlyArray<ZenImportsMemoryItem> | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);

  const open = (threadId: string) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: props.environmentId, threadId },
    });

  const onContinue = async (thread: ZenImportedThread) => {
    setContinuing(thread.threadId);
    const outcome = await continueThread({
      environmentId: props.environmentId,
      input: { threadId: thread.threadId },
    });
    setContinuing(null);
    if (outcome._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: t.continueFailed,
        description: errorText(outcome.cause, t.continueFailed),
      });
      return;
    }
    if (outcome.value.summary === "excerpt")
      toastManager.add({ type: "info", title: t.continuedExcerpt });
    registry.refresh(query);
    open(outcome.value.threadId);
  };

  const prepare = async () => {
    setMemoryBusy(true);
    const outcome = await preview({
      environmentId: props.environmentId,
      input: { threadIds: [...picked] as Array<ZenImportedThread["threadId"]> },
    });
    setMemoryBusy(false);
    if (outcome._tag === "Success") setMemory(outcome.value.items);
    else
      toastManager.add({
        type: "error",
        title: t.memoryStatusFailed,
        description: errorText(outcome.cause, t.memoryStatusFailed),
      });
  };

  const confirm = async () => {
    const ready = (memory ?? [])
      .filter((item) => item.status === "ready")
      .map((item) => item.threadId);
    if (ready.length === 0) return;
    setMemoryBusy(true);
    const outcome = await send({ environmentId: props.environmentId, input: { threadIds: ready } });
    setMemoryBusy(false);
    if (outcome._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: t.memoryStatusFailed,
        description: errorText(outcome.cause, t.memoryStatusFailed),
      });
      return;
    }
    const queued = outcome.value.items.filter((item) => item.status === "queued").length;
    toastManager.add({ type: "success", title: t.memorySent(queued) });
    setMemory(outcome.value.items);
    registry.refresh(query);
  };

  const readyCount = (memory ?? []).filter((item) => item.status === "ready").length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium text-sm">{t.importedTitle}</h2>
      {threads === null ? <SkeletonRows rows={3} /> : null}
      {threads !== null && threads.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noImported}</p>
      ) : null}
      {threads !== null && threads.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border" data-zen-no-translate>
          {threads.map((thread) => (
            <li key={thread.threadId} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Checkbox
                aria-label={thread.title}
                checked={picked.has(thread.threadId)}
                onCheckedChange={(checked) =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (checked) next.add(thread.threadId);
                    else next.delete(thread.threadId);
                    return next;
                  })
                }
              />
              <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                <span className="truncate font-medium text-sm">{thread.title || t.untitled}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
                  <Badge variant="secondary" size="sm">
                    {t[SOURCE_KEY[thread.source]]}
                  </Badge>
                  {thread.createdAt ? (
                    <span>{formatZenRelativeTime(locale, thread.createdAt)}</span>
                  ) : null}
                  <span>{t.messages(thread.messageCount)}</span>
                  {thread.continuedIn.length > 0 ? (
                    <span>{t.continuedCount(thread.continuedIn.length)}</span>
                  ) : null}
                  {thread.memory === "queued" ? <span>{t.memoryAlready}</span> : null}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => open(thread.threadId)}>
                {t.open}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={continuing !== null}
                onClick={() => void onContinue(thread)}
              >
                {continuing === thread.threadId ? <Spinner /> : null}
                {continuing === thread.threadId ? t.continuing : t.continueInNewChat}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {threads !== null && threads.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4" data-zen-import-memory>
          <div className="flex items-center gap-2">
            <BrainIcon aria-hidden className="size-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">{t.memoryTitle}</h3>
          </div>
          <p className="text-muted-foreground text-xs">{t.memoryBody}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={picked.size === 0 || memoryBusy}
              onClick={() => void prepare()}
            >
              {memoryBusy && memory === null ? <Spinner /> : null}
              {memoryBusy && memory === null ? t.memoryPreparing : t.memoryPreview}
            </Button>
            {picked.size === 0 ? (
              <span className="text-muted-foreground text-xs">{t.memoryNone}</span>
            ) : null}
            {readyCount > 0 ? (
              <Button size="sm" disabled={memoryBusy} onClick={() => void confirm()}>
                {t.memorySend(readyCount)}
              </Button>
            ) : null}
          </div>
          {memory !== null ? (
            <ul className="flex flex-col gap-2" data-zen-no-translate>
              {memory.map((item) => {
                const thread = threads.find((candidate) => candidate.threadId === item.threadId);
                return (
                  <li
                    key={item.threadId}
                    className="flex flex-col gap-1 rounded-md bg-muted/40 p-2 text-xs"
                  >
                    <span className="font-medium">
                      {thread?.title ?? item.threadId} · {t[MEMORY_STATUS[item.status]]}
                    </span>
                    {item.redacted.length > 0 ? (
                      <span className="text-muted-foreground">
                        {t.memoryRedacted(item.redacted.join(", "))}
                      </span>
                    ) : null}
                    {item.summary !== null ? (
                      <p className="whitespace-pre-wrap">{item.summary}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
