// Zen Staff AI staff: pure helpers for the pages (org chart tree, hub members, highlights, the
// printable lost-hours report). Tested in staffModel.test.ts.
import type {
  StaffAgent,
  StaffCheckerFinding,
  StaffDiscoveryResult,
  StaffHuman,
} from "@t3tools/contracts/zenStaff";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0]!.slice(0, 2) : `${parts[0]![0]}${parts[1]![0]}`;
  return letters.toUpperCase();
}

export interface HubMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
}

/** Hub members of the linked company join the local people (a local entry with the same e-mail wins). */
export function mergeHubMembers(
  humans: ReadonlyArray<StaffHuman>,
  members: ReadonlyArray<HubMember>,
): StaffHuman[] {
  const emails = new Set(humans.map((human) => human.email?.toLowerCase()).filter(Boolean));
  return [
    ...humans,
    ...members
      .filter((member) => !emails.has(member.email.toLowerCase()))
      .map((member) => ({
        id: `hub-${member.userId}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80),
        name: member.name || member.email,
        email: member.email,
        title: member.role,
        managerId: null,
        source: "hub" as const,
      })),
  ];
}

export type OrgNode =
  | {
      readonly kind: "human";
      readonly human: StaffHuman;
      readonly children: ReadonlyArray<OrgNode>;
    }
  | {
      readonly kind: "agent";
      readonly agent: StaffAgent;
      readonly children: ReadonlyArray<OrgNode>;
    };

/**
 * People and agents in one tree: each reports to its manager; anyone whose manager is missing
 * (or would make a loop) is a root. People come before agents at each level.
 */
export function buildOrgChart(
  humans: ReadonlyArray<StaffHuman>,
  agents: ReadonlyArray<StaffAgent>,
): OrgNode[] {
  const humanIds = new Set(humans.map((human) => human.id));
  const build = (managerId: string | null, seen: ReadonlySet<string>): OrgNode[] => {
    const people = humans
      .filter((human) =>
        managerId === null
          ? human.managerId === null || !humanIds.has(human.managerId)
          : human.managerId === managerId,
      )
      .filter((human) => !seen.has(human.id));
    const staff = agents.filter((agent) =>
      managerId === null
        ? agent.managerId === null || !humanIds.has(agent.managerId)
        : agent.managerId === managerId,
    );
    return [
      ...people.map((human): OrgNode => {
        const next = new Set(seen).add(human.id);
        return { kind: "human", human, children: build(human.id, next) };
      }),
      ...staff.map((agent): OrgNode => ({ kind: "agent", agent, children: [] })),
    ];
  };
  const tree = build(null, new Set());
  // People caught in a manager loop never reach a root: show them at the top.
  const placed = new Set<string>();
  const walk = (nodes: ReadonlyArray<OrgNode>) => {
    for (const node of nodes) {
      if (node.kind === "human") placed.add(node.human.id);
      walk(node.children);
    }
  };
  walk(tree);
  const orphans = humans.filter((human) => !placed.has(human.id));
  return [
    ...tree,
    ...orphans.map((human): OrgNode => ({
      kind: "human",
      human: { ...human, managerId: null },
      children: build(human.id, new Set([human.id])),
    })),
  ];
}

export interface Segment {
  /** Offset in the content; a stable key. */
  readonly start: number;
  readonly text: string;
  readonly finding: StaffCheckerFinding | null;
}

/** The content cut into plain and highlighted parts, one highlight per finding's first match. */
export function highlightSegments(
  content: string,
  findings: ReadonlyArray<StaffCheckerFinding>,
): Segment[] {
  const marks: Array<{ start: number; end: number; finding: StaffCheckerFinding }> = [];
  for (const finding of findings) {
    const excerpt = finding.excerpt.trim();
    if (excerpt.length < 2) continue;
    const start = content.toLowerCase().indexOf(excerpt.toLowerCase());
    if (start === -1) continue;
    const end = start + excerpt.length;
    if (marks.some((mark) => start < mark.end && end > mark.start)) continue;
    marks.push({ start, end, finding });
  }
  marks.sort((left, right) => left.start - right.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start > cursor)
      segments.push({ start: cursor, text: content.slice(cursor, mark.start), finding: null });
    segments.push({
      start: mark.start,
      text: content.slice(mark.start, mark.end),
      finding: mark.finding,
    });
    cursor = mark.end;
  }
  if (cursor < content.length)
    segments.push({ start: cursor, text: content.slice(cursor), finding: null });
  return segments;
}

export function parsePriceList(text: string): Array<{ item: string; price: number }> {
  return text
    .split(/\r?\n/)
    .map((line) => /^(.+?)\s*[=:]\s*(\d+(?:[.,]\d{1,2})?)/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ item: match[1]!.trim(), price: Number(match[2]!.replace(",", ".")) }));
}

export function formatPriceList(
  prices: ReadonlyArray<{ readonly item: string; readonly price: number }>,
): string {
  return prices.map((entry) => `${entry.item} = ${entry.price}`).join("\n");
}

export function formatTokens(tokens: number, locale: string): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000).toLocaleString(locale)}k`;
  return tokens.toLocaleString(locale);
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** The printable "lost hours map" (the free-audit sales tool): a standalone HTML page. */
export function lostHoursReportHtml(input: {
  readonly title: string;
  readonly subtitle: string;
  readonly total: string;
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly footer: string;
  readonly date: string;
  readonly lang: string;
  readonly result: Pick<StaffDiscoveryResult, "hoursPerMonth">;
}): string {
  const max = Math.max(1, ...input.rows.map((row) => Number.parseFloat(row[4] ?? "0") || 0));
  const rows = input.rows
    .map((row) => {
      const hours = Number.parseFloat(row[4] ?? "0") || 0;
      return `<tr>${row
        .map((cell, index) =>
          index === 4
            ? `<td class="num"><div class="bar"><span style="width:${Math.round((hours / max) * 100)}%"></span></div>${escapeHtml(cell)}</td>`
            : `<td>${escapeHtml(cell)}</td>`,
        )
        .join("")}</tr>`;
    })
    .join("");
  return `<!doctype html><html lang="${escapeHtml(input.lang)}"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>
body{font-family:"Source Sans 3","Segoe UI",system-ui,sans-serif;color:#1B2B24;margin:40px;}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-0.01em}
.sub{color:#4b5d55;margin:0 0 24px}
.total{font-size:20px;background:#eef6f1;border-left:4px solid #2F6F5E;padding:14px 18px;margin:0 0 28px}
.total b{font-size:34px;display:block;color:#2F6F5E}
table{border-collapse:collapse;width:100%;font-size:14px}
th{text-align:left;border-bottom:2px solid #1B2B24;padding:8px 6px}
td{border-bottom:1px solid #d9e2dd;padding:8px 6px;vertical-align:top}
td.num{white-space:nowrap}
.bar{display:inline-block;width:90px;height:8px;background:#e6ece8;margin-right:8px;vertical-align:middle}
.bar span{display:block;height:8px;background:#2F6F5E}
footer{margin-top:28px;color:#6b7c74;font-size:12px}
@media print{body{margin:16mm}}
</style></head><body>
<h1>${escapeHtml(input.title)}</h1>
<p class="sub">${escapeHtml(input.subtitle)} · ${escapeHtml(input.date)}</p>
<p class="total"><b>${escapeHtml(String(input.result.hoursPerMonth))} h</b>${escapeHtml(input.total)}</p>
<table><thead><tr>${input.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
<footer>${escapeHtml(input.footer)} Zen Staff · zed-zen.com</footer>
</body></html>`;
}

// The redesigned AI staff page: six areas instead of eight tabs, and an employee's own page.

export const STAFF_AREAS = [
  "team",
  "hire",
  "approvals",
  "board",
  "performance",
  "settings",
] as const;
export type StaffArea = (typeof STAFF_AREAS)[number];

export const STAFF_PROFILE_TABS = [
  "tasks",
  "instructions",
  "tools",
  "schedule",
  "history",
] as const;
export type StaffProfileTab = (typeof STAFF_PROFILE_TABS)[number];

/** Old tab names (links in docs, toasts, the palette) still land in the right area. */
const LEGACY_AREAS: Readonly<Record<string, StaffArea>> = {
  evaluation: "performance",
  quality: "performance",
  discover: "hire",
};

export interface StaffSearch {
  readonly tab?: StaffArea;
  readonly company?: string;
  /** The machine (environment) whose AI staff is shown; without it the page picks one. */
  readonly machine?: string;
  /** An AI employee's own page. */
  readonly agent?: string;
  readonly profile?: StaffProfileTab;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MACHINE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The /staff search params, validated; unknown values are dropped. */
export function parseStaffSearch(raw: Readonly<Record<string, unknown>>): StaffSearch {
  const tab =
    typeof raw.tab === "string"
      ? (STAFF_AREAS as ReadonlyArray<string>).includes(raw.tab)
        ? (raw.tab as StaffArea)
        : LEGACY_AREAS[raw.tab]
      : undefined;
  const profile =
    typeof raw.profile === "string" &&
    (STAFF_PROFILE_TABS as ReadonlyArray<string>).includes(raw.profile)
      ? (raw.profile as StaffProfileTab)
      : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(typeof raw.company === "string" && /^[a-z0-9-]{1,64}$/.test(raw.company)
      ? { company: raw.company }
      : {}),
    ...(typeof raw.machine === "string" && MACHINE_ID.test(raw.machine)
      ? { machine: raw.machine }
      : {}),
    ...(typeof raw.agent === "string" && ID.test(raw.agent) ? { agent: raw.agent } : {}),
    ...(profile ? { profile } : {}),
  };
}

/** A company's AI staff on one connected machine; `agents` is null while it is still asked. */
export interface StaffMachine {
  readonly environmentId: string;
  readonly agents: number | null;
}

/**
 * The machine the AI staff page shows. AI employees live on the machine that hired them (often
 * a server the app is paired with), so: the machine asked for, else the one where most of the
 * company's AI employees work (this computer on a tie), else this computer. Null while a machine
 * that could still win has not answered.
 */
export function pickStaffMachine(
  machines: ReadonlyArray<StaffMachine>,
  requested: string | undefined,
  primary: string,
): string | null {
  if (requested !== undefined && machines.some((machine) => machine.environmentId === requested))
    return requested;
  if (machines.some((machine) => machine.agents === null)) return null;
  let best: StaffMachine | null = null;
  for (const machine of machines) {
    const agents = machine.agents ?? 0;
    if (agents === 0) continue;
    if (
      best === null ||
      agents > (best.agents ?? 0) ||
      (agents === best.agents && machine.environmentId === primary)
    )
      best = machine;
  }
  return best?.environmentId ?? primary;
}

/** An agent's latest task (running first, then by start time). */
export function latestRunOf<
  R extends { readonly agentId: string; readonly startedAt: string; readonly status: string },
>(agentId: string, runs: ReadonlyArray<R>): R | null {
  let best: R | null = null;
  for (const run of runs) {
    if (run.agentId !== agentId) continue;
    if (best === null) {
      best = run;
      continue;
    }
    const running = (candidate: R) => (candidate.status === "running" ? 1 : 0);
    if (
      running(run) > running(best) ||
      (running(run) === running(best) && run.startedAt > best.startedAt)
    ) {
      best = run;
    }
  }
  return best;
}

/** "Mo-Fr" style day list for working hours (1 = Monday ... 7 = Sunday). */
export function describeDays(days: ReadonlyArray<number>, names: ReadonlyArray<string>): string {
  const sorted = [...new Set(days)].filter((day) => day >= 1 && day <= 7).toSorted((a, b) => a - b);
  if (sorted.length === 0) return "";
  const ranges: string[] = [];
  let start = sorted[0]!;
  let previous = start;
  for (const day of [...sorted.slice(1), Number.NaN]) {
    if (day === previous + 1) {
      previous = day;
      continue;
    }
    const from = names[start - 1]!;
    const to = names[previous - 1]!;
    ranges.push(
      start === previous ? from : previous === start + 1 ? `${from}, ${to}` : `${from}-${to}`,
    );
    start = day;
    previous = day;
  }
  return ranges.join(", ");
}

/**
 * The kind a role is hired as without a dialog: a company employee only where the company can
 * run one (company account and server); otherwise the person's own assistant, never blocked.
 */
export function hireKindFor(
  suggested: StaffAgent["kind"],
  companyPlacementOk: boolean,
): StaffAgent["kind"] {
  return suggested === "company" && companyPlacementOk ? "company" : "personal";
}

/** The manager of a new hire: the person hiring (`me`), else the first person in the company. */
export function hireManagerId(humans: ReadonlyArray<StaffHuman>, me: string): string | null {
  const wanted = me.trim().toLocaleLowerCase();
  return (
    humans.find((human) => human.name.trim().toLocaleLowerCase() === wanted)?.id ??
    humans[0]?.id ??
    null
  );
}
