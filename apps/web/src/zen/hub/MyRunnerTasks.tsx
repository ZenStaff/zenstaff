// Zen Staff: "Sarcinile tale pe serverul firmei" on the AI staff page: the tasks I gave that run on
// the company server, each with "Urmărește live" (read-only, RunnerFollowView), so following does
// not end when the task dialog closes (review 0.2.3, P1-19).
import { EyeIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { myRunnerTasksText } from "./myRunnerTasks.i18n";
import { RunnerFollowView } from "./RunnerFollowView";
import { useRunnerTasks, type RunnerTask } from "./runnerTasks";
import { securityText } from "./security.i18n";

export function MyRunnerTasks(props: {
  /** The hub company id the follow view asks (the staff context's company). */
  readonly companyId: string;
}) {
  const t = useZenText(myRunnerTasksText);
  const s = useZenText(securityText);
  const locale = useZenLocale();
  const tasks = useRunnerTasks(props.companyId);
  const [open, setOpen] = useState<RunnerTask | null>(null);
  if (tasks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t.title} data-testid="my-runner-tasks">
      <h2 className="flex items-center gap-2 font-medium text-sm">
        <ServerIcon className="size-4" />
        {t.title}
      </h2>
      <ul className="flex flex-col divide-y divide-border/60 rounded-xl border">
        {tasks.map((task) => (
          <li key={task.runId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{task.title}</span>
              <span className="block text-muted-foreground text-xs">
                {t.byAgent(task.agentName)} · {formatZenRelativeTime(locale, task.startedAt)}
              </span>
            </span>
            <Button size="sm" variant="outline" onClick={() => setOpen(task)}>
              <EyeIcon />
              {s.followLive}
            </Button>
          </li>
        ))}
      </ul>
      {open !== null ? (
        <Dialog open onOpenChange={(next) => (next ? undefined : setOpen(null))}>
          <DialogPopup className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{open.title}</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <RunnerFollowView
                companyId={open.companyId}
                staffId={open.staffId}
                runId={open.runId}
              />
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)}>
                {s.followClose}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </section>
  );
}
