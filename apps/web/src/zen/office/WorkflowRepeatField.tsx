// Zen Staff: how a workflow's automatic repeat reads ("every day at 09:00"). The chat saves the
// repeat (zen/intake); there is no form field for it any more.
import type { WorkflowRepeat } from "./workflowSchedule";

/** "every day at 09:00" / "în fiecare luni la 09:00". */
export function describeRepeat(
  repeat: WorkflowRepeat,
  t: {
    readonly weekdays: ReadonlyArray<string>;
    readonly repeatEveryDayAt: (time: string) => string;
    readonly repeatEveryWeekAt: (day: string, time: string) => string;
  },
): string {
  return repeat.kind === "daily"
    ? t.repeatEveryDayAt(repeat.time.trim())
    : t.repeatEveryWeekAt(t.weekdays[repeat.weekday] ?? "", repeat.time.trim());
}
