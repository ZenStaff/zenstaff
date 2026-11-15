// Zen Staff community library ("Bibliotecă"): pure helpers for the library page, the publish dialog
// and the submission status. Tested in libraryModel.test.ts. ZEN.md, "Community library".
import type { ZenMarketplaceEntry, ZenRegistryEntry } from "@t3tools/contracts/zenOffice";

/** Where a pack comes from: Zen Staff's own (bundled or our registry) or the community library. */
export type LibraryOrigin = "zen" | "community";

export const originOf = (entry: Pick<ZenRegistryEntry, "community">): LibraryOrigin =>
  entry.community === undefined ? "zen" : "community";

export type OriginFilter = "all" | LibraryOrigin;

export function matchesOrigin(item: ZenMarketplaceEntry, filter: OriginFilter): boolean {
  return filter === "all" || originOf(item.entry) === filter;
}

/** "de Ana Pop · Bistro Ana · 120 instalări" parts, for a community pack. */
export function creditParts(
  entry: Pick<ZenRegistryEntry, "community" | "author">,
): { readonly author: string; readonly company: string | null; readonly installs: number } | null {
  const community = entry.community;
  if (community === undefined) return null;
  return {
    author: community.author?.name ?? entry.author,
    company: community.author?.company ?? null,
    installs: community.installs,
  };
}

/**
 * The library order: Zen Staff's entries keep the registry order, then community packs, featured
 * first, then by installs. The pack a share link asked for (`install`) goes first.
 */
export function libraryOrder(
  items: ReadonlyArray<ZenMarketplaceEntry>,
  focusSlug: string | null,
): Array<ZenMarketplaceEntry> {
  const zen = items.filter((item) => item.entry.community === undefined);
  const community = items
    .filter((item) => item.entry.community !== undefined)
    .toSorted(
      (a, b) =>
        Number(b.entry.community!.featured) - Number(a.entry.community!.featured) ||
        b.entry.community!.installs - a.entry.community!.installs,
    );
  const ordered = [...zen, ...community];
  if (focusSlug === null) return ordered;
  const focus = ordered.findIndex((item) => item.entry.community?.slug === focusSlug);
  if (focus <= 0) return ordered;
  return [ordered[focus]!, ...ordered.slice(0, focus), ...ordered.slice(focus + 1)];
}

export type SubmissionStatus =
  | "pending"
  | "changes_requested"
  | "published"
  | "rejected"
  | "superseded"
  | "withdrawn";

export interface LibraryCheck {
  readonly id: string;
  readonly level: "pass" | "warn" | "fail";
  readonly findings: ReadonlyArray<string>;
}

export interface LibraryVersionView {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly status: SubmissionStatus;
  readonly reviewNote: string | null;
  readonly submittedAt: string;
  readonly decidedAt: string | null;
}

export interface LibraryPackView {
  readonly slug: string;
  readonly packId: string;
  readonly state: "new" | "published" | "unpublished";
  readonly installs: number;
  readonly featured: boolean;
  readonly unpublishedReason: string | null;
  readonly shareUrl: string | null;
  readonly versions: ReadonlyArray<LibraryVersionView>;
}

export interface LibraryMine {
  readonly signedIn: boolean;
  readonly author: {
    readonly name: string;
    readonly company: string | null;
    readonly url?: string;
  } | null;
  readonly packs: ReadonlyArray<LibraryPackView>;
}

export interface LibrarySource {
  readonly workflowId: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly icon: string;
  readonly version: string;
  readonly kind: "own" | "customized";
  readonly companyId: string | null;
}

/** Tone of a status chip: waiting, needs the author, done, refused. */
export function statusTone(
  status: SubmissionStatus,
): "waiting" | "action" | "done" | "refused" | "old" {
  switch (status) {
    case "pending":
      return "waiting";
    case "changes_requested":
      return "action";
    case "published":
      return "done";
    case "rejected":
      return "refused";
    default:
      return "old";
  }
}

/** The pack a source was already published as (same title), to offer the next version. */
export function nextVersion(current: string | null): string {
  if (current === null) return "1.0.0";
  const [major = 1, minor = 0] = current.split(".").map((part) => Number(part) || 0);
  return `${major}.${minor + 1}.0`;
}

/** The latest version of a pack the person sent, whatever its status. */
export function latestVersion(pack: LibraryPackView): LibraryVersionView | null {
  return pack.versions[0] ?? null;
}

/** The latest published version of a pack (the one people install), or null. */
export function publishedVersion(pack: LibraryPackView): string | null {
  return pack.versions.find((version) => version.status === "published")?.version ?? null;
}

const SCREENSHOT_LIMITS = { count: 4, bytes: 600 * 1024 } as const;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ScreenshotProblem = "type" | "size" | "count";

/** Why an image cannot be sent, or null: PNG, JPEG or WebP, at most 600 KB, at most four. */
export function screenshotProblem(
  file: { readonly type: string; readonly size: number },
  alreadyChosen: number,
): ScreenshotProblem | null {
  if (alreadyChosen >= SCREENSHOT_LIMITS.count) return "count";
  if (!(IMAGE_TYPES as ReadonlyArray<string>).includes(file.type)) return "type";
  if (file.size > SCREENSHOT_LIMITS.bytes) return "size";
  return null;
}

/** A pack id from a title, like the server does: lowercase words joined by dashes. */
export function packIdFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52)
    .replace(/-+$/, "");
}

export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
