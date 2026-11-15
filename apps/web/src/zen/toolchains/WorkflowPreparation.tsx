// Zen Staff: the "Preparing" step before a workflow runs: what is missing, blocked, slow or not
// supported here, in plain words, with Install / Run on the company server (only when one is
// connected) / Cancel, install progress and a Details expander. The form opens once ready.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenWorkflow } from "@t3tools/contracts/zenOffice";
import {
  ZEN_COMPANY_SERVER_URL,
  formatBytes,
  formatDuration,
  type ZenInstallJob,
  type ZenWorkflowCompatibility,
} from "@t3tools/contracts/zenToolchains";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleDotIcon,
  CircleIcon,
  DownloadIcon,
  LockIcon,
  ServerIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useContext, useEffect, useEffectEvent, useRef, useState } from "react";

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
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { companyOfProject } from "../companies/companiesModel";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { useLaunchWorkflow } from "../office/useLaunchWorkflow";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { WorkflowIcon } from "../office/workflowIcons";
import { toolchainsText } from "./toolchains.i18n";
import {
  useZenRequester,
  callToolchains,
  refreshToolchainViews,
  toolchainCheck,
  toolchainOverview,
  toolchainProbe,
} from "./toolchainsState";
import { SkeletonRows } from "../ui/ZenSkeletons";

interface CompanyServer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly project: EnvironmentProject;
  readonly compatibility: ZenWorkflowCompatibility;
}

