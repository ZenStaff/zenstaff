// @effect-diagnostics nodeBuiltinImport:off - a plain CLI/helper: sync hashing and file reads of release artifacts.
// Zen Staff: the pure half of scripts/zen-publish-release.ts. Reads electron-builder's
// latest*.yml, plans which objects go to the feed (installers and blockmaps first, the yml last)
// and checks what the public URL serves. See ZEN.md, "Updates and telemetry".
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  zenFeedFileName,
  zenReleaseFeedUrl,
  type ZenReleaseChannel,
  type ZenReleasePlatform,
} from "@t3tools/contracts/zenReleases";

export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const FEED_CACHE = "public, max-age=60";
/** The fixed download links (landing buttons) move with every release, so they cache briefly. */
export const ALIAS_CACHE = "public, max-age=300";

export interface FeedFile {
  url: string;
  sha512: string;
  size: number;
  blockMapSize?: number;
  isAdminRightsRequired?: boolean;
}

export interface Feed {
  version: string;
  files: FeedFile[];
  path: string;
  sha512: string;
  releaseDate?: string;
  releaseNotes?: string;
}

const unquote = (value: string) => {
  const v = value.trim();
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v) as string;
  return v;
};

const scalar = (key: string, value: string): string | number | boolean => {
  const text = unquote(value);
  if (key === "size" || key === "blockMapSize") return Number(text);
  if (key === "isAdminRightsRequired") return text === "true";
  return text;
};

