// Zen Staff document editing: the editor shell the file viewer opens with "Edit". It loads the
// file through zen.docs on the environment that owns it, hosts the format editor, saves with
// conflict detection (merge / reload / keep mine), watches for newer versions on disk, lists the
// kept versions and sends a selection to the chat as context. Hook: FilePreviewPanel.tsx.
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { AuthFilesystemWriteScope } from "@t3tools/contracts";
import {
  HistoryIcon,
  MessageSquareTextIcon,
  PencilIcon,
  Redo2Icon,
  SaveIcon,
  StickyNoteIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { FileSurfaceAction, FileSurfaceLoading } from "../../components/files/fileSurfaceChrome";
import { Alert, AlertAction, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { Spinner } from "../../components/ui/spinner";
import { toastManager } from "../../components/ui/toast";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { inferReviewCommentFenceLanguage } from "../../reviewCommentContext";
import { useEnvironmentScope } from "../../state/session";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { docsText } from "./docs.i18n";
import { DocSession, type OpenedDoc } from "./docSession";
import { environmentDocBackend } from "./docsState";
import {
  docKindOf,
  type DocKind,
  type DocSelection,
  type FormatController,
  type FormatEditorProps,
} from "./formatEditor";
import { Skeleton } from "../../components/ui/skeleton";
import { SkeletonLines } from "../ui/ZenSkeletons";

const GridEditor = lazy(() => import("./GridEditor"));
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));
const HtmlEditor = lazy(() => import("./HtmlEditor"));
const DocxEditor = lazy(() => import("./DocxEditor"));
const PdfNotes = lazy(() => import("./PdfNotes"));

/** How often an open editor checks the file for a newer version (also on workspace changes). */
const DISK_CHECK_MS = 15_000;

const KIND_LABEL = {
  csv: "kindTable",
  xlsx: "kindSheet",
  markdown: "kindMarkdown",
  html: "kindHtml",
  docx: "kindDocx",
  pdf: "kindPdf",
} as const satisfies Record<DocKind, keyof typeof docsText.en>;

export interface ZenDocEditorInput {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** Workspace-relative path of the open file (null for folders and none). */
  readonly relativePath: string | null;
  /** False for attachments and host files outside the workspace. */
  readonly available: boolean;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly workspaceMutationId: string | null;
}

/**
 * The file viewer's "Edit" button and, while editing, the surface that replaces the preview.
 * Both are null for files that are not edited here.
 */
export function useZenDocEditor(input: ZenDocEditorInput): {
  readonly action: ReactNode;
  readonly surface: ReactNode;
  /** Opens the editor from the preview (double-click); null when there is nothing to open. */
  readonly startEditing: (() => void) | null;
} {
  const t = useZenText(docsText);
  const canWrite = useEnvironmentScope(input.environmentId, AuthFilesystemWriteScope);
  const kind = input.relativePath === null ? null : docKindOf(input.relativePath);
  const key = `${input.environmentId}\u0000${input.cwd}\u0000${input.relativePath ?? ""}`;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  if (kind === null || !input.available || !canWrite || input.relativePath === null) {
    return { action: null, surface: null, startEditing: null };
  }
  const editing = editingKey === key;
  // A visible "Edit" button, not only a pencil icon: people did not find the icon (Alex, 08.11).
  const action =
    !editing && kind !== "pdf" ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        title={t.editHint}
        onClick={() => setEditingKey(key)}
      >
        <PencilIcon className="size-3.5" />
        {t.edit}
      </Button>
    ) : (
      <FileSurfaceAction
        label={editing ? t.close : kind === "pdf" ? t.annotate : t.editDocument}
        pressed={editing}
        onPress={() => setEditingKey(editing ? null : key)}
      >
        {kind === "pdf" ? (
          <StickyNoteIcon className="size-3.5" />
        ) : (
          <PencilIcon className="size-3.5" />
        )}
      </FileSurfaceAction>
    );
  return {
    action,
    surface: editing ? (
      <DocEditorShell
        key={key}
        kind={kind}
        environmentId={input.environmentId}
        cwd={input.cwd}
        relativePath={input.relativePath}
        composerDraftTarget={input.composerDraftTarget}
        workspaceMutationId={input.workspaceMutationId}
        onClose={() => setEditingKey(null)}
      />
    ) : null,
    startEditing: editing || kind === "pdf" ? null : () => setEditingKey(key),
  };
}

type Problem =
  | { readonly type: "conflict"; readonly theirs: OpenedDoc | null }
  | { readonly type: "changed"; readonly theirs: OpenedDoc };

