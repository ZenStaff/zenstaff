// Zen Staff AI staff: pieces the AI staff tabs share (page context, avatar, status, fields,
// launch defaults and thread links).
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { StaffAgentStatus, StaffOverview } from "@t3tools/contracts/zenStaff";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { scheduledTaskDefaultModel } from "../../components/settings/scheduledTasksSettings.logic";
import { toastManager } from "../../components/ui/toast";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { zenText } from "../i18n/zenI18n";
import { staffText } from "./staff.i18n";
import type { StaffCall } from "./staffClient";
import { staffErrorMessage } from "./staffClient";
import { initials } from "./staffModel";

export interface StaffContext {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly overview: StaffOverview;
  readonly call: StaffCall;
  readonly refresh: () => void;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly defaultsFor: (project: EnvironmentProject | null) => {
    readonly modelSelection: { readonly instanceId: string; readonly model: string } | null;
    readonly runtimeMode: string;
    readonly projectId: string | null;
  };
}

/** The model and permissions a new thread gets in a folder: the folder's defaults, like the Office. */
export function useStaffDefaults(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  return (project: EnvironmentProject | null) => {
    const entries = providerInstanceEntriesFor(providers, settings, project?.id ?? null);
    const selection = scheduledTaskDefaultModel(settings, project, entries);
    const runtimeMode = resolveProjectSettings(settings, project?.id ?? null, project).settings
      .defaultRuntimeMode;
    return {
      modelSelection:
        selection === null
          ? null
          : { instanceId: String(selection.instanceId), model: selection.model },
      runtimeMode,
      projectId: project?.id ?? null,
    };
  };
}

export function useProviderChoices(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  return providerInstanceEntriesFor(providers, settings, null).map((entry) => ({
    id: String(entry.instanceId),
    name: entry.displayName,
    models: entry.models.map((model) => model.slug),
  }));
}

export function useOpenThread(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  return (threadId: string) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId as never)),
    });
}

/** Runs a call and shows a toast when it fails; resolves to the value or null. */
export async function attempt<T>(work: () => Promise<T>, success?: string): Promise<T | null> {
  try {
    const value = await work();
    if (success) toastManager.add({ type: "success", title: success });
    return value;
  } catch (error) {
    toastManager.add({
      type: "error",
      title: zenText(staffText).failed,
      description: staffErrorMessage(error, ""),
    });
    return null;
  }
}

export function Avatar(props: {
  readonly name: string;
  readonly color: string;
  readonly agent?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center font-semibold text-sm text-white",
        props.agent ? "rounded-xl" : "rounded-full",
        props.className,
      )}
      style={{ backgroundColor: props.color }}
    >
      {initials(props.name)}
    </span>
  );
}

const STATUS_CLASS: Record<StaffAgentStatus, string> = {
  working: "bg-success animate-pulse",
  idle: "bg-muted-foreground/40",
  "waiting-approval": "bg-warning",
  paused: "bg-muted-foreground/20",
};

export function StatusLabel(props: { readonly status: StaffAgentStatus; readonly label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
      data-staff-status={props.status}
    >
      <span aria-hidden className={cn("size-2 rounded-full", STATUS_CLASS[props.status])} />
      {props.label}
    </span>
  );
}

export function Field(props: {
  readonly label: string;
  readonly help?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm", props.className)}>
      <span className="font-medium">{props.label}</span>
      {props.children}
      {props.help ? <span className="text-muted-foreground text-xs">{props.help}</span> : null}
    </label>
  );
}

export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:bg-input/32";

export function Section(props: {
  readonly title: string;
  readonly intro?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="zr-h2 font-semibold text-lg tracking-tight">{props.title}</h2>
          {props.intro ? (
            <p className="zr-muted max-w-3xl text-muted-foreground text-sm">{props.intro}</p>
          ) : null}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function projectKey(project: EnvironmentProject): string {
  return `${project.environmentId}:${project.id}`;
}

export function formatWhen(iso: string | null, locale: string): string {
  if (iso === null) return "";
  return new Date(iso).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