interface ServerCandidate {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

type Phase =
  | { readonly kind: "checking" }
  | { readonly kind: "decide"; readonly compatibility: ZenWorkflowCompatibility }
  | {
      readonly kind: "installing";
      readonly job: ZenInstallJob;
      readonly where: EnvironmentId;
      readonly compatibility: ZenWorkflowCompatibility | null;
    }
  | { readonly kind: "form" }
  | { readonly kind: "error"; readonly message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** System tools the person already saw in this session (the dialog shows them once). */
const seenSystemTools = new Set<string>();
const systemKey = (environmentId: string, compatibility: ZenWorkflowCompatibility) =>
  `${environmentId}:${compatibility.tools
    .filter((tool) => tool.system)
    .map((tool) => `${tool.toolId}@${tool.version}@${tool.dir}`)
    .join(",")}`;

/**
 * The toolchain gate for a workflow form. `preparing` is the dialog to show instead of the form
 * (null when the form may show); `launch` starts the workflow where the person chose, after
 * the server prepared the thread's tools.
 */
export function useZenToolchainGate(
  workflow: ZenWorkflow,
  project: EnvironmentProject,
  onClose: () => void,
): {
  readonly preparing: ReactNode | null;
  /** Where the workflow runs: the company server's folder once chosen, else `project`. */
  readonly runProject: EnvironmentProject;
  readonly launch: (
    values: Readonly<Record<string, string>>,
    locale: string,
    compose?: Parameters<ReturnType<typeof useLaunchWorkflow>>[0]["compose"],
  ) => Promise<string | null>;
} {
  const registry = useContext(RegistryContext);
  const { companyId } = useOfficeCompany();
  const workflowCompany = workflow.source === "company" ? companyId : null;
  const [alternativeId, setAlternativeId] = useState<string | null>(null);
  const [runOn, setRunOn] = useState<CompanyServer | null>(null);
  const [install, setInstall] = useState<{
    readonly job: ZenInstallJob;
    readonly where: EnvironmentId;
  } | null>(null);
  const [proceed, setProceed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoUpdated = useRef(false);
  const cancelled = useRef(false);
  const { environments } = useEnvironments();
  const launchHere = useLaunchWorkflow(project.environmentId);
  const launchThere = useLaunchWorkflow(runOn?.environmentId ?? project.environmentId);
  const requester = useZenRequester();
  const locale = useZenLocale();
  const target = {
    workflowId: workflow.manifest.id,
    companyId: workflowCompany,
    alternativeId,
    requester,
    locale,
  };
  const checkAtom = toolchainCheck({ environmentId: project.environmentId, input: target });
  const checked = useAtomValue(checkAtom);
  const overviewAtom = toolchainOverview({ environmentId: project.environmentId, input: {} });
  const overview = useAtomValue(overviewAtom);

  const compatibility = AsyncResult.isSuccess(checked) ? checked.value : null;
  let phase: Phase;
  if (proceed) phase = { kind: "form" };
  else if (error !== null) phase = { kind: "error", message: error };
  else if (install !== null) {
    phase = { kind: "installing", job: install.job, where: install.where, compatibility };
  } else if (checked._tag === "Failure") {
    const failure = Cause.squash(checked.cause);
    const message = failure instanceof Error ? failure.message : String(failure);
    // A server without the toolchain layer runs the workflow as before; any other failure stops.
    phase = /not available on this server/i.test(message)
      ? { kind: "form" }
      : { kind: "error", message };
  } else if (compatibility === null) phase = { kind: "checking" };
  else if (
    compatibility.access.lock === null &&
    (!compatibility.hasRequirements || compatibility.status === "ready") &&
    (!compatibility.tools.some((tool) => tool.system) ||
      seenSystemTools.has(systemKey(project.environmentId, compatibility)))
  ) {
    phase = { kind: "form" };
  } else phase = { kind: "decide", compatibility };

  const startInstall = async (where: EnvironmentId, alternative: string | null) => {
    setError(null);
    const started = await callToolchains("install", where, {
      workflowId: workflow.manifest.id,
      companyId: workflowCompany,
      alternativeId: alternative,
    });
    if (!started.ok) {
      setError(started.error);
      return;
    }
    let job = started.value;
    setInstall({ job, where });
    while (job.state === "running" && !cancelled.current) {
      await sleep(700);
      const next = await callToolchains("job", where, { jobId: job.jobId });
      if (!next.ok) break;
      job = next.value;
      setInstall({ job, where });
    }
    refreshToolchainViews(where, companyId);
    if (job.state !== "done") return;
    const after = await callToolchains("checkWorkflow", where, {
      workflowId: workflow.manifest.id,
      companyId: workflowCompany,
      alternativeId: alternative,
    });
    registry.refresh(checkAtom);
    if (!after.ok) setError(after.error);
    else if (after.value.status === "ready" || after.value.status === "slow") setProceed(true);
    else setInstall(null);
  };

  // A version blocked for safety is replaced right away (a job on the server), then the form opens.
  const safetyUpdate = compatibility?.status === "updating" && install === null && !proceed;
  const runSafetyUpdate = useEffectEvent(() => {
    if (autoUpdated.current) return;
    autoUpdated.current = true;
    void startInstall(project.environmentId, alternativeId);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the safety update job on the server once, when the check reports a blocked version.
  useEffect(() => {
    if (safetyUpdate) runSafetyUpdate();
  }, [safetyUpdate]);

  // Other connected machines; each is offered only when it is marked as the company's always-on
  // server and can run the workflow (useCompanyServer). Never a machine the company does not have.
  const candidates: ServerCandidate[] =
    phase.kind === "decide"
      ? environments
          .filter(
            (environment) =>
              environment.environmentId !== project.environmentId &&
              environment.connection.phase === "connected",
          )
          .map((environment) => ({
            environmentId: environment.environmentId,
            label: environment.label,
          }))
      : [];

  const launch = async (
    values: Readonly<Record<string, string>>,
    locale: string,
    compose?: Parameters<typeof launchHere>[0]["compose"],
  ) => {
    const folder = runOn?.project ?? project;
    const run = runOn ? launchThere : launchHere;
    return run({
      workflow,
      project: folder,
      values,
      locale,
      ...(compose ? { compose } : {}),
      prepare: async (threadId) => {
        const prepared = await callToolchains("prepareThread", folder.environmentId, {
          ...target,
          alternativeId: runOn ? null : alternativeId,
          threadId,
          cwd: folder.workspaceRoot,
        });
        if (prepared.ok) return { appendix: prepared.value.appendix };
        // Servers without the toolchain layer run the workflow as before.
        return /not available on this server/i.test(prepared.error)
          ? { appendix: "" }
          : { error: prepared.error };
      },
    });
  };

  const runProject = runOn?.project ?? project;
  if (phase.kind === "form") return { preparing: null, runProject, launch };

  const close = () => {
    cancelled.current = true;
    if (install !== null && install.job.state === "running") {
      void callToolchains("cancel", install.where, { jobId: install.job.jobId });
    }
    onClose();
  };

  const chooseServer = (server: CompanyServer) => {
    setRunOn(server);
    if (server.compatibility.status === "ready" || server.compatibility.status === "slow") {
      setProceed(true);
    } else {
      void startInstall(server.environmentId, null);
    }
  };

  return {
    preparing: (
      <PreparationDialog
        workflow={workflow}
        phase={phase}
        candidates={candidates}
        requester={requester}
        alternativeId={alternativeId}
        onInstall={() => void startInstall(install?.where ?? project.environmentId, alternativeId)}
        onContinue={() => {
          if (compatibility) seenSystemTools.add(systemKey(project.environmentId, compatibility));
          setProceed(true);
        }}
        onUseZen={(toolId) =>
          void (async () => {
            if (!AsyncResult.isSuccess(overview)) return;
            const settings = overview.value.settings;
            const pinned = new Set([...(settings.pinnedTools ?? []), toolId]);
            const saved = await callToolchains("setSettings", project.environmentId, {
              ...settings,
              pinnedTools: [...pinned],
            });
            if (!saved.ok) setError(saved.error);
            registry.refresh(overviewAtom);
            registry.refresh(checkAtom);
          })()
        }
        onAlternative={(id) => {
          setInstall(null);
          setAlternativeId(id);
        }}
        onServer={chooseServer}
        onCancelJob={() => {
          if (install !== null) {
            void callToolchains("cancel", install.where, { jobId: install.job.jobId });
          }
        }}
        onClose={close}
      />
    ),
    runProject,
    launch,
  };
}

/** One connected machine, if it is the company server and can run this workflow. */
function useCompanyServer(
  candidate: ServerCandidate,
  workflowId: string,
  requester: string | null,
): CompanyServer | null {
  const locale = useZenLocale();
  const { companyId, index } = useOfficeCompany();
  const projects = useProjects();
  const probe = useAtomValue(toolchainProbe({ environmentId: candidate.environmentId, input: {} }));
  const check = useAtomValue(
    toolchainCheck({
      environmentId: candidate.environmentId,
      input: { workflowId, companyId: null, alternativeId: null, requester, locale },
    }),
  );
  // The server decides itself (hub registration, grants); a locked check is never offered.
  if (!AsyncResult.isSuccess(probe) || !probe.value.companyRunner) return null;
  if (!AsyncResult.isSuccess(check) || check.value.status === "not-compatible") return null;
  if (check.value.access.lock !== null) return null;
  const folder = projects
    .filter(
      (project) => project.environmentId === candidate.environmentId && project.archivedAt == null,
    )
    .toSorted(
      (left, right) =>
        Number(companyOfProject(index, right.environmentId, right.id) === companyId) -
        Number(companyOfProject(index, left.environmentId, left.id) === companyId),
    )[0];
  if (!folder) return null;
  return {
    environmentId: candidate.environmentId,
    label: candidate.label || probe.value.hostname,
    project: folder,
    compatibility: check.value,
  };
}

function ServerButton(props: {
  readonly candidate: ServerCandidate;
  readonly workflowId: string;
  readonly requester: string | null;
  readonly onServer: (server: CompanyServer) => void;
}) {
  const t = useZenText(toolchainsText);
  const server = useCompanyServer(props.candidate, props.workflowId, props.requester);
  if (!server) return null;
  return (
    <Button variant="outline" onClick={() => props.onServer(server)}>
      <ServerIcon />
      {t.runOn(server.label)}
    </Button>
  );
}

function ServerSafetyNote(props: {
  readonly candidate: ServerCandidate;
  readonly workflowId: string;
  readonly requester: string | null;
  readonly tools: ReadonlyArray<string>;
}) {
  const t = useZenText(toolchainsText);
  const server = useCompanyServer(props.candidate, props.workflowId, props.requester);
  if (!server || props.tools.length === 0) return null;
  return (
    <p className="flex gap-2 rounded-lg bg-info/8 px-3 py-2">
      <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-info-foreground" />
      {t.safetyServer(props.tools.join(", "), server.label)}
    </p>
  );
}

function StepIcon({ state }: { readonly state: ZenInstallJob["steps"][number]["state"] }) {
  if (state === "done") return <CheckIcon className="size-4 text-success-foreground" />;
  if (state === "failed") return <XIcon className="size-4 text-destructive-foreground" />;
  if (state === "cancelled" || state === "waiting") {
    return <CircleIcon className="size-4 text-muted-foreground" />;
  }
  // The step being done now: a pulsing dot (spinners are only for buttons).
  return <CircleDotIcon className="size-4 animate-pulse text-primary" />;
}

function PreparationDialog(props: {
  readonly workflow: ZenWorkflow;
  readonly phase: Exclude<Phase, { kind: "form" }>;
  readonly candidates: ReadonlyArray<ServerCandidate>;
  readonly requester: string | null;
  readonly alternativeId: string | null;
  readonly onInstall: () => void;
  readonly onContinue: () => void;
  readonly onUseZen: (toolId: string) => void;
  readonly onAlternative: (id: string | null) => void;
  readonly onServer: (server: CompanyServer) => void;
  readonly onCancelJob: () => void;
  readonly onClose: () => void;
}) {
  const t = useZenText(toolchainsText);
  const { phase, candidates } = props;
  const compatibility =
    phase.kind === "decide" || phase.kind === "installing" ? phase.compatibility : null;
  const status = compatibility?.status;
  const lock = compatibility?.access.lock ?? null;
  const installing = phase.kind === "installing";
  const job = installing ? phase.job : null;
  const running = job?.state === "running";

  let title: string;
  if (phase.kind === "checking") title = t.checkingTitle;
  else if (phase.kind === "error") title = t.errorTitle;
  else if (lock) title = t.lockedTitle;
  else if (status === "updating") title = t.updatingTitle;
  else if (installing) title = t.preparingTitle;
  else if (status === "not-compatible") title = t.notCompatibleTitle;
  else if (status === "slow") title = t.slowTitle;
  else if (status === "ready") title = t.preparingTitle;
  else title = t.setupTitle;

  let description: string;
  if (phase.kind === "checking") description = t.checkingBody(props.workflow.manifest.name);
  else if (phase.kind === "error") description = phase.message;
  else if (lock) description = t.lock[lock.code];
  else if (installing) description = job?.message ?? "";
  else description = compatibility?.headline ?? "";

  const paidOrConditions = (compatibility?.licenseNotes ?? []).filter(
    (note) => note.commercialUse !== "free",
  );
  const freeCount = (compatibility?.licenseNotes ?? []).length - paidOrConditions.length;
  const blockers = (compatibility?.reasons ?? []).filter(
    (reason) =>
      !reason.code.startsWith("optional") &&
      reason.code !== "slow" &&
      reason.code !== "safety-update",
  );
  const notes = (compatibility?.reasons ?? []).filter(
    (reason) => reason.code.startsWith("optional") || reason.code === "safety-update",
  );
  const canInstall = !lock && !installing && (status === "needs-install" || status === "updating");

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="sm:max-w-lg" aria-label={props.workflow.manifest.name}>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {lock ? (
                <LockIcon className="size-4.5 text-warning-foreground" />
              ) : (
                <WorkflowIcon
                  name={props.workflow.manifest.icon}
                  className="size-4.5 text-primary"
                />
              )}
              {title}
            </span>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4 text-sm">
            {phase.kind === "checking" ? (
              <div className="flex flex-col gap-2" aria-label={t.oneMoment}>
                <SkeletonRows rows={2} />
              </div>
            ) : null}

            {lock ? (
              <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2">
                <p>{lock.code === "invalid" ? lock.message : t.lock[lock.code]}</p>
                {lock.code === "needs-runner" ? (
                  <a
                    className="underline"
                    href={ZEN_COMPANY_SERVER_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.serverOffer}
                  </a>
                ) : null}
              </div>
            ) : null}

            {job ? (
              <ul className="flex flex-col gap-3" aria-label={t.progress}>
                {job.steps.map((step) => {
                  const percent =
                    step.state === "done"
                      ? 100
                      : step.totalBytes > 0
                        ? Math.min(100, Math.round((step.bytes / step.totalBytes) * 100))
                        : 0;
                  const busy = step.state === "installing" || step.state === "verifying";
                  return (
                    <li key={`${step.toolId}@${step.version}`} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <StepIcon state={step.state} />
                        <span className="font-medium">{step.name}</span>
                        <span className="ml-auto text-muted-foreground text-xs">
                          {t.step[step.state]}
                          {step.state === "downloading" && step.totalBytes > 0
                            ? ` ${t.of(formatBytes(step.bytes), formatBytes(step.totalBytes))}`
                            : ""}
                        </span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={`h-full rounded-full transition-all ${step.state === "failed" ? "bg-destructive" : busy ? "animate-pulse bg-primary" : "bg-primary"}`}
                          style={{ width: `${busy ? 100 : percent}%` }}
                        />
                      </div>
                      {step.state === "failed" || busy ? (
                        <p className="text-muted-foreground text-xs">{step.message}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {!installing && compatibility && compatibility.tools.some((tool) => tool.system) ? (
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3 py-2">
                {compatibility.tools
                  .filter((tool) => tool.system)
                  .map((tool) => (
                    <p key={tool.toolId} className="flex flex-wrap items-center gap-x-2">
                      <CheckIcon className="size-4 shrink-0 text-success-foreground" />
                      <span>{t.systemTool(tool.name, tool.version ?? "")}</span>
                      <button
                        type="button"
                        className="text-muted-foreground text-xs underline"
                        onClick={() => props.onUseZen(tool.toolId)}
                      >
                        {t.useZenVersion}
                      </button>
                    </p>
                  ))}
                <p className="text-muted-foreground text-xs">{t.systemNote}</p>
              </div>
            ) : null}

            {canInstall && compatibility ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">{t.willSetUp}</p>
                <ul className="flex flex-col divide-y rounded-lg border">
                  {compatibility.install.map((item) => (
                    <li key={item.toolId} className="flex items-center gap-3 px-3 py-2">
                      <DownloadIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{item.name}</span>
                        {item.reason === "safety-update" ? (
                          <span className="text-muted-foreground">{t.safetyUpdate}</span>
                        ) : null}
                        {item.recipeStatus === "untested" ? (
                          <span className="block text-muted-foreground text-xs">{t.untested}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {formatBytes(item.downloadBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs">
                  {t.totals(
                    formatBytes(compatibility.downloadBytes),
                    formatDuration(compatibility.installSeconds),
                    formatBytes(compatibility.diskBytes),
                  )}
                </p>
              </div>
            ) : null}

            {!installing && !lock && blockers.length > 0 ? (
              <ul className="flex flex-col gap-1.5" aria-label={t.why}>
                {blockers.map((reason) => (
                  <li key={reason.code + reason.message} className="flex gap-2">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                    {reason.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {!installing && status === "slow" && compatibility?.runEstimate ? (
              <p className="rounded-lg bg-muted/60 px-3 py-2">
                {t.expect(compatibility.runEstimate)}
              </p>
            ) : null}

            {!installing && notes.length > 0 ? (
              <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
                {notes.map((reason) => (
                  <li key={reason.code + reason.message}>{reason.message}</li>
                ))}
              </ul>
            ) : null}

            {!installing && paidOrConditions.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2">
                <p className="font-medium">{t.licenseNotes}</p>
                {paidOrConditions.map((note) => (
                  <p key={note.toolId}>
                    <span className="font-medium">{note.name}:</span> {note.note}{" "}
                    <a className="underline" href={note.url} target="_blank" rel="noreferrer">
                      {t.readLicense}
                    </a>
                  </p>
                ))}
                {freeCount > 0 ? (
                  <p className="text-muted-foreground text-xs">{t.otherFree}</p>
                ) : null}
              </div>
            ) : null}

            {!installing
              ? candidates.map((candidate) => (
                  <ServerSafetyNote
                    key={candidate.environmentId}
                    candidate={candidate}
                    workflowId={props.workflow.manifest.id}
                    requester={props.requester}
                    tools={compatibility?.untrustedInputTools ?? []}
                  />
                ))
              : null}

            {!installing && !lock && (compatibility?.alternatives.length ?? 0) > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium">{t.otherWays}</p>
                {compatibility!.alternatives.map((alternative) => (
                  <div
                    key={alternative.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{alternative.label}</p>
                      <p className="text-muted-foreground text-xs">
                        {alternative.description}
                        {alternative.kind === "connector" && !alternative.available
                          ? t.askAdminConnector
                          : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!alternative.available}
                      onClick={() => props.onAlternative(alternative.id)}
                    >
                      {t.useThis}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {props.alternativeId && !installing ? (
              <p className="text-muted-foreground text-xs">
                {t.usingLighter}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => props.onAlternative(null)}
                >
                  {t.backToFull}
                </button>
              </p>
            ) : null}

            {compatibility ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{t.details}</summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {compatibility.details.map((detail) => (
                    <div key={`${detail.label}:${detail.value}`} className="contents">
                      <dt className="text-muted-foreground">{detail.label}</dt>
                      <dd className="break-all font-mono">{detail.value}</dd>
                    </div>
                  ))}
                  {lock ? (
                    <div className="contents">
                      <dt className="text-muted-foreground">access</dt>
                      <dd className="break-all font-mono">
                        {compatibility.access.tier} · {lock.code} · {lock.message}
                      </dd>
                    </div>
                  ) : null}
                  {(job?.steps ?? []).map((step) => (
                    <div key={`job-${step.toolId}`} className="contents">
                      <dt className="text-muted-foreground">
                        {step.name} {t.setupSuffix}
                      </dt>
                      <dd className="whitespace-pre-wrap break-all font-mono">
                        {step.message || step.state}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={props.onCancelJob}>
              {t.cancelSetup}
            </Button>
          ) : (
            <Button variant="outline" onClick={props.onClose}>
              {job?.state === "failed" || job?.state === "cancelled" ? t.close : t.cancel}
            </Button>
          )}
          {!running && phase.kind !== "checking"
            ? candidates.map((candidate) => (
                <ServerButton
                  key={candidate.environmentId}
                  candidate={candidate}
                  workflowId={props.workflow.manifest.id}
                  requester={props.requester}
                  onServer={props.onServer}
                />
              ))
            : null}
          {canInstall ? (
            <Button onClick={props.onInstall}>
              <DownloadIcon />
              {t.install}
            </Button>
          ) : null}
          {job && (job.state === "failed" || job.state === "cancelled") ? (
            <Button onClick={props.onInstall}>{t.tryAgain}</Button>
          ) : null}
          {!installing && !lock && status === "slow" ? (
            <Button onClick={props.onContinue}>{t.continueHere}</Button>
          ) : null}
          {!installing && !lock && status === "ready" ? (
            <Button onClick={props.onContinue}>{t.continue}</Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
