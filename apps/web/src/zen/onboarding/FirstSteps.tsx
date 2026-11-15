// Zen Staff first run, last screen: two AI colleagues picked from the answers (one click hires;
// their setup happens later, in a chat) and one first task that starts at once in a chat. ZEN.md,
// "First run".
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_PERSONAL_COMPANY_ID,
  suggestFirstWorkflow,
  type OnboardingAnswers,
} from "@t3tools/contracts/zenCompanies";
import { localizeWorkflowManifest } from "@t3tools/contracts/zenOffice";
import type { StaffOverview, StaffRoleTemplate } from "@t3tools/contracts/zenStaff";
import { AsyncResult } from "effect/reactivity";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CheckIcon,
  FolderCheckIcon,
  LoaderIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeWorkflows, workflowsInput } from "../office/officeState";
import { useStaffCall, useStaffCatalog, useStaffOverview } from "../staff/staffClient";
import { useStaffDefaults } from "../staff/staffShared";
import { SkeletonCards } from "../ui/ZenSkeletons";
import { firstStepsText } from "./firstSteps.i18n";
import { firstRunRoles } from "./firstRunModel";
import { onboardingErrorMessage } from "./onboardingClient";

/** "~/…/Zen Staff/Florăria Iris" reads better than the whole home path. */
function shortFolder(path: string): string {
  const at = path.lastIndexOf("Zen Staff");
  return at > 0 ? `…${path[at - 1]}${path.slice(at)}` : path;
}

export function FirstSteps(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly answers: OnboardingAnswers;
  readonly folder: EnvironmentProject | null;
  readonly busy: boolean;
  readonly onStart: (task: {
    readonly workflowId: string;
    readonly values: Readonly<Record<string, string>>;
  }) => void;
  readonly onLater: () => void;
  readonly onInterview: (() => void) | null;
}) {
  const t = useZenText(firstStepsText);
  const locale = useZenLocale();
  const suggestion = suggestFirstWorkflow(props.answers, locale);
  const workflows = AsyncResult.getOrElse(
    useAtomValue(
      officeWorkflows({ environmentId: props.environmentId, input: workflowsInput(null) }),
    ),
    () => null,
  );
  const workflow = workflows?.workflows.find((item) => item.manifest.id === suggestion.workflowId);
  const manifest = workflow ? localizeWorkflowManifest(workflow.manifest, locale) : null;
  return (
    <div className="flex flex-col gap-5" data-zen-welcome="start">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{t.title}</h1>
        {props.folder ? (
          <p className="mt-2 flex items-center gap-1.5 text-muted-foreground text-sm">
            <FolderCheckIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate" data-zen-company-folder>
              {t.folderReady(shortFolder(props.folder.workspaceRoot))}
            </span>
          </p>
        ) : null}
      </div>
      <Colleagues
        environmentId={props.environmentId}
        companyId={props.companyId}
        answers={props.answers}
        folder={props.folder}
      />
      <div className="flex flex-col gap-3 rounded-xl border p-4" data-zen-first-task>
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t.taskTitle}
        </span>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
            <SparklesIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{manifest?.name ?? "…"}</p>
            <p className="text-muted-foreground text-sm">{manifest?.description ?? t.taskBody}</p>
            {manifest ? <p className="mt-1 text-muted-foreground text-xs">{t.taskBody}</p> : null}
          </div>
        </div>
        <Button
          className="self-end"
          disabled={props.busy}
          onClick={() =>
            props.onStart({ workflowId: suggestion.workflowId, values: suggestion.values })
          }
          data-zen-welcome-start-task
        >
          {props.busy ? <LoaderIcon className="animate-spin" /> : null}
          {t.startTask}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {props.onInterview ? (
          <Button variant="link" size="sm" onClick={props.onInterview}>
            {t.interview}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="ghost" disabled={props.busy} onClick={props.onLater}>
          {t.later}
        </Button>
      </div>
    </div>
  );
}

function Colleagues(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly answers: OnboardingAnswers;
  readonly folder: EnvironmentProject | null;
}) {
  const t = useZenText(firstStepsText);
  const locale = useZenLocale();
  const catalog = useStaffCatalog<{ roles: ReadonlyArray<StaffRoleTemplate> }>(props.environmentId);
  const overview = useStaffOverview(props.environmentId, props.companyId, locale)
    .data as StaffOverview | null;
  const staffCall = useStaffCall(props.environmentId, props.companyId);
  const defaultsFor = useStaffDefaults(props.environmentId);
  const [busy, setBusy] = useState<string | null>(null);
  const [hired, setHired] = useState<ReadonlyArray<string>>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const roles = firstRunRoles(props.answers)
    .map((id) => catalog?.roles.find((role) => role.id === id))
    .filter((role): role is StaffRoleTemplate => role !== undefined);
  const hire = (role: StaffRoleTemplate) => {
    setBusy(role.id);
    const placementOk =
      overview?.companyPlacement.ok === true && props.companyId !== ZEN_PERSONAL_COMPANY_ID;
    // Promise chain, not try/finally: the React Compiler skips components with a finally.
    return staffCall("agent.hire", {
      templateId: role.id,
      kind: role.suggestedKind === "company" && placementOk ? "company" : "personal",
      name: role.name[locale],
      managerId: overview?.humans[0]?.id ?? null,
      projectId: props.folder?.id ?? null,
      defaults: defaultsFor(props.folder),
    })
      .then(() => setHired((current) => [...current, role.id]))
      .catch((cause: unknown) =>
        setMessages((current) => ({
          ...current,
          [role.id]: `${t.hireFailed}: ${onboardingErrorMessage(cause, "")}`,
        })),
      )
      .then(() => setBusy(null));
  };
  return (
    <div className="flex flex-col gap-2" data-zen-first-colleagues>
      <div>
        <p className="font-medium text-sm">{t.colleaguesTitle}</p>
        <p className="text-muted-foreground text-xs">{t.colleaguesBody}</p>
      </div>
      {catalog === null ? <SkeletonCards count={2} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((role) => {
          const done = hired.includes(role.id);
          return (
            <div
              key={role.id}
              className="flex flex-col gap-2 rounded-xl border p-3"
              data-zen-first-role={role.id}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: role.color }}
                >
                  <BriefcaseIcon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">{role.name[locale]}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {role.role[locale]}
                  </span>
                </span>
              </div>
              {messages[role.id] ? (
                <p className="text-muted-foreground text-xs">{messages[role.id]}</p>
              ) : null}
              <Button
                size="sm"
                variant={done ? "secondary" : "outline"}
                disabled={done || busy !== null}
                onClick={() => void hire(role)}
              >
                {busy === role.id ? (
                  <LoaderIcon className="animate-spin" />
                ) : done ? (
                  <CheckIcon />
                ) : (
                  <UserPlusIcon />
                )}
                {busy === role.id ? t.hiring : done ? t.hired : t.hire}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
