// Sidebar "Pinned" strip: one chip per pinned project of the selected company, under the thread
// header. A click scopes the thread list to that project (the same persisted scope the project
// scope menu writes); a second click or "All" clears it. Chips that do not fit collapse into "+N",
// which opens the scope menu. Drag a chip onto another to reorder (Zen local order).
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { LayersIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useProjectPin } from "../../hooks/useProjectGroupUpdate";
import { observeResize } from "../../lib/observeResize";
import { zenText, useZenText } from "../i18n/zenI18n";
import { pinnedText } from "./pinnedProjects.i18n";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useActiveCompanyId, useCompanyIndex } from "../companies/companiesState";
import {
  buildPinnedProjectChips,
  nextScopeForChip,
  reorderPinnedKeys,
  visibleChipCount,
  type PinnedProjectChip,
} from "./pinnedProjectsModel";
import { usePinnedProjectOrderStore } from "./pinnedProjectsState";

type Chip = PinnedProjectChip<SidebarProjectSnapshot>;

const GAP_PX = 4;
const OVERFLOW_BUTTON_PX = 32;
// A chip may shrink (its name truncates) down to this width before it moves into "+N".
const CHIP_MIN_PX = 72;

const chipClass = (selected: boolean) =>
  cn(
    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs outline-none select-none",
    "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70",
    selected
      ? "bg-sidebar-row-selected font-medium text-sidebar-foreground"
      : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
  );

interface StripProps {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly scopeKeys: ReadonlyArray<string>;
  readonly onScopeChange: (keys: readonly string[]) => void;
  readonly onOpenScopeMenu: () => void;
}

/** Renders nothing when the selected company has no pinned project. */
export function ZenPinnedProjectsStrip(props: StripProps) {
  const companyIndex = useCompanyIndex();
  const companyId = useActiveCompanyId(companyIndex);
  const order = usePinnedProjectOrderStore((store) => store.order);
  const chips = buildPinnedProjectChips({
    groups: props.groups,
    threads: props.threads,
    customOrder: order,
    scopeKeys: props.scopeKeys,
    isWorking: isThreadWorking,
    company: { companyId, index: companyIndex },
  });
  if (chips.length === 0) return null;
  return <PinnedStripRow {...props} chips={chips} />;
}

