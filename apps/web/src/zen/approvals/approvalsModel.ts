// Zen Staff client approval links: the pure parts the dialog and the chat card share (which files
// can be sent, which hub workspace the link goes to, the card's steps, new-status notices) and the
// brand colors read from a logo. Tested in approvalsModel.test.ts.

export type ApprovalFileKind = "image" | "video" | "pdf" | "text";
export type ApprovalStatus = "sent" | "viewed" | "approved" | "changes";

const KINDS: Readonly<Record<string, ApprovalFileKind>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  pdf: "pdf",
  md: "text",
  markdown: "text",
  txt: "text",
};

/** Same list as the server (`zen/hub/clientApprovals.ts`) and the hub, by extension. */
export function approvalKindOf(path: string): ApprovalFileKind | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match === null ? null : (KINDS[match[1]!.toLowerCase()] ?? null);
}

export interface HubCompanyOption {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export type WorkspaceChoice =
  | {
      readonly kind: "chosen";
      readonly id: string;
      readonly options: ReadonlyArray<HubCompanyOption>;
    }
  | { readonly kind: "choose"; readonly options: ReadonlyArray<HubCompanyOption> }
  | { readonly kind: "none" };

/**
 * Where the link is made: the hub company linked to the chat's local company, else the person's
 * only workspace where they are not a guest, else they choose (guests cannot send).
 */
export function pickHubWorkspace(input: {
  readonly localCompanyId: string | null;
  readonly links: Readonly<Record<string, string>>;
  readonly companies: ReadonlyArray<HubCompanyOption>;
}): WorkspaceChoice {
  const options = input.companies.filter((company) => company.role !== "guest");
  if (options.length === 0) return { kind: "none" };
  const linked = input.localCompanyId === null ? undefined : input.links[input.localCompanyId];
  if (linked !== undefined && options.some((company) => company.id === linked)) {
    return { kind: "chosen", id: linked, options };
  }
  if (options.length === 1) return { kind: "chosen", id: options[0]!.id, options };
  return { kind: "choose", options };
}

export interface HubApprovalState {
  readonly id: string;
  readonly status: ApprovalStatus;
  readonly active: boolean;
  readonly comment: string | null;
  readonly decidedByName: string | null;
  readonly decidedAt: string | null;
  readonly firstViewedAt: string | null;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly url: string;
  readonly threadId: string | null;
  readonly title: string;
  readonly clientName: string;
  readonly files: ReadonlyArray<{ readonly name: string; readonly kind: ApprovalFileKind }>;
  readonly createdAt: string;
  readonly lastStatus: string;
}

export interface ApprovalItem {
  readonly record: ApprovalRecord;
  readonly approval: HubApprovalState | null;
}

/** The three steps on the card: Trimis -> Văzut -> Aprobat / Modificări cerute. */
export function approvalSteps(status: ApprovalStatus): {
  readonly viewed: boolean;
  readonly answered: "approved" | "changes" | null;
} {
  return {
    viewed: status !== "sent",
    answered: status === "approved" || status === "changes" ? status : null,
  };
}

/** What the card shows as the headline status. */
export function cardStatus(item: ApprovalItem): ApprovalStatus | "closed" | "unknown" {
  const approval = item.approval;
  if (approval === null) return "unknown";
  if (approval.status === "approved" || approval.status === "changes") return approval.status;
  if (!approval.active) return "closed";
  return approval.status;
}

/** Statuses that changed since the last look (for a toast); the first look only remembers them. */
export function newStatuses(
  previous: ReadonlyMap<string, ApprovalStatus> | null,
  items: ReadonlyArray<ApprovalItem>,
): Array<{ readonly item: ApprovalItem; readonly status: ApprovalStatus }> {
  if (previous === null) return [];
  return items.flatMap((item) => {
    const status = item.approval?.status;
    if (status === undefined) return [];
    const before = previous.get(item.record.id);
    return before !== undefined && before !== status ? [{ item, status }] : [];
  });
}

const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();

/**
 * The logo's main colors (RGBA pixels from a small canvas): transparent and near-white pixels are
 * skipped (the background), close shades are merged, the most used come first.
 */
export function dominantColors(pixels: ArrayLike<number>, max = 3): Array<string> {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const r = pixels[index]!;
    const g = pixels[index + 1]!;
    const b = pixels[index + 2]!;
    const a = pixels[index + 3]!;
    if (a < 128) continue;
    if (r > 235 && g > 235 && b > 235) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .map((bucket) => ({
      count: bucket.count,
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
    }))
    .toSorted((left, right) => right.count - left.count);
  const counted = ranked.reduce((sum, color) => sum + color.count, 0);
  const picked: Array<{ r: number; g: number; b: number }> = [];
  for (const color of ranked) {
    // Anti-aliased edges (a few percent of the pixels) are not brand colors.
    if (color.count < counted * 0.04) break;
    const close = picked.some(
      (other) =>
        Math.abs(other.r - color.r) + Math.abs(other.g - color.g) + Math.abs(other.b - color.b) <
        90,
    );
    if (!close) picked.push(color);
    if (picked.length >= max) break;
  }
  return picked.map((color) => `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`);
}