/** Parses the subset of YAML electron-builder writes for latest*.yml. */
export function parseFeedYml(text: string): Feed {
  const feed: Record<string, unknown> = {};
  const files: Array<Record<string, unknown>> = [];
  let inFiles = false;
  let current: Record<string, unknown> | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    if (raw.trim() === "") continue;
    const item = /^\s+-\s+(\w+):\s*(.*)$/u.exec(raw);
    const nested = /^\s{2,}(\w+):\s*(.*)$/u.exec(raw);
    const top = /^(\w+):\s*(.*)$/u.exec(raw);
    if (inFiles && item) {
      current = { [item[1]!]: scalar(item[1]!, item[2]!) };
      files.push(current);
    } else if (inFiles && nested && current) {
      current[nested[1]!] = scalar(nested[1]!, nested[2]!);
    } else if (top) {
      inFiles = top[1] === "files" && top[2]!.trim() === "";
      current = null;
      if (!inFiles) feed[top[1]!] = scalar(top[1]!, top[2]!);
    } else {
      throw new Error(`Unexpected line in update feed: ${raw}`);
    }
  }
  if (typeof feed.version !== "string" || !feed.version) throw new Error("Feed has no version.");
  if (files.length === 0) throw new Error("Feed lists no files.");
  for (const file of files) {
    if (typeof file.url !== "string" || typeof file.sha512 !== "string") {
      throw new Error("Every feed file needs url and sha512.");
    }
  }
  return {
    ...(feed as Omit<Feed, "files">),
    files: files as unknown as FeedFile[],
  };
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function serializeFeedYml(feed: Feed): string {
  const lines = [`version: ${feed.version}`, "files:"];
  for (const file of feed.files) {
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`);
    if (file.blockMapSize !== undefined) lines.push(`    blockMapSize: ${file.blockMapSize}`);
    if (file.isAdminRightsRequired !== undefined) {
      lines.push(`    isAdminRightsRequired: ${file.isAdminRightsRequired}`);
    }
  }
  lines.push(`path: ${feed.path}`, `sha512: ${feed.sha512}`);
  if (feed.releaseDate) lines.push(`releaseDate: ${quote(feed.releaseDate)}`);
  if (feed.releaseNotes) lines.push(`releaseNotes: ${JSON.stringify(feed.releaseNotes)}`);
  return `${lines.join("\n")}\n`;
}

export function sha512Base64(bytes: Uint8Array): string {
  return NodeCrypto.createHash("sha512").update(bytes).digest("base64");
}

export function sha512OfFile(filePath: string): string {
  const hash = NodeCrypto.createHash("sha512");
  const fd = NodeFS.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(8 * 1024 * 1024);
    let read: number;
    while ((read = NodeFS.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    NodeFS.closeSync(fd);
  }
  return hash.digest("base64");
}

/** Semver order without build metadata; prereleases sort before their release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core = "", pre] = v.replace(/^v/u, "").split("+")[0]!.split(/-(.*)/su);
    return { core: core.split(".").map((n) => Number(n)), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export interface UploadObject {
  readonly local: string;
  readonly key: string;
  readonly cacheControl: string;
  readonly contentType: string;
}

export interface ReleasePlan {
  readonly feed: Feed;
  readonly feedFileName: string;
  readonly feedUrl: string;
  readonly prefix: string;
  /** Installers, blockmaps and extra Linux packages, uploaded first. */
  readonly objects: ReadonlyArray<UploadObject>;
  /** The latest*.yml, uploaded last. */
  readonly feedObject: UploadObject;
  readonly feedText: string;
}

export function contentTypeOf(name: string): string {
  if (name.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (name.endsWith(".deb")) return "application/vnd.debian.binary-package";
  if (name.endsWith(".rpm")) return "application/x-rpm";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

/**
 * Builds the upload plan for one platform's artifacts in `dir`. Checks every listed file's size
 * and sha512 against the yml. On Linux, the .deb/.rpm of the same version are added to `files`
 * so deb/rpm installs can link to them (electron-updater picks files by extension).
 */
export function planRelease(input: {
  readonly dir: string;
  readonly platform: ZenReleasePlatform;
  readonly channel: ZenReleaseChannel;
  readonly baseUrl: string;
  readonly arch?: string;
  readonly hash?: (filePath: string) => string;
}): ReleasePlan {
  const hash = input.hash ?? sha512OfFile;
  const feedFileName = zenFeedFileName(input.platform, input.arch);
  const feedPath = NodePath.join(input.dir, feedFileName);
  if (!NodeFS.existsSync(feedPath)) throw new Error(`Missing ${feedFileName} in ${input.dir}.`);
  const feed = parseFeedYml(NodeFS.readFileSync(feedPath, "utf8"));
  const prefix = `${input.channel}/${input.platform}`;
  const objects: UploadObject[] = [];
  const add = (name: string) => {
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) {
      throw new Error(`Refusing a feed file outside the release folder: ${name}`);
    }
    if (objects.some((object) => object.key === `${prefix}/${name}`)) return;
    objects.push({
      local: NodePath.join(input.dir, name),
      key: `${prefix}/${name}`,
      cacheControl: IMMUTABLE_CACHE,
      contentType: contentTypeOf(name),
    });
  };

  if (input.platform === "linux") {
    for (const name of NodeFS.readdirSync(input.dir).sort()) {
      if (!/\.(deb|rpm)$/u.test(name) || !name.includes(`-${feed.version}-`)) continue;
      if (feed.files.some((file) => file.url === name)) continue;
      const local = NodePath.join(input.dir, name);
      feed.files.push({ url: name, sha512: hash(local), size: NodeFS.statSync(local).size });
    }
  }

  for (const file of feed.files) {
    const local = NodePath.join(input.dir, file.url);
    if (!NodeFS.existsSync(local))
      throw new Error(`Missing ${file.url} listed in ${feedFileName}.`);
    const size = NodeFS.statSync(local).size;
    if (size !== file.size) throw new Error(`${file.url}: size ${size}, feed says ${file.size}.`);
    if (hash(local) !== file.sha512) throw new Error(`${file.url}: sha512 differs from the feed.`);
    add(file.url);
    if (NodeFS.existsSync(`${local}.blockmap`)) add(`${file.url}.blockmap`);
  }

  const feedText = serializeFeedYml(feed);
  return {
    feed,
    feedFileName,
    feedUrl: zenReleaseFeedUrl(input.baseUrl, input.channel, input.platform),
    prefix,
    objects,
    feedObject: {
      local: feedPath,
      key: `${prefix}/${feedFileName}`,
      cacheControl: FEED_CACHE,
      contentType: contentTypeOf(feedFileName),
    },
    feedText,
  };
}

/** A fixed download link (`Zen-Staff-Setup-x64.exe`) refreshed to point at this release. */
export interface AliasCopy {
  /** The versioned object already uploaded, e.g. `beta/win/Zen-Staff-0.2.2-x64.exe`. */
  readonly from: string;
  /** The fixed key the landing links to, e.g. `beta/win/Zen-Staff-Setup-x64.exe`. */
  readonly to: string;
  readonly cacheControl: string;
  readonly contentType: string;
  /** `attachment` for the Windows installer, so browsers save it instead of opening it. */
  readonly contentDisposition: string | null;
}

/**
 * The landing's stable download links, per platform: the Windows installer, the AppImage and the
 * .deb of this release. Each is a server-side copy of the versioned file, made after the feed is
 * verified, so a link never points at a release the feed does not serve yet.
 */
export function planAliases(plan: ReleasePlan): ReadonlyArray<AliasCopy> {
  const version = plan.feed.version;
  const rules: ReadonlyArray<{
    readonly match: RegExp;
    readonly alias: (m: RegExpExecArray) => string;
  }> = plan.prefix.endsWith("/win")
    ? [
        {
          match: /^Zen-Staff-(?:Setup-)?[^-]+-([^.]+)\.exe$/u,
          alias: (m) => `Zen-Staff-Setup-${m[1]}.exe`,
        },
      ]
    : plan.prefix.endsWith("/linux")
      ? [
          {
            match: /^Zen-Staff-[^-]+-([^.]+)\.AppImage$/u,
            alias: (m) => `Zen-Staff-${m[1]}.AppImage`,
          },
          { match: /^Zen-Staff-[^-]+-([^.]+)\.deb$/u, alias: (m) => `Zen-Staff-${m[1]}.deb` },
        ]
      : [];
  const aliases: AliasCopy[] = [];
  for (const object of plan.objects) {
    const name = object.key.slice(plan.prefix.length + 1);
    if (!name.includes(`-${version}-`)) continue;
    for (const rule of rules) {
      const m = rule.match.exec(name);
      if (m === null) continue;
      aliases.push({
        from: object.key,
        to: `${plan.prefix}/${rule.alias(m)}`,
        cacheControl: ALIAS_CACHE,
        contentType: object.contentType,
        contentDisposition: name.endsWith(".exe") ? "attachment" : null,
      });
    }
  }
  return aliases;
}
