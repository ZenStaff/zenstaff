// @effect-diagnostics nodeBuiltinImport:off - plain code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: tools already installed on the computer (PATH, per-OS folders, package managers).
// They run outside the pinned, sha256-checked supply chain, so the dialog says when one is used;
// range and advisories are checked in evaluate.ts like for Zen's own toolchains.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenToolchainOs } from "@t3tools/contracts/zenToolchains";

import type { CatalogEntry } from "./catalog.ts";
import type { InstalledToolchainRef } from "./evaluate.ts";
import { compareVersions } from "./versions.ts";

export interface SystemToolchain extends InstalledToolchainRef {
  readonly system: true;
  /** Where it was found, for the dialog and Details ("PATH", "Homebrew", "winget"…). */
  readonly source: string;
}

export interface SystemDetection {
  readonly toolId: string;
  readonly path: string;
  readonly version: string | null;
  readonly source: string;
  readonly accepted: boolean;
  readonly reason: string | null;
}

export interface DetectDeps {
  readonly os: ZenToolchainOs;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isFile: (path: string) => boolean;
  readonly listDir: (path: string) => ReadonlyArray<string>;
  readonly realPath: (path: string) => string;
  /** stdout + stderr, or null when it did not start or failed. */
  readonly run: (command: string, args: ReadonlyArray<string>) => Promise<string | null>;
}

/** Encoders and filters the shipped video packs call (kit/*.mjs, SKILL.md). */
export const FFMPEG_NEEDS = {
  encoders: ["libx264", "aac", "pcm_s16le"],
  filters: [
    "loudnorm",
    "drawtext",
    "xfade",
    "scale",
    "tile",
    "fps",
    "pad",
    "crop",
    "overlay",
    "concat",
    "amix",
    "hstack",
    "blackdetect",
    "ebur128",
    "select",
    "aresample",
    "atrim",
    "setpts",
    "trim",
    "fade",
  ],
} as const;

interface Spec {
  readonly names: ReadonlyArray<string>;
  readonly versionArgs: ReadonlyArray<string>;
  readonly parse: (output: string) => string | null;
}

const first = (pattern: RegExp) => (output: string) => pattern.exec(output)?.[1] ?? null;

const SPECS: Record<string, Spec> = {
  ffmpeg: {
    names: ["ffmpeg"],
    versionArgs: ["-hide_banner", "-version"],
    // "ffmpeg version 7.1.1-1ubuntu1", "n7.1", "7.1-full_build-www.gyan.dev"; git "N-…" has none.
    parse: first(/ffmpeg version n?(\d+(?:\.\d+)+)/),
  },
  node: { names: ["node"], versionArgs: ["--version"], parse: first(/^v(\d+\.\d+\.\d+)/m) },
  pandoc: {
    names: ["pandoc"],
    versionArgs: ["--version"],
    parse: first(/^pandoc (\d+(?:\.\d+)+)/m),
  },
  uv: { names: ["uv"], versionArgs: ["--version"], parse: first(/^uv (\d+\.\d+\.\d+)/m) },
  "yt-dlp": {
    names: ["yt-dlp"],
    versionArgs: ["--version"],
    parse: first(/^(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)\s*$/m),
  },
  python: {
    names: ["python3.12", "python3", "python"],
    versionArgs: ["--version"],
    parse: first(/^Python (\d+\.\d+\.\d+)/m),
  },
};

const exe = (os: ZenToolchainOs, name: string) => (os === "windows" ? `${name}.exe` : name);

function joinFor(os: ZenToolchainOs, ...parts: string[]): string {
  return os === "windows" ? NodePath.win32.join(...parts) : NodePath.posix.join(...parts);
}

