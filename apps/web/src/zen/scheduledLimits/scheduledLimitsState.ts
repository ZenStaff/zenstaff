import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  ZEN_SCHEDULED_LIMITS_WS_METHODS,
  type ZenRunEvent,
  type ZenTaskLimits,
} from "@t3tools/contracts/zenScheduledLimits";

import { connectionAtomRuntime } from "../../connection/runtime";
import { scheduledLimitsText, type ScheduledLimitsMessages } from "./scheduledLimits.i18n";

// Text helpers take the dictionary for the current language; English is the default (tests).
const EN = scheduledLimitsText.en;

export const scheduledLimitsOverview = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-scheduled-limits:overview",
  tag: ZEN_SCHEDULED_LIMITS_WS_METHODS.overview,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
  refreshIntervalMs: 10_000,
});

export const setScheduledTaskLimits = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-scheduled-limits:set-task",
  tag: ZEN_SCHEDULED_LIMITS_WS_METHODS.setTaskLimits,
});

export const setScheduledGlobalLimits = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-scheduled-limits:set-global",
  tag: ZEN_SCHEDULED_LIMITS_WS_METHODS.setGlobalLimits,
});

/** Form text for an optional positive whole number; empty means "no limit". */
export function limitText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** Parses a limit field: empty is no limit, otherwise a whole number in range, or an error. */
export function parseLimit(
  text: string,
  max: number,
  t: ScheduledLimitsMessages = EN,
): { readonly value: number | null } | { readonly error: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { value: null };
  if (!/^\d+$/.test(trimmed)) return { error: t.wholeNumber };
  const value = Number(trimmed);
  if (value < 1 || value > max) return { error: t.range(max) };
  return { value };
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface TaskLimitsDraft {
  readonly maxRunsPerDay: string;
  readonly maxDurationMinutes: string;
  readonly quietStart: string;
  readonly quietEnd: string;
}

export function draftFromLimits(limits: ZenTaskLimits): TaskLimitsDraft {
  return {
    maxRunsPerDay: limitText(limits.maxRunsPerDay),
    maxDurationMinutes: limitText(limits.maxDurationMinutes),
    quietStart: limits.quietHours?.start ?? "",
    quietEnd: limits.quietHours?.end ?? "",
  };
}

export function limitsFromDraft(
  draft: TaskLimitsDraft,
  t: ScheduledLimitsMessages = EN,
): { readonly limits: ZenTaskLimits } | { readonly error: string } {
  const runs = parseLimit(draft.maxRunsPerDay, 10_000, t);
  if ("error" in runs) return { error: t.runsPerDayError(runs.error) };
  const duration = parseLimit(draft.maxDurationMinutes, 24 * 60, t);
  if ("error" in duration) return { error: t.maxDurationError(duration.error) };
  const start = draft.quietStart.trim();
  const end = draft.quietEnd.trim();
  if ((start.length === 0) !== (end.length === 0)) {
    return { error: t.quietBoth };
  }
  if (start.length > 0 && (!TIME.test(start) || !TIME.test(end))) {
    return { error: t.quietFormat };
  }
  if (start.length > 0 && start === end) {
    return { error: t.quietDiffer };
  }
  return {
    limits: {
      maxRunsPerDay: runs.value,
      maxDurationMinutes: duration.value,
      quietHours: start.length === 0 ? null : { start, end },
    },
  };
}

/** One line for a task's limits, such as "5/day · 30 min · quiet 22:00-07:00". */
export function describeLimits(limits: ZenTaskLimits, t: ScheduledLimitsMessages = EN): string {
  const parts: Array<string> = [];
  if (limits.maxRunsPerDay !== null) parts.push(t.perDay(limits.maxRunsPerDay));
  if (limits.maxDurationMinutes !== null) parts.push(t.minutesMax(limits.maxDurationMinutes));
  if (limits.quietHours !== null) {
    parts.push(t.quietRange(limits.quietHours.start, limits.quietHours.end));
  }
  return parts.length === 0 ? t.noLimits : parts.join(" · ");
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const STATE_KEY = {
  dispatched: "stateDispatched",
  running: "stateRunning",
  stopping: "stateStopping",
  completed: "stateCompleted",
  failed: "stateFailed",
  stopped: "stateStopped",
  interrupted: "stateInterrupted",
  cancelled: "stateCancelled",
  dispatch_failed: "stateDispatchFailed",
  lost: "stateLost",
} as const satisfies Record<NonNullable<ZenRunEvent["state"]>, keyof ScheduledLimitsMessages>;

export function eventLabel(
  event: Pick<ZenRunEvent, "kind" | "state">,
  t: ScheduledLimitsMessages = EN,
): string {
  if (event.kind === "skipped") return t.eventSkipped;
  if (event.kind === "queued") return t.eventQueued;
  return event.state === null ? t.eventRun : t[STATE_KEY[event.state]];
}

export type EventTone = "success" | "warning" | "error" | "info" | "secondary";

export function eventTone(event: Pick<ZenRunEvent, "kind" | "state">): EventTone {
  if (event.kind === "skipped") return "warning";
  if (event.kind === "queued") return "info";
  switch (event.state) {
    case "completed":
      return "success";
    case "failed":
    case "dispatch_failed":
    case "lost":
      return "error";
    case "stopped":
    case "stopping":
    case "interrupted":
      return "warning";
    case "dispatched":
    case "running":
      return "info";
    default:
      return "secondary";
  }
}
