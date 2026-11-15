// Pure logic for the sidebar "Pinned" strip: which pinned projects show, in what order, how many
// threads each has open, what a chip click does to the project scope, and how many chips fit.
// Tested in pinnedProjectsModel.test.ts.
import {
  filterProjectGroupsByCompany,
  filterThreadsByCompany,
  type CompanyIndex,
} from "../companies/companiesModel";

export interface PinnableProjectGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly memberProjects: ReadonlyArray<{ readonly pinnedAt?: string | null | undefined }>;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
  }>;
}

export interface PinnedStripThread {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly archivedAt: unknown;
  readonly settledOverride?: string | null | undefined;
}

export interface PinnedProjectChip<Group> {
  readonly group: Group;
  readonly projectKey: string;
  readonly displayName: string;
  /** Threads not archived and not settled. */
  readonly openCount: number;
  /** Open threads with an agent running right now. */
  readonly workingCount: number;
  readonly selected: boolean;
}

export interface CompanyScope {
  readonly companyId: string | null;
  readonly index: CompanyIndex;
}

/** Earliest pin time among a group's checkouts; groups without one sort last. */
export function pinTimeOf(group: Pick<PinnableProjectGroup, "memberProjects">): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const member of group.memberProjects) {
    if (member.pinnedAt == null) continue;
    const time = Date.parse(member.pinnedAt);
    if (Number.isFinite(time) && time < earliest) earliest = time;
  }
  return earliest;
}

/**
 * Pinned, not archived groups. Keys in `customOrder` (from drag reordering) come first in that
 * order; the rest follow by pin time, oldest first, then by name.
 */
export function orderPinnedProjects<Group extends PinnableProjectGroup>(
  groups: ReadonlyArray<Group>,
  customOrder: ReadonlyArray<string>,
): Group[] {
  const rank = new Map(customOrder.map((key, index) => [key, index] as const));
  return groups
    .filter((group) => group.pinned && !group.archived)
    .toSorted((left, right) => {
      const leftRank = rank.get(left.projectKey);
      const rightRank = rank.get(right.projectKey);
      if (leftRank !== undefined || rightRank !== undefined) {
        if (leftRank === undefined) return 1;
        if (rightRank === undefined) return -1;
        return leftRank - rightRank;
      }
      const leftPin = pinTimeOf(left);
      const rightPin = pinTimeOf(right);
      if (leftPin !== rightPin) return leftPin < rightPin ? -1 : 1;
      return left.displayName.localeCompare(right.displayName);
    });
}

/** Chips for the strip, limited to the selected company (null = all companies). */
export function buildPinnedProjectChips<
  Group extends PinnableProjectGroup,
  Thread extends PinnedStripThread,
>(input: {
  readonly groups: ReadonlyArray<Group>;
  readonly threads: ReadonlyArray<Thread>;
  readonly customOrder: ReadonlyArray<string>;
  readonly scopeKeys: ReadonlyArray<string>;
  readonly isWorking: (thread: Thread) => boolean;
  readonly company?: CompanyScope | undefined;
}): PinnedProjectChip<Group>[] {
  const { company } = input;
  const groups = company
    ? filterProjectGroupsByCompany(input.groups, company.companyId, company.index)
    : input.groups;
  const threads = company
    ? filterThreadsByCompany(input.threads, company.companyId, company.index)
    : input.threads;
  const counts = new Map<string, { open: number; working: number }>();
  for (const thread of threads) {
    if (thread.archivedAt != null || thread.settledOverride === "settled") continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    const entry = counts.get(key) ?? { open: 0, working: 0 };
    entry.open += 1;
    if (input.isWorking(thread)) entry.working += 1;
    counts.set(key, entry);
  }
  return orderPinnedProjects(groups, input.customOrder).map((group) => {
    let openCount = 0;
    let workingCount = 0;
    for (const ref of group.memberProjectRefs) {
      const entry = counts.get(`${ref.environmentId}:${ref.projectId}`);
      if (!entry) continue;
      openCount += entry.open;
      workingCount += entry.working;
    }
    return {
      group,
      projectKey: group.projectKey,
      displayName: group.displayName,
      openCount,
      workingCount,
      selected: input.scopeKeys.includes(group.projectKey),
    };
  });
}

/**
 * The scope after clicking a chip. A plain click scopes to that project, or clears the scope when
 * it is already the only one; Shift+click adds or removes it, like Shift in the scope menu.
 */
export function nextScopeForChip(
  scopeKeys: ReadonlyArray<string>,
  projectKey: string,
  additive: boolean,
): string[] {
  if (additive) {
    return scopeKeys.includes(projectKey)
      ? scopeKeys.filter((key) => key !== projectKey)
      : [...scopeKeys, projectKey];
  }
  return scopeKeys.length === 1 && scopeKeys[0] === projectKey ? [] : [projectKey];
}

/** Moves `fromKey` to `toKey`'s place in the shown order; returns the new custom order. */
export function reorderPinnedKeys(
  shownKeys: ReadonlyArray<string>,
  fromKey: string,
  toKey: string,
): string[] {
  const from = shownKeys.indexOf(fromKey);
  const to = shownKeys.indexOf(toKey);
  if (from === -1 || to === -1 || from === to) return [...shownKeys];
  const next = shownKeys.filter((key) => key !== fromKey);
  next.splice(to, 0, fromKey);
  return next;
}

/**
 * How many chips fit in `available` pixels. When not all fit, room is kept for the "+N" button.
 * Always shows at least one chip when there is any.
 */
export function visibleChipCount(input: {
  readonly chipWidths: ReadonlyArray<number>;
  readonly available: number;
  readonly gap: number;
  readonly overflowWidth: number;
}): number {
  const { chipWidths, available, gap, overflowWidth } = input;
  const total = chipWidths.reduce((sum, width) => sum + width, 0) + gap * (chipWidths.length - 1);
  if (chipWidths.length === 0 || total <= available) return chipWidths.length;
  let used = overflowWidth;
  let count = 0;
  for (const width of chipWidths) {
    const next = used + gap + width;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return Math.max(1, count);
}