function PinnedStripRow(props: StripProps & { readonly chips: ReadonlyArray<Chip> }) {
  const t = useZenText(pinnedText);
  const { chips } = props;
  const setOrder = usePinnedProjectOrderStore((store) => store.setOrder);
  const { canPinProjectGroup, setProjectGroupPinned } = useProjectPin();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fitCount, setFitCount] = useState(chips.length);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the row and the hidden chip copies before paint to decide how many chips fit beside "+N"
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const update = () => {
      // The first measured child is the "All" chip, which is always shown.
      const [allChip, ...chipNodes] = [...measure.children] as HTMLElement[];
      setFitCount(
        visibleChipCount({
          chipWidths: chipNodes.map((node) => Math.min(node.offsetWidth, CHIP_MIN_PX)),
          available: row.clientWidth - (allChip?.offsetWidth ?? 0) - GAP_PX,
          gap: GAP_PX,
          overflowWidth: OVERFLOW_BUTTON_PX,
        }),
      );
    };
    update();
    return observeResize([row, measure], update);
  }, []);

  const visible = Math.min(fitCount, chips.length);
  const hidden = chips.slice(visible);
  const allSelected = props.scopeKeys.length === 0;

  const showChipMenu = (event: ReactMouseEvent, chip: Chip) => {
    const api = readLocalApi();
    if (!api || !canPinProjectGroup(chip.group)) return;
    event.preventDefault();
    const position = { x: event.clientX, y: event.clientY };
    void (async () => {
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [{ id: "unpin", label: zenText(pinnedText).unpin, icon: "pin-off" }],
          position,
        ),
      );
      if (clicked._tag === "Success" && clicked.value === "unpin") {
        setProjectGroupPinned(chip.group, false);
      }
    })();
  };

  const clearDrag = () => {
    setDragKey(null);
    setDropKey(null);
  };

  return (
    <div className="relative mt-1" data-zen-pinned-projects>
      <div
        ref={rowRef}
        role="toolbar"
        aria-label={t.toolbar}
        className="flex min-w-0 items-center overflow-hidden"
        style={{ gap: GAP_PX }}
      >
        <button
          type="button"
          className={chipClass(allSelected)}
          aria-pressed={allSelected}
          aria-label={t.allProjects}
          onClick={() => props.onScopeChange([])}
        >
          <LayersIcon className="size-3.5 shrink-0" aria-hidden />
          <span>{t.all}</span>
        </button>
        {chips.slice(0, visible).map((chip) => (
          <ChipTooltip key={chip.projectKey} label={chipTooltip(chip, t)}>
            <button
              type="button"
              draggable
              className={cn(
                chipClass(chip.selected),
                "min-w-0 shrink",
                dragKey === chip.projectKey && "opacity-50",
                dropKey === chip.projectKey &&
                  dragKey !== chip.projectKey &&
                  "ring-1 ring-inset ring-ring/70",
              )}
              aria-pressed={chip.selected}
              aria-label={t.counts(chip.displayName, chip.openCount, chip.workingCount)}
              data-project-key={chip.projectKey}
              onClick={(event) =>
                props.onScopeChange(
                  nextScopeForChip(props.scopeKeys, chip.projectKey, event.shiftKey),
                )
              }
              onContextMenu={(event) => showChipMenu(event, chip)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", chip.displayName);
                setDragKey(chip.projectKey);
              }}
              onDragEnter={() => setDropKey(chip.projectKey)}
              onDragOver={(event) => {
                if (dragKey !== null) event.preventDefault();
              }}
              onDragEnd={clearDrag}
              onDrop={(event) => {
                event.preventDefault();
                if (dragKey !== null && dragKey !== chip.projectKey) {
                  setOrder(
                    reorderPinnedKeys(
                      chips.map((entry) => entry.projectKey),
                      dragKey,
                      chip.projectKey,
                    ),
                  );
                }
                clearDrag();
              }}
            >
              <ChipContent chip={chip} />
            </button>
          </ChipTooltip>
        ))}
        {hidden.length > 0 ? (
          <ChipTooltip
            label={`+${hidden.length}: ${hidden.map((chip) => chip.displayName).join(", ")}`}
          >
            <button
              type="button"
              className={cn(
                chipClass(hidden.some((chip) => chip.selected)),
                "justify-center tabular-nums",
              )}
              style={{ minWidth: OVERFLOW_BUTTON_PX - GAP_PX }}
              aria-label={t.hiddenMore(hidden.length)}
              onClick={props.onOpenScopeMenu}
            >
              +{hidden.length}
            </button>
          </ChipTooltip>
        ) : null}
      </div>
      {/* Hidden copy that measures each chip's natural width. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max"
        style={{ gap: GAP_PX }}
      >
        <span className={chipClass(false)}>
          <LayersIcon className="size-3.5 shrink-0" />
          <span>{t.all}</span>
        </span>
        {chips.map((chip) => (
          <span key={chip.projectKey} className={chipClass(chip.selected)}>
            <ChipContent chip={chip} />
          </span>
        ))}
      </div>
    </div>
  );
}

function ChipTooltip(props: { readonly label: ReactNode; readonly children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function chipTooltip(chip: Chip, t: (typeof pinnedText)["en"]): ReactNode {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{t.counts(chip.displayName, chip.openCount, chip.workingCount)}</span>
      <span className="text-muted-foreground">{t.shiftClick}</span>
    </span>
  );
}

function ChipContent({ chip }: { readonly chip: Chip }) {
  return (
    <>
      <ProjectFavicon project={chip.group} className="size-3.5 shrink-0" />
      <span className="min-w-0 max-w-30 truncate">{chip.displayName}</span>
      {chip.openCount > 0 ? (
        <span className="flex shrink-0 items-center gap-0.5 text-3xs tabular-nums text-sidebar-muted-foreground">
          {chip.workingCount > 0 ? (
            <span className="size-1.5 animate-pulse rounded-full bg-info" />
          ) : null}
          {chip.openCount}
        </span>
      ) : null}
    </>
  );
}