/** Folders to look in besides PATH, with the label shown to the person. */
function knownDirs(
  deps: DetectDeps,
  toolId: string,
): ReadonlyArray<{ dir: string; source: string }> {
  const { env, os } = deps;
  const j = (...parts: string[]) => joinFor(os, ...parts);
  const out: { dir: string; source: string }[] = [];
  const add = (dir: string | undefined | null, source: string) => {
    if (dir) out.push({ dir, source });
  };
  if (os === "windows") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"];
    const local = env.LOCALAPPDATA;
    const user = env.USERPROFILE;
    add(local && j(local, "Microsoft", "WinGet", "Links"), "winget");
    add(user && j(user, "scoop", "shims"), "Scoop");
    add(j(env.ProgramData ?? "C:\\ProgramData", "chocolatey", "bin"), "Chocolatey");
    const programDirs: Record<string, string[]> = {
      ffmpeg: ["ffmpeg\\bin"],
      node: ["nodejs"],
      pandoc: ["Pandoc"],
      uv: [],
      "yt-dlp": ["yt-dlp"],
      python: [],
    };
    for (const sub of programDirs[toolId] ?? []) {
      add(j(programFiles, sub), "Program Files");
      add(programFilesX86 && j(programFilesX86, sub), "Program Files");
      add(local && j(local, "Programs", sub), "LocalAppData");
    }
    if (toolId === "ffmpeg") add("C:\\ffmpeg\\bin", "C:\\ffmpeg");
    if (toolId === "pandoc") add(local && j(local, "Pandoc"), "LocalAppData");
    if (toolId === "uv") add(user && j(user, ".local", "bin"), "uv installer");
    if (toolId === "python" && local) {
      for (const name of deps.listDir(j(local, "Programs", "Python"))) {
        add(j(local, "Programs", "Python", name), "python.org");
      }
    }
    // winget keeps portable packages (Gyan.FFmpeg, yt-dlp) under Packages\<id>\<build>\bin.
    if (local && (toolId === "ffmpeg" || toolId === "yt-dlp")) {
      const packages = j(local, "Microsoft", "WinGet", "Packages");
      for (const pkg of deps.listDir(packages)) {
        if (!pkg.toLowerCase().includes(toolId === "ffmpeg" ? "ffmpeg" : "yt-dlp")) continue;
        add(j(packages, pkg), "winget");
        for (const build of deps.listDir(j(packages, pkg))) {
          add(j(packages, pkg, build), "winget");
          add(j(packages, pkg, build, "bin"), "winget");
        }
      }
    }
    return out;
  }
  const home = env.HOME;
  if (os === "macos") {
    add("/opt/homebrew/bin", "Homebrew");
    add("/usr/local/bin", "Homebrew");
    if (toolId === "python") {
      const frameworks = "/Library/Frameworks/Python.framework/Versions";
      for (const version of deps.listDir(frameworks))
        add(j(frameworks, version, "bin"), "python.org");
    }
  } else {
    add("/usr/bin", NodeFS.existsSync("/var/lib/dpkg") ? "apt" : "system packages");
    add("/usr/local/bin", "/usr/local");
    add("/home/linuxbrew/.linuxbrew/bin", "Homebrew");
    add("/snap/bin", "snap");
  }
  add(home && j(home, ".local", "bin"), "~/.local/bin");
  add(home && j(home, ".cargo", "bin"), "~/.cargo/bin");
  return out;
}

/** Candidate executables for one tool, PATH first, without duplicates. */
function candidates(deps: DetectDeps, toolId: string): { path: string; source: string }[] {
  const spec = SPECS[toolId];
  if (!spec) return [];
  const { os, env } = deps;
  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = os === "windows" ? ";" : ":";
  const dirs = [
    ...pathValue
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => ({ dir, source: "PATH" })),
    ...knownDirs(deps, toolId),
  ];
  const seen = new Set<string>();
  const out: { path: string; source: string }[] = [];
  for (const { dir, source } of dirs) {
    // The Microsoft Store "python.exe" stub opens the Store instead of running Python.
    if (os === "windows" && /WindowsApps/i.test(dir)) continue;
    for (const name of spec.names) {
      const path = joinFor(os, dir, exe(os, name));
      if (!deps.isFile(path)) continue;
      let real = path;
      try {
        real = deps.realPath(path);
      } catch {
        // keep the link path
      }
      const key = os === "windows" ? real.toLowerCase() : real;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path, source });
    }
  }
  return out;
}

/** `py -0p` lines: " -V:3.12 *        C:\Python312\python.exe". */
export function parsePyLauncher(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => /\s(\S:\\.*\.exe)\s*$/i.exec(line)?.[1] ?? null)
    .filter((path): path is string => path !== null);
}

/** Second column of `ffmpeg -encoders` / `-filters` rows (" V....D libx264  …"). */
export function ffmpegNames(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[A-Z.|]{3,6}\s+([A-Za-z0-9_]+)\s/.exec(line);
    if (match) names.add(match[1]!);
  }
  return names;
}