function DocEditorShell(props: {
  readonly kind: DocKind;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly workspaceMutationId: string | null;
  readonly onClose: () => void;
}) {
  const t = useZenText(docsText);
  const locale = useZenLocale();
  // The shell is keyed by environment and path, so one session per mount.
  const [session] = useState(
    () =>
      new DocSession(environmentDocBackend(props.environmentId), {
        cwd: props.cwd,
        relativePath: props.relativePath,
      }),
  );
  const target = session.target;
  const controller = useRef<FormatController | null>(null);
  const [content, setContent] = useState<{ bytes: Uint8Array; generation: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [versions, setVersions] = useState<Awaited<ReturnType<DocSession["versions"]>> | null>(
    null,
  );
  const [asking, setAsking] = useState<{ selection: DocSelection; question: string } | null>(null);
  const selection = useRef<DocSelection | null>(null);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const fileName = props.relativePath.split("/").at(-1) ?? props.relativePath;

  const markDirty = () => {
    dirtyRef.current = true;
    setDirty(true);
  };
  const onSelection = (next: DocSelection | null) => {
    if (next !== null) selection.current = next;
  };
  const show = (bytes: Uint8Array, nextDirty: boolean) => {
    setContent((current) => ({ bytes, generation: (current?.generation ?? 0) + 1 }));
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opening reads the file from its environment once per editor.
  useEffect(() => {
    let cancelled = false;
    void session.open().then(
      (opened) => {
        if (cancelled) return;
        setContent({ bytes: opened.bytes, generation: 1 });
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Newer versions on disk: picked up silently when nothing is unsaved, otherwise offered.
  const checking = useRef(false);
  const pdf = props.kind === "pdf";
  const reloadedText = t.reloadedFromDisk;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the file's environment; a workspace change triggers a check at once.
  useEffect(() => {
    if (pdf) return;
    const check = async () => {
      if (checking.current || session.base === null) return;
      checking.current = true;
      try {
        const theirs = await session.changedOnDisk();
        if (theirs === null) {
          checking.current = false;
          return;
        }
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the workspace mutation id is listed as the signal to check at once.
        if (!dirtyRef.current) {
          session.adopt(theirs);
          setContent((current) => ({
            bytes: theirs.bytes,
            generation: (current?.generation ?? 0) + 1,
          }));
          setNotice(reloadedText);
        } else {
          setProblem((current) => current ?? { type: "changed", theirs });
        }
      } catch {
        // The next check tries again; a save still detects the change.
      }
      checking.current = false;
    };
    void check();
    const timer = setInterval(() => void check(), DISK_CHECK_MS);
    return () => clearInterval(timer);
  }, [session, pdf, reloadedText, props.workspaceMutationId]);

  const save = async (force = false) => {
    const editor = controller.current;
    if (editor === null || saving) return;
    setSaving(true);
    try {
      const bytes = await editor.serialize();
      const outcome = await session.save(bytes, { force });
      if (outcome.status === "conflict") {
        setProblem({ type: "conflict", theirs: outcome.theirs });
        setSaving(false);
        return;
      }
      editor.markSaved(bytes);
      dirtyRef.current = false;
      setDirty(false);
      setProblem(null);
      setSavedOnce(true);
      setNotice(null);
      setVersions(null);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: t.saveFailed,
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
    setSaving(false);
  };

  const merge = async (theirs: OpenedDoc) => {
    const editor = controller.current;
    const base = session.base;
    if (editor === null || base === null) return;
    const merged = await editor.merge(base.bytes, theirs.bytes);
    if (merged === null) {
      setNotice(t.mergeImpossible);
      return;
    }
    session.rebase(theirs);
    setProblem(null);
    show(merged.bytes, true);
    setNotice(merged.notice);
  };

  const reload = (theirs: OpenedDoc) => {
    session.adopt(theirs);
    setProblem(null);
    setNotice(null);
    show(theirs.bytes, false);
  };

  const ask = (picked: DocSelection, question: string) => {
    addReviewComment(props.composerDraftTarget, {
      id: `zen-doc:${Date.now().toString(36)}`,
      sectionId: `file:${props.relativePath}`,
      sectionTitle: fileName,
      filePath: props.relativePath,
      startIndex: 0,
      endIndex: 0,
      rangeLabel: picked.label,
      text: question.trim() === "" ? t.ask : question.trim(),
      diff: picked.text.slice(0, 20_000),
      fenceLanguage:
        picked.language === "text"
          ? inferReviewCommentFenceLanguage(props.relativePath)
          : picked.language,
    });
    toastManager.add({ type: "success", title: t.askAdded, description: picked.label });
    setAsking(null);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Ctrl/Cmd+S saves while the editor is open, a window-level shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const editorProps: Omit<FormatEditorProps, "bytes"> = {
    fileName,
    controller,
    onDirty: markDirty,
    onSelection,
  };
  const status = saving ? t.saving : dirty ? t.unsaved : savedOnce ? t.saved : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-zen-doc-editor>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1">
        <span className="font-medium text-xs">{t[KIND_LABEL[props.kind]]}</span>
        {status !== null ? (
          <span className="text-muted-foreground text-xs" aria-live="polite">
            · {status}
          </span>
        ) : null}
        <div className="min-w-0 flex-1" />
        {props.kind !== "pdf" ? (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t.undo}
              title={t.undo}
              onClick={() => controller.current?.undo()}
            >
              <Undo2Icon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t.redo}
              title={t.redo}
              onClick={() => controller.current?.redo()}
            >
              <Redo2Icon />
            </Button>
            <Menu
              onOpenChange={(open) => {
                if (open) void session.versions().then(setVersions, () => setVersions([]));
              }}
            >
              <MenuTrigger render={<Button size="xs" variant="ghost" />}>
                <HistoryIcon />
                {t.versions}
              </MenuTrigger>
              <MenuPopup align="end" className="w-72">
                <p className="px-2 py-1.5 text-muted-foreground text-xs">{t.versionsHint}</p>
                {versions === null ? (
                  <SkeletonLines lines={2} className="p-2" />
                ) : versions.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs">{t.noVersions}</p>
                ) : (
                  versions.map((version) => (
                    <MenuItem
                      key={version.id}
                      onClick={() =>
                        void session.version(version.id).then((bytes) => {
                          show(bytes, true);
                          setNotice(t.restored);
                        })
                      }
                    >
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span>{formatZenRelativeTime(locale, version.savedAt)}</span>
                        <span className="text-muted-foreground text-xs">
                          {(version.size / 1024).toFixed(1)} KB · {t.restore}
                        </span>
                      </span>
                    </MenuItem>
                  ))
                )}
              </MenuPopup>
            </Menu>
          </>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            const picked = selection.current;
            if (picked === null) {
              toastManager.add({ type: "info", title: t.selectFirst });
              return;
            }
            setAsking({ selection: picked, question: "" });
          }}
        >
          <MessageSquareTextIcon />
          {t.ask}
        </Button>
        {props.kind !== "pdf" ? (
          <Button
            size="xs"
            variant={dirty ? "default" : "outline"}
            disabled={saving || content === null}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : <SaveIcon />}
            {t.save}
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t.close}
          title={t.close}
          onClick={() => (dirty ? setConfirmClose(true) : props.onClose())}
        >
          <XIcon />
        </Button>
      </div>
      {asking !== null ? (
        <form
          className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            ask(asking.selection, asking.question);
          }}
        >
          <span className="max-w-48 shrink-0 truncate text-muted-foreground text-xs">
            {t.selectionLabel(asking.selection.label)}
          </span>
          <Input
            autoFocus
            size="sm"
            aria-label={t.askPlaceholder}
            placeholder={t.askPlaceholder}
            value={asking.question}
            onChange={(event) => setAsking({ ...asking, question: event.currentTarget.value })}
          />
          <Button size="xs" type="submit">
            {t.askSend}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t.close}
            onClick={() => setAsking(null)}
          >
            <XIcon />
          </Button>
        </form>
      ) : null}
      {confirmClose ? (
        <div className="flex shrink-0 flex-col gap-2 border-b border-warning/32 bg-warning-surface px-3 py-2 text-warning-foreground">
          <p className="font-medium text-sm">{t.discardTitle}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setConfirmClose(false)}>
              {t.keepEditing}
            </Button>
            <Button size="xs" variant="destructive" onClick={props.onClose}>
              {t.discard}
            </Button>
          </div>
        </div>
      ) : null}
      {problem !== null ? (
        <div
          className="flex shrink-0 flex-col gap-1 border-b border-warning/32 bg-warning-surface px-3 py-2 text-warning-foreground"
          data-zen-doc-conflict
        >
          <p className="font-medium text-sm">
            {problem.type === "conflict" ? t.conflictTitle : t.changedOnDisk}
          </p>
          <p className="text-xs">{t.conflictBody}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {problem.theirs !== null ? (
              <>
                <Button size="xs" onClick={() => void merge(problem.theirs!)}>
                  {t.merge}
                </Button>
                <Button size="xs" variant="outline" onClick={() => reload(problem.theirs!)}>
                  {t.reload}
                </Button>
              </>
            ) : null}
            <Button size="xs" variant="destructive-outline" onClick={() => void save(true)}>
              {t.keepMine}
            </Button>
          </div>
        </div>
      ) : null}
      {notice !== null ? (
        <Alert variant="info">
          <AlertDescription>{notice}</AlertDescription>
          <AlertAction>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t.close}
              onClick={() => setNotice(null)}
            >
              <XIcon />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {loadError !== null ? (
        <p className="p-4 text-destructive text-sm">
          {t.loadFailed} {loadError}
        </p>
      ) : content === null ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6" aria-label={t.loading}>
          <Skeleton className="h-6 w-1/3" />
          <SkeletonLines lines={5} />
          <SkeletonLines lines={4} />
        </div>
      ) : (
        <Suspense fallback={<FileSurfaceLoading />}>
          {props.kind === "csv" || props.kind === "xlsx" ? (
            <GridEditor
              key={content.generation}
              kind={props.kind}
              bytes={content.bytes}
              {...editorProps}
            />
          ) : props.kind === "markdown" ? (
            <MarkdownEditor key={content.generation} bytes={content.bytes} {...editorProps} />
          ) : props.kind === "html" ? (
            <HtmlEditor key={content.generation} bytes={content.bytes} {...editorProps} />
          ) : props.kind === "docx" ? (
            <DocxEditor key={content.generation} bytes={content.bytes} {...editorProps} />
          ) : (
            <PdfNotes
              environmentId={props.environmentId}
              target={target}
              bytes={content.bytes}
              fileName={fileName}
              onSelection={onSelection}
              onAsk={(picked) => setAsking({ selection: picked, question: "" })}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}
