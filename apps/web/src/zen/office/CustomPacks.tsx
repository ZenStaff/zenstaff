// Zen Staff: customized packs in the app. "Personalizează" makes a copy of a pack (the person's
// or the company's) and opens a chat that changes it; the review dialog shows the diff and the
// checks and saves it; the update dialog offers Keep mine / Take new / Merge when we ship a new
// version. ZEN.md, "Customized packs".
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { DEFAULT_PROVIDER_INTERACTION_MODE, type EnvironmentId } from "@t3tools/contracts";
import type {
  ZenCustomDraftReview,
  ZenCustomPackView,
  ZenCustomThreadStart,
} from "@t3tools/contracts/zenOffice";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import type * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import {
  CheckIcon,
  LayersIcon,
  RotateCcwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UsersIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { useContext, useState } from "react";

import { scheduledTaskDefaultModel } from "../../components/settings/scheduledTasksSettings.logic";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { toastManager } from "../../components/ui/toast";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { newMessageId, newThreadId } from "../../lib/utils";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { companyOfProject } from "../companies/companiesModel";
import { zenErrorMessage } from "../i18n/serverText";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { customPacksText } from "./customPacks.i18n";
import {
  customizeOfficePack,
  discardCustomDraft,
  officeCustomDraftReview,
  officeCustomPacks,
  resolveCustomUpdate,
  revertCustomPack,
  saveCustomDraft,
  shareCustomPack,
} from "./customPacksState";
import { officeMarketplace, officeWorkflows, NO_INPUT } from "./officeState";
import { useOfficeCompany } from "./useOfficeCompany";
import { useIsInternalFolder } from "./useInternalFolders";

const PROJECT_KEY = "zen:office:project";

function storedProjectKey(): string | null {
  try {
    return globalThis.localStorage?.getItem(PROJECT_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The folder a customization chat is listed under: the Office folder, else the first one. */
function useCustomizeProject(): EnvironmentProject | null {
  const company = useOfficeCompany();
  const isInternal = useIsInternalFolder();
  const projects = useProjects()
    .filter((project) => project.archivedAt == null && !isInternal(project))
    .filter(
      (project) =>
        company.companyId === null ||
        companyOfProject(company.index, project.environmentId, project.id) === company.companyId,
    );
  const stored = storedProjectKey();
  return (
    projects.find((project) => `${project.environmentId}:${project.id}` === stored) ??
    projects[0] ??
    null
  );
}

/** Refreshes every list a customization changes (Office home, marketplace, this section). */
function useRefreshCustom(environmentId: EnvironmentId) {
  const registry = useContext(RegistryContext);
  const { companyId, workflowsInput } = useOfficeCompany();
  return () => {
    registry.refresh(officeCustomPacks({ environmentId, input: { companyId } }));
    registry.refresh(officeWorkflows({ environmentId, input: workflowsInput }));
    registry.refresh(officeMarketplace({ environmentId, input: NO_INPUT }));
  };
}

const failureToast = (title: string, cause: Cause.Cause<unknown>) =>
  toastManager.add({ type: "error", title, description: zenErrorMessage(cause, title) });

/**
 * Opens the customization (or merge) chat on the draft folder: a normal thread in the Office
 * folder whose working folder is the draft (so the agent changes only the copy).
 */
function useLaunchCustomization(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const project = useCustomizeProject();
  const t = useZenText(customPacksText);
  const launch = async (start: ZenCustomThreadStart): Promise<string | null> => {
    if (project === null) return t.noFolder;
    const entries = providerInstanceEntriesFor(providers, settings, project.id);
    const modelSelection = scheduledTaskDefaultModel(settings, project, entries);
    if (modelSelection === null) return t.failed;
    const runtimeMode = resolveProjectSettings(settings, project.id, project).settings
      .defaultRuntimeMode;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: start.message, attachments: [] },
        modelSelection,
        titleSeed: start.title,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: project.id,
            title: start.title,
            modelSelection,
            runtimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            // The draft folder is the thread's working folder.
            worktreePath: start.draftFolder,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      return error instanceof Error && error.message ? error.message : t.failed;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
    return null;
  };
  return { project, launch };
}

/** "Personalizează": what to change and for whom, then the chat starts on a draft copy. */
export function CustomizeDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly workflowId: string;
  readonly name: string;
  readonly initialRequest?: string;
  readonly onClose: () => void;
}) {
  const t = useZenText(customPacksText);
  const locale = useZenLocale();
  const { companyId, index } = useOfficeCompany();
  const companyName = index.companies.find((company) => company.id === companyId)?.name ?? null;
  const [request, setRequest] = useState(props.initialRequest ?? "");
  const [forCompany, setForCompany] = useState(companyId !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customize = useAtomCommand(customizeOfficePack, {
    label: t.customize,
    reportFailure: false,
  });
  const { launch } = useLaunchCustomization(props.environmentId);
  const refresh = useRefreshCustom(props.environmentId);

  const start = async () => {
    setBusy(true);
    setError(null);
    const outcome = await customize({
      environmentId: props.environmentId,
      input: {
        workflowId: props.workflowId,
        companyId: forCompany ? companyId : null,
        request,
        locale,
      },
    });
    if (outcome._tag !== "Success") {
      setBusy(false);
      setError(outcome._tag === "Failure" ? zenErrorMessage(outcome.cause, t.failed) : t.failed);
      return;
    }
    refresh();
    const failure = await launch(outcome.value);
    setBusy(false);
    if (failure) setError(failure);
    else props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup className="sm:max-w-lg" data-zen-customize-dialog>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <WandSparklesIcon className="size-4.5 text-primary" />
              {t.customizeTitle(props.name)}
            </span>
          </DialogTitle>
          <DialogDescription>{t.customizeIntro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zen-customize-request">{t.whatToChange}</Label>
              <Textarea
                id="zen-customize-request"
                rows={4}
                value={request}
                placeholder={t.whatToChangePlaceholder}
                onChange={(event) => setRequest(event.target.value)}
              />
            </div>
            {companyId !== null && companyName !== null ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 font-medium text-sm">{t.forWhom}</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="zen-customize-scope"
                    checked={forCompany}
                    onChange={() => setForCompany(true)}
                  />
                  {t.forCompany(companyName)}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="zen-customize-scope"
                    checked={!forCompany}
                    onChange={() => setForCompany(false)}
                  />
                  {t.forMe}
                </label>
              </fieldset>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button onClick={() => void start()} disabled={busy}>
            <SparklesIcon />
            {busy ? t.starting : t.startCustomizing}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function changeLabel(t: typeof customPacksText.en, change: string) {
  return change === "added"
    ? t.changeAdded
    : change === "removed"
      ? t.changeRemoved
      : change === "conflict"
        ? t.changeConflict
        : t.changeChanged;
}

/** The draft's diff, checks and what still blocks it; "Save my version" makes it the one used. */
export function DraftReviewDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly pack: ZenCustomPackView;
  readonly onClose: () => void;
}) {
  const t = useZenText(customPacksText);
  const [busy, setBusy] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const target = { workflowId: props.pack.workflowId, companyId: props.pack.companyId };
  const loaded = useAtomValue(
    officeCustomDraftReview({ environmentId: props.environmentId, input: target }),
  );
  const review: ZenCustomDraftReview | null = AsyncResult.isSuccess(loaded) ? loaded.value : null;
  const error =
    loaded._tag === "Failure"
      ? zenErrorMessage(loaded.cause as Cause.Cause<unknown>, t.failed)
      : null;
  const save = useAtomCommand(saveCustomDraft, { label: t.saveMine, reportFailure: false });
  const discard = useAtomCommand(discardCustomDraft, {
    label: t.discardDraft,
    reportFailure: false,
  });
  const refresh = useRefreshCustom(props.environmentId);

  const onSave = async () => {
    setBusy(true);
    const outcome = await save({ environmentId: props.environmentId, input: target });
    setBusy(false);
    refresh();
    if (outcome._tag === "Success") {
      toastManager.add({ type: "success", title: t.saved(props.pack.name) });
      props.onClose();
    } else if (outcome._tag === "Failure") failureToast(t.saveMine, outcome.cause);
  };
  const onDiscard = async () => {
    setBusy(true);
    const outcome = await discard({ environmentId: props.environmentId, input: target });
    setBusy(false);
    refresh();
    if (outcome._tag === "Success") {
      toastManager.add({ type: "success", title: t.discarded });
      props.onClose();
    } else if (outcome._tag === "Failure") failureToast(t.discardDraft, outcome.cause);
  };

  if (customizing) {
    return (
      <CustomizeDialog
        environmentId={props.environmentId}
        workflowId={props.pack.workflowId}
        name={props.pack.name}
        onClose={props.onClose}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup className="sm:max-w-3xl" data-zen-custom-review>
        <DialogHeader>
          <DialogTitle>{t.reviewTitle(props.pack.name)}</DialogTitle>
          <DialogDescription>{t.reviewIntro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {error ? (
            <p role="alert" className="text-destructive-foreground text-sm">
              {error}
            </p>
          ) : review === null ? (
            <p className="text-muted-foreground text-sm">{t.loadingReview}</p>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <div>
                <p className="mb-1.5 font-medium">{t.filesChanged(review.files.length)}</p>
                <ul className="flex flex-col gap-1">
                  {review.files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2">
                      <code className="truncate text-xs">{file.path}</code>
                      <Badge size="sm" variant={file.change === "conflict" ? "warning" : "outline"}>
                        {changeLabel(t, file.change)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
              {review.checks === null ? (
                <p className="rounded-lg bg-warning/10 px-3 py-2">{t.checksMissing}</p>
              ) : (
                <p
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 ${review.checks.passed ? "bg-success/10" : "bg-destructive/10"}`}
                >
                  {review.checks.passed ? (
                    <CheckIcon className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span>
                    <span className="font-medium">
                      {review.checks.passed ? t.checksPassed : t.checksFailed}
                    </span>
                    {review.checks.summary ? `: ${review.checks.summary}` : null}
                  </span>
                </p>
              )}
              {review.blockers.length > 0 ? (
                <div className="rounded-lg border border-warning/40 px-3 py-2">
                  <p className="font-medium">{t.blockedBecause}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {review.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {review.diff ? (
                <details open={review.diff.length < 6000}>
                  <summary className="cursor-pointer text-muted-foreground">{t.showDiff}</summary>
                  <pre
                    className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed"
                    data-zen-custom-diff
                  >
                    {review.diff.split("\n").map((line, index) => (
                      <span
                        // oxlint-disable-next-line react/no-array-index-key -- diff lines repeat; the index is their identity.
                        key={index}
                        className={
                          line.startsWith("+") && !line.startsWith("+++")
                            ? "block text-success-foreground"
                            : line.startsWith("-") && !line.startsWith("---")
                              ? "block text-destructive-foreground"
                              : line.startsWith("@@")
                                ? "block text-muted-foreground"
                                : "block"
                        }
                      >
                        {line || " "}
                      </span>
                    ))}
                  </pre>
                  {review.diffTruncated ? (
                    <p className="mt-1 text-muted-foreground text-xs">{t.diffTruncated}</p>
                  ) : null}
                </details>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void onDiscard()} disabled={busy}>
            <XIcon />
            {t.discardDraft}
          </Button>
          <Button variant="outline" onClick={() => setCustomizing(true)} disabled={busy}>
            {t.continueChat}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={busy || review === null || review.blockers.length > 0}
          >
            <CheckIcon />
            {t.saveMine}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Keep mine / Take new / Merge for a customized copy whose original has a new version. */
function UpdateChoiceDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly pack: ZenCustomPackView;
  readonly onClose: () => void;
}) {
  const t = useZenText(customPacksText);
  const locale = useZenLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolve = useAtomCommand(resolveCustomUpdate, { label: t.merge, reportFailure: false });
  const { launch } = useLaunchCustomization(props.environmentId);
  const refresh = useRefreshCustom(props.environmentId);
  const version = props.pack.updateAvailable ?? "";
  const choose = async (choice: "keep" | "take" | "merge") => {
    setBusy(true);
    setError(null);
    const outcome = await resolve({
      environmentId: props.environmentId,
      input: {
        workflowId: props.pack.workflowId,
        companyId: props.pack.companyId,
        choice,
        locale,
      },
    });
    refresh();
    if (outcome._tag !== "Success") {
      setBusy(false);
      setError(outcome._tag === "Failure" ? zenErrorMessage(outcome.cause, t.failed) : t.failed);
      return;
    }
    if (choice === "merge" && outcome.value.thread) {
      const failure = await launch(outcome.value.thread);
      setBusy(false);
      if (failure) {
        setError(failure);
        return;
      }
    } else {
      setBusy(false);
      toastManager.add({
        type: "success",
        title: choice === "keep" ? t.keptMine : t.tookNew(props.pack.name),
      });
    }
    props.onClose();
  };
  const options = [
    { id: "merge" as const, icon: LayersIcon, label: t.merge, help: t.mergeHelp },
    { id: "keep" as const, icon: CheckIcon, label: t.keepMine, help: t.keepMineHelp },
    { id: "take" as const, icon: RotateCcwIcon, label: t.takeNew, help: t.takeNewHelp },
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup className="sm:max-w-lg" data-zen-custom-update>
        <DialogHeader>
          <DialogTitle>{t.updateTitle(props.pack.name, version)}</DialogTitle>
          <DialogDescription>{t.updateIntro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => void choose(option.id)}
                className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-accent/40 disabled:opacity-60"
              >
                <option.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <span className="block font-medium text-sm">{option.label}</span>
                  <span className="block text-muted-foreground text-xs">{option.help}</span>
                </span>
              </button>
            ))}
            {error ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={busy}>
            {t.cancel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

type OpenDialog =
  | { readonly kind: "review"; readonly pack: ZenCustomPackView }
  | { readonly kind: "update"; readonly pack: ZenCustomPackView }
  | null;

/** Marketplace: the customized copies, with review, update, share and back to the original. */
export function CustomPacksSection(props: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(customPacksText);
  const { companyId, index } = useOfficeCompany();
  const companyName = index.companies.find((company) => company.id === companyId)?.name ?? null;
  const result = useAtomValue(
    officeCustomPacks({ environmentId: props.environmentId, input: { companyId } }),
  );
  const [open, setOpen] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const revert = useAtomCommand(revertCustomPack, {
    label: t.backToOriginal,
    reportFailure: false,
  });
  const share = useAtomCommand(shareCustomPack, { label: t.scopeCompany, reportFailure: false });
  const refresh = useRefreshCustom(props.environmentId);
  const packs = AsyncResult.isSuccess(result) ? result.value : [];
  if (packs.length === 0) return null;

  const onRevert = async (pack: ZenCustomPackView) => {
    if (!globalThis.confirm?.(t.backToOriginalConfirm(pack.name))) return;
    setBusy(pack.customId);
    const outcome = await revert({
      environmentId: props.environmentId,
      input: { workflowId: pack.workflowId, companyId: pack.companyId },
    });
    setBusy(null);
    refresh();
    if (outcome._tag === "Success") {
      toastManager.add({ type: "success", title: t.reverted(pack.name) });
    } else if (outcome._tag === "Failure") failureToast(t.backToOriginal, outcome.cause);
  };
  const onShare = async (pack: ZenCustomPackView) => {
    if (companyId === null || companyName === null) return;
    setBusy(pack.customId);
    const outcome = await share({
      environmentId: props.environmentId,
      input: { workflowId: pack.workflowId, companyId },
    });
    setBusy(null);
    refresh();
    if (outcome._tag === "Success") {
      toastManager.add({ type: "success", title: t.shared(companyName) });
    } else if (outcome._tag === "Failure") failureToast(t.scopeCompany, outcome.cause);
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t.sectionTitle} data-zen-custom-packs>
      <div>
        <h2 className="font-semibold text-lg">{t.sectionTitle}</h2>
        <p className="text-muted-foreground text-sm">{t.sectionIntro}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {packs.map((pack) => (
          <article
            key={`${pack.scope}:${pack.workflowId}`}
            className="flex flex-col gap-2 rounded-xl border bg-card p-4"
            aria-label={pack.name}
          >
            <div className="flex flex-wrap items-center gap-2">
              <WandSparklesIcon className="size-4 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">{pack.name}</span>
              <Badge size="sm" variant="outline">
                {pack.scope === "company" ? (
                  <>
                    <UsersIcon />
                    {t.scopeCompany}
                  </>
                ) : (
                  t.scopeMine
                )}
              </Badge>
              {pack.hasDraft ? (
                <Badge size="sm" variant="warning">
                  {t.badgeDraft}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              <code>{pack.customId}</code> · {t.basedOn(pack.origin.version)}
              {pack.revision > 0 ? ` · ${t.revision(pack.revision)}` : null}
            </p>
            {pack.updateAvailable ? (
              <p className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-sm">
                {t.updateAvailable(pack.updateAvailable)}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {pack.hasDraft ? (
                <Button size="xs" onClick={() => setOpen({ kind: "review", pack })}>
                  {t.review}
                </Button>
              ) : null}
              {pack.updateAvailable && !pack.hasDraft ? (
                <Button size="xs" onClick={() => setOpen({ kind: "update", pack })}>
                  {t.updatePack(pack.updateAvailable)}
                </Button>
              ) : null}
              {pack.hasActive && pack.scope === "user" && companyName !== null ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy === pack.customId}
                  onClick={() => void onShare(pack)}
                >
                  <UsersIcon />
                  {t.shareWithCompany(companyName)}
                </Button>
              ) : null}
              {pack.hasActive ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy === pack.customId}
                  onClick={() => void onRevert(pack)}
                >
                  <RotateCcwIcon />
                  {t.backToOriginal}
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {open?.kind === "review" ? (
        <DraftReviewDialog
          environmentId={props.environmentId}
          pack={open.pack}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === "update" ? (
        <UpdateChoiceDialog
          environmentId={props.environmentId}
          pack={open.pack}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

/** The custom packs list for a workflow card (Office home): badge and the review shortcut. */
export function useCustomPacks(environmentId: EnvironmentId): ReadonlyArray<ZenCustomPackView> {
  const { companyId } = useOfficeCompany();
  const result = useAtomValue(officeCustomPacks({ environmentId, input: { companyId } }));
  return AsyncResult.isSuccess(result) ? result.value : [];
}