function npmCli(deps: DetectDeps, node: string): string | null {
  const j = (...parts: string[]) => joinFor(deps.os, ...parts);
  const dirname = deps.os === "windows" ? NodePath.win32.dirname : NodePath.posix.dirname;
  const options: string[] = [];
  for (const path of [node, safeReal(deps, node)]) {
    const dir = dirname(path);
    if (deps.os === "windows") options.push(j(dir, "node_modules", "npm", "bin", "npm-cli.js"));
    else options.push(j(dirname(dir), "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  }
  if (deps.os !== "windows") options.push("/usr/share/nodejs/npm/bin/npm-cli.js");
  return options.find((path) => deps.isFile(path)) ?? null;
}

function safeReal(deps: DetectDeps, path: string): string {
  try {
    return deps.realPath(path);
  } catch {
    return path;
  }
}

async function detectBinary(
  deps: DetectDeps,
  toolId: string,
): Promise<{ detections: SystemDetection[]; tools: SystemToolchain[] }> {
  const spec = SPECS[toolId]!;
  const detections: SystemDetection[] = [];
  const tools: SystemToolchain[] = [];
  const dirname = deps.os === "windows" ? NodePath.win32.dirname : NodePath.posix.dirname;
  const found = candidates(deps, toolId);
  if (toolId === "python" && deps.os === "windows") {
    for (const path of parsePyLauncher((await deps.run("py", ["-0p"])) ?? "")) {
      if (
        !found.some((item) => item.path.toLowerCase() === path.toLowerCase()) &&
        deps.isFile(path)
      )
        found.push({ path, source: "py launcher" });
    }
  }
  for (const { path, source } of found) {
    const reject = (version: string | null, reason: string) =>
      detections.push({ toolId, path, version, source, accepted: false, reason });
    const output = await deps.run(path, spec.versionArgs);
    if (output === null) {
      reject(null, "does not start");
      continue;
    }
    const version = spec.parse(output);
    if (version === null) {
      reject(null, "version unknown (a development build cannot be checked against advisories)");
      continue;
    }
    const bins: Record<string, string> = {};
    const commands: Record<string, string[]> = {};
    if (toolId === "ffmpeg") {
      const probe = [deps.os === "windows" ? "ffprobe.exe" : "ffprobe"]
        .map((name) => joinFor(deps.os, dirname(path), name))
        .find((candidate) => deps.isFile(candidate));
      if (!probe) {
        reject(version, "ffprobe is missing next to it");
        continue;
      }
      const encoders = ffmpegNames((await deps.run(path, ["-hide_banner", "-encoders"])) ?? "");
      const filters = ffmpegNames((await deps.run(path, ["-hide_banner", "-filters"])) ?? "");
      const missing = [
        ...FFMPEG_NEEDS.encoders.filter((name) => !encoders.has(name)),
        ...FFMPEG_NEEDS.filters.filter((name) => !filters.has(name)),
      ];
      if (missing.length > 0) {
        reject(version, `missing ${missing.join(", ")}`);
        continue;
      }
      bins.ffmpeg = path;
      bins.ffprobe = probe;
    } else if (toolId === "node") {
      const npm = npmCli(deps, path);
      if (!npm) {
        reject(version, "npm is missing next to it");
        continue;
      }
      bins.node = path;
      bins.npm = npm;
    } else {
      bins[toolId] = path;
    }
    for (const [name, bin] of Object.entries(bins)) {
      commands[name] = bin.endsWith(".js") ? [bins.node ?? path, bin] : [bin];
    }
    detections.push({ toolId, path, version, source, accepted: true, reason: null });
    tools.push({
      toolId,
      version,
      dir: dirname(path),
      bins,
      commands,
      env: {},
      system: true,
      source,
    });
  }
  return { detections, tools };
}

const normalizeFamily = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Font families of a catalog font version, from its file names ("BarlowCondensed-Bold.ttf"). */
export function fontFamilies(entry: CatalogEntry, version: string): string[] {
  const steps = entry.versions.find((v) => v.version === version)?.recipes[0]?.steps ?? [];
  const families = new Set<string>();
  for (const step of steps) {
    if (step.type !== "download" || !step.dest || step.dest.includes("licenses")) continue;
    const file = step.dest.split("/").pop() ?? "";
    if (!/\.(ttf|otf)$/i.test(file)) continue;
    families.add(
      normalizeFamily(
        file
          .replace(/\.(ttf|otf)$/i, "")
          .split("-")[0]!
          .split("[")[0]!,
      ),
    );
  }
  return [...families];
}

/** Family -> folders holding its files: fc-list on Linux/macOS, the Fonts folders on Windows. */
async function systemFonts(deps: DetectDeps): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const add = (family: string, dir: string) => {
    const key = normalizeFamily(family);
    if (!key) return;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(dir);
  };
  if (deps.os === "windows") {
    const dirs = [
      joinFor("windows", deps.env.WINDIR ?? deps.env.SystemRoot ?? "C:\\Windows", "Fonts"),
      deps.env.LOCALAPPDATA &&
        joinFor("windows", deps.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"),
    ].filter((dir): dir is string => Boolean(dir));
    for (const dir of dirs) {
      for (const file of deps.listDir(dir)) {
        if (!/\.(ttf|otf)$/i.test(file)) continue;
        add(
          file
            .replace(/\.(ttf|otf)$/i, "")
            .split("-")[0]!
            .split("[")[0]!,
          dir,
        );
      }
    }
    return out;
  }
  const listing = await deps.run("fc-list", ["--format", "%{family}\\t%{file}\\n"]);
  for (const line of (listing ?? "").split("\n")) {
    const [families, file] = line.split("\t");
    if (!families || !file) continue;
    const dir = NodePath.posix.dirname(file);
    for (const family of families.split(",")) add(family, dir);
  }
  return out;
}

async function detectFonts(
  deps: DetectDeps,
  entry: CatalogEntry,
): Promise<{ detections: SystemDetection[]; tools: SystemToolchain[] }> {
  const fonts = await systemFonts(deps);
  const versions = entry.versions
    .map((v) => v.version)
    .toSorted((left, right) => compareVersions(right, left));
  for (const version of versions) {
    const families = fontFamilies(entry, version);
    const missing = families.filter((family) => !fonts.has(family));
    if (families.length === 0 || missing.length > 0) continue;
    // ZEN_FONTS_DIR is one folder: every family must be in the same one.
    const shared = [...fonts.get(families[0]!)!].find((dir) =>
      families.every((family) => fonts.get(family)!.has(dir)),
    );
    if (!shared) {
      return {
        detections: [
          {
            toolId: entry.id,
            path: [...fonts.get(families[0]!)!][0]!,
            version,
            source: "fonts",
            accepted: false,
            reason: "the fonts are spread across several folders",
          },
        ],
        tools: [],
      };
    }
    return {
      detections: [
        { toolId: entry.id, path: shared, version, source: "fonts", accepted: true, reason: null },
      ],
      tools: [
        {
          toolId: entry.id,
          version,
          dir: shared,
          bins: {},
          commands: {},
          env: { ZEN_FONTS_DIR: shared },
          system: true,
          source: "fonts",
        },
      ],
    };
  }
  const newest = versions[0];
  const missing = newest ? fontFamilies(entry, newest).filter((family) => !fonts.has(family)) : [];
  return {
    detections:
      fonts.size === 0
        ? []
        : [
            {
              toolId: entry.id,
              path: "",
              version: null,
              source: "fonts",
              accepted: false,
              reason: `missing families: ${missing.join(", ")}`,
            },
          ],
    tools: [],
  };
}

/** Playwright browsers already downloaded by another Playwright (reported, not used). */
function detectPlaywrightCache(deps: DetectDeps): SystemDetection[] {
  const { env, os } = deps;
  const dir =
    env.PLAYWRIGHT_BROWSERS_PATH ??
    (os === "windows"
      ? env.LOCALAPPDATA && joinFor(os, env.LOCALAPPDATA, "ms-playwright")
      : os === "macos"
        ? env.HOME && joinFor(os, env.HOME, "Library", "Caches", "ms-playwright")
        : env.HOME && joinFor(os, env.HOME, ".cache", "ms-playwright"));
  if (!dir) return [];
  const browsers = deps.listDir(dir).filter((name) => name.startsWith("chromium"));
  if (browsers.length === 0) return [];
  return [
    {
      toolId: "playwright",
      path: dir,
      version: null,
      source: "ms-playwright",
      accepted: false,
      reason: `${browsers.join(", ")}: Zen pins Playwright with its own Chrome build, so another Playwright's browsers are not used`,
    },
  ];
}

/** Everything found on this computer; `tools` are the usable ones (range/advisories come later). */
export async function detectSystemTools(
  deps: DetectDeps,
  catalog: ReadonlyMap<string, CatalogEntry>,
): Promise<{ detections: SystemDetection[]; tools: SystemToolchain[] }> {
  const detections: SystemDetection[] = [];
  const tools: SystemToolchain[] = [];
  for (const toolId of Object.keys(SPECS)) {
    if (!catalog.has(toolId)) continue;
    const found = await detectBinary(deps, toolId);
    detections.push(...found.detections);
    tools.push(...found.tools);
  }
  const fonts = catalog.get("open-fonts");
  if (fonts) {
    const found = await detectFonts(deps, fonts);
    detections.push(...found.detections);
    tools.push(...found.tools);
  }
  if (catalog.has("playwright")) detections.push(...detectPlaywrightCache(deps));
  return { detections, tools };
}

/** The real computer. */
export function realDetectDeps(
  os: ZenToolchainOs,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DetectDeps {
  return {
    os,
    env,
    isFile: (path) => {
      try {
        return NodeFS.statSync(path).isFile();
      } catch {
        return false;
      }
    },
    listDir: (path) => {
      try {
        return NodeFS.readdirSync(path);
      } catch {
        return [];
      }
    },
    realPath: (path) => NodeFS.realpathSync(path),
    run: (command, args) =>
      new Promise((resolve) => {
        try {
          NodeChildProcess.execFile(
            command,
            args as string[],
            { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            (error, stdout, stderr) => resolve(error ? null : `${String(stdout)}${String(stderr)}`),
          );
        } catch {
          resolve(null);
        }
      }),
  };
}
