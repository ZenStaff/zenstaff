// Zen Staff (Office): the Finished shelf ends with "All N finished tasks, by day" instead of an
// endless "Show 25 more" (hidden in Office by ZenEditionRoot's stylesheet). It opens a list of every
// finished task of the selected company, grouped by day, with search. Sidebar.tsx renders
// <ZenFinishedTasksLink count /> after the shelf. ZEN.md, "Sidebar navigation".
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { CalendarCheckIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
import { Skeleton } from "../../components/ui/skeleton";
import { useSidebar } from "../../components/ui/sidebar";
import { useQuietThreadShells, useServerConfigs } from "../../state/entities";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useZenCompanyThreads } from "../companies/companiesState";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { useZenOffice } from "../office/useZenEdition";
import { finishedText } from "./finished.i18n";
import { filterFinished, groupFinishedByDay, type FinishedThread } from "./finishedModel";

interface Row extends FinishedThread {
  readonly thread: EnvironmentThreadShell;
}

const toRow = (thread: EnvironmentThreadShell): Row => ({
  key: `${thread.environmentId}:${thread.id}`,
  title: thread.title,
  finishedAt: thread.settledAt ?? thread.updatedAt,
  thread,
});

/** The link under the Finished shelf (Office only). */
export function ZenFinishedTasksLink(props: { readonly count: number }) {
  const office = useZenOffice();
  const t = useZenText(finishedText);
  const [open, setOpen] = useState(false);
  if (!office || props.count === 0) return null;
  return (
    <li className="list-none">
      <Button
        variant="ghost-muted"
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
        data-zen-finished-open
      >
        <CalendarCheckIcon aria-hidden />
        <span className="truncate">{t.openAll(props.count)}</span>
      </Button>
      {open ? <FinishedTasksDialog total={props.count} onClose={() => setOpen(false)} /> : null}
    </li>
  );
}

function FinishedTasksDialog(props: { readonly total: number; readonly onClose: () => void }) {
  const t = useZenText(finishedText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  // "Today" is fixed when the list opens.
  const [now] = useState(() => new Date());
  const threads = useZenCompanyThreads(useQuietThreadShells());
  const serverConfigs = useServerConfigs();
  // Read every older page of finished tasks while the list is open (the shelf shows only a tail).
  const shelf = useOlderSettledShelf({
    scopes: [...serverConfigs.keys()].map((environmentId) => ({ environmentId, projectIds: null })),
    expanded: true,
    visibleCount: props.total,
  });
  const settled = threads.filter((thread) => thread.settledOverride === "settled");
  const listed = settled.filter(shelf.isListed);
  useOlderSettledShelfGrowth(shelf, listed);
  const rows = filterFinished(listed.map(toRow), query);
  const days = groupFinishedByDay(rows, now, locale, {
    today: t.today,
    yesterday: t.yesterday,
  });
  const open = (thread: EnvironmentThreadShell) => {
    props.onClose();
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-xl" data-zen-finished-dialog>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
          <InputGroup className="mt-2">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.search}
              aria-label={t.search}
            />
          </InputGroup>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh]">
          {days.length === 0 && !shelf.loading ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {query.trim() ? t.noResults(query.trim()) : t.empty}
            </p>
          ) : null}
          <div className="flex flex-col gap-4" data-zen-no-translate>
            {days.map((day) => (
              <section key={day.key} aria-label={day.label} className="flex flex-col gap-1">
                <h3 className="font-medium text-muted-foreground text-xs">
                  {day.label} · {day.threads.length}
                </h3>
                <ul className="flex flex-col">
                  {day.threads.map((row) => (
                    <li key={row.key}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => open(row.thread)}
                      >
                        <span className="truncate">{row.title}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {shelf.loading ? (
              <div className="flex flex-col gap-2" aria-label={t.loadingOlder}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-4/5" />
              </div>
            ) : null}
            {shelf.failed ? (
              <p className="text-muted-foreground text-sm">
                {t.loadOlderFailed}{" "}
                <Button variant="link" size="sm" onClick={shelf.retry}>
                  {t.retry}
                </Button>
              </p>
            ) : null}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
