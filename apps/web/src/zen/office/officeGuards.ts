// Zen Staff: what the Office edition removes from upstream surfaces. Pure functions over upstream
// shapes, each called from one small hook in an upstream file (listed in ZEN.md, "What Office
// hides"). Every guard asks the same check, `isZenOffice()` from editionStore.ts, unless the
// caller passes the edition explicitly (tests, React components that already subscribe).
import { isZenOffice } from "./editionStore";

// Keyboard shortcuts.

/** Commands that open terminals, diffs, pull requests, scripts, branches or worktrees. */
const OFFICE_BLOCKED_COMMAND_PREFIXES = ["terminal.", "diff.", "pullRequest.", "script."];
const OFFICE_BLOCKED_COMMANDS: ReadonlySet<string> = new Set([
  "composer.host",
  "composer.cycleHost",
  "composer.mode",
  "composer.workspace",
  "composer.previousWorktree",
  "composer.branch",
  "editor.openFavorite",
]);

/** False for a developer shortcut in Office. Used by keybindings.ts `resolveShortcutCommand`. */
export function zenOfficeAllowsCommand(command: string, office = isZenOffice()): boolean {
  if (!office) return true;
  if (OFFICE_BLOCKED_COMMANDS.has(command)) return false;
  return !OFFICE_BLOCKED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix));
}

// Command palette.

/** Upstream palette actions for git, pull requests, issues, project search and agent internals. */
const OFFICE_HIDDEN_PALETTE_ACTIONS: ReadonlySet<string> = new Set([
  "action:triage",
  "action:link-pull-request",
  "action:open-thread-pull-requests",
  "action:pull-requests",
  "action:copy-prompt-link-with-context",
  "action:restart-agent-session",
  "action:search-project-contents",
  "action:add-project:wsl-folder",
]);

/** Drops developer actions from the palette's root list. Used by CommandPalette.tsx. */
export function zenOfficePaletteItems<T extends { readonly value: string }>(
  items: ReadonlyArray<T>,
  office = isZenOffice(),
): T[] {
  if (!office) return [...items];
  return items.filter((item) => !OFFICE_HIDDEN_PALETTE_ACTIONS.has(item.value));
}

// Thread and draft menus.

/** Branch, worktree and id entries of the sidebar thread/draft menus. */
const OFFICE_HIDDEN_MENU_IDS: ReadonlySet<string> = new Set([
  "new-thread-on-branch",
  "copy-branch",
  "copy-thread-id",
  "auto-settle",
]);

interface MenuItemLike {
  readonly id: string;
  readonly children?: ReadonlyArray<MenuItemLike>;
}

/** Removes developer entries (and empty submenus). Used by threadActionMenu.logic.ts. */
export function zenOfficeMenuItems<T extends MenuItemLike>(
  items: ReadonlyArray<T>,
  office = isZenOffice(),
): ReadonlyArray<T> {
  if (!office) return items;
  const result: T[] = [];
  for (const item of items) {
    if (OFFICE_HIDDEN_MENU_IDS.has(item.id)) continue;
    if (item.children) {
      const children = item.children.filter((child) => !OFFICE_HIDDEN_MENU_IDS.has(child.id));
      if (children.length === 0) continue;
      result.push({ ...item, children });
    } else {
      result.push(item);
    }
  }
  return result;
}

// Sidebar thread rows.

interface ThreadMarkers {
  readonly branch: string | null;
  readonly linkedPullRequest?: unknown;
  readonly pullRequests?: ReadonlyArray<unknown>;
  readonly branchPullRequest?: unknown;
}

const NO_PULL_REQUESTS: ReadonlyArray<never> = [];
const strippedThreads = new WeakMap<object, unknown>();

/**
 * The thread as an Office sidebar row sees it: no branch (so no worktree marker or branch line)
 * and no pull requests (so no PR badge). The real thread is untouched. Used by SidebarThreadRow.
 */
export function zenOfficeSidebarThread<T extends ThreadMarkers>(thread: T, office: boolean): T {
  if (!office) return thread;
  if (thread.branch === null && !thread.linkedPullRequest && !thread.pullRequests?.length) {
    return thread;
  }
  const cached = strippedThreads.get(thread) as T | undefined;
  if (cached) return cached;
  const stripped: T = {
    ...thread,
    branch: null,
    linkedPullRequest: null,
    pullRequests: NO_PULL_REQUESTS,
    branchPullRequest: null,
  };
  strippedThreads.set(thread, stripped);
  return stripped;
}
