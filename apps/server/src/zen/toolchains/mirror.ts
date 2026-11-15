// Zen Staff: pinned downloads come first from a mirror (tools.zed-zen.com, R2), then the official URL.
// The catalog sha256 hashes the file bytes, so a mirror cannot change what installs. Layout and
// choice rules: ZEN.md "Tool mirror"; the uploader (night-ops zen-mirror-sync.mjs) uses the same key.
import type { ZenRecipeStep } from "@t3tools/contracts/zenToolchains";

export const DEFAULT_TOOLS_MIRROR = "https://tools.zed-zen.com";

const OFF = new Set(["off", "0", "none", "false", "no"]);

/** A mirror base: https only, no query or fragment, no trailing slash. Null when unusable. */
export function normalizeMirrorBase(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  // http only for a local test server; real mirrors are https.
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "")
    return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Whether a Settings value is acceptable ("default", "off" or a mirror base). */
export function isValidMirrorSetting(value: string): boolean {
  const text = value.trim().toLowerCase();
  return text === "default" || OFF.has(text) || normalizeMirrorBase(value) !== null;
}

/** The mirror bases to try, in order (empty = official URLs only). */
export function resolveMirrorBases(
  envValue: string | undefined,
  setting: string | undefined,
): ReadonlyArray<string> {
  const pick = (value: string): ReadonlyArray<string> | null => {
    const text = value.trim();
    if (text === "" || text.toLowerCase() === "default") return null;
    if (OFF.has(text.toLowerCase())) return [];
    const bases = text
      .split(",")
      .map(normalizeMirrorBase)
      .filter((base): base is string => base !== null);
    return [...new Set(bases)];
  };
  return pick(envValue ?? "") ?? pick(setting ?? "") ?? [DEFAULT_TOOLS_MIRROR];
}

type DownloadStep = Extract<ZenRecipeStep, { type: "download" }>;

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** The object's file name on the mirror. */
function mirrorFileName(step: DownloadStep): string {
  const archive = step.archive ?? "none";
  if (archive === "none" && step.dest) return lastPart(step.dest);
  return decodeURIComponent(lastPart(new URL(step.url).pathname));
}

export interface MirrorTarget {
  readonly toolId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
}

/** The object key inside the bucket (no leading slash, not URL-encoded). */
export function mirrorKey(target: MirrorTarget, step: DownloadStep): string {
  return [target.toolId, target.version, `${target.os}-${target.arch}`, mirrorFileName(step)].join(
    "/",
  );
}

export function mirrorUrl(base: string, target: MirrorTarget, step: DownloadStep): string {
  return `${base}/${mirrorKey(target, step).split("/").map(encodeURIComponent).join("/")}`;
}

export interface DownloadSource {
  readonly url: string;
  readonly host: string;
  readonly mirror: boolean;
}

/** Mirrors first, then the official URL. */
export function downloadSources(
  bases: ReadonlyArray<string>,
  target: MirrorTarget | null,
  step: DownloadStep,
): ReadonlyArray<DownloadSource> {
  const official: DownloadSource = { url: step.url, host: new URL(step.url).host, mirror: false };
  if (target === null) return [official];
  return [
    ...bases.map((base) => {
      const url = mirrorUrl(base, target, step);
      return { url, host: new URL(url).host, mirror: true };
    }),
    official,
  ];
}
