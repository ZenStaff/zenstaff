// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off extendsNativeError:off - plain async code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: installs one toolchain from its recipe. Downloads are verified by sha256 before
// unpacking, npm runs `ci --ignore-scripts` from a shipped lockfile, pip is wheels-only with hashes.
// Nothing global changes; a folder counts as installed only once its marker is written.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeZlib from "node:zlib";

import type {
  ZenRecipeStep,
  ZenToolRecipe,
  ZenToolchainOs,
} from "@t3tools/contracts/zenToolchains";
import * as Yauzl from "yauzl";

import type { CatalogEntry } from "./catalog.ts";
import type { InstalledToolchainRef } from "./evaluate.ts";
import { jobText, type ZenToolchainLocale } from "./messages.ts";
import { downloadSources, type DownloadSource, type MirrorTarget } from "./mirror.ts";

export const MARKER_FILE = ".zen-toolchain.json";

export interface ToolchainMarker {
  readonly toolId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly recipeStatus: "tested" | "untested";
  readonly installedAt: string;
  readonly sizeBytes: number;
  /** name -> absolute file. */
  readonly bins: Record<string, string>;
  /** name -> absolute argv prefix (a script bin runs through its runtime). */
  readonly commands: Record<string, string[]>;
  readonly env: Record<string, string>;
}

export interface ProgressUpdate {
  readonly state: "downloading" | "installing" | "verifying";
  readonly bytes?: number;
  readonly totalBytes?: number;
  readonly message?: string;
}

export interface RunResult {
  readonly code: number;
  readonly output: string;
}

export type ProcessRunner = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env: Record<string, string>;
    readonly signal: AbortSignal;
    readonly timeoutMs?: number;
  },
) => Promise<RunResult>;

export interface InstallContext {
  readonly root: string;
  readonly cacheDir: string;
  readonly catalogDir: string;
  readonly os: ZenToolchainOs;
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
  readonly run: ProcessRunner;
  readonly onProgress: (update: ProgressUpdate) => void;
  /** An installed toolchain this one depends on (node for npm, uv and python for pip). */
  readonly dependency: (toolId: string) => InstalledToolchainRef | null;
  /** Mirror bases tried before the official URL (mirror.ts); absent or empty = official only. */
  readonly mirrors?: ReadonlyArray<string>;
  /** Language of the progress sentences (default English). */
  readonly locale?: ZenToolchainLocale;
}

class InstallError extends Error {}

/** Spawns a process with a clean, explicit environment; aborting kills it. */
export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new InstallError("Cancelled."));
      return;
    }
    let output = "";
    const child = NodeChildProcess.spawn(command, args as string[], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-16_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const onAbort = () => child.kill("SIGKILL");
    options.signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      options.timeoutMs === undefined
        ? null
        : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.on("error", (error) => {
      options.signal.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      reject(new InstallError(`Could not start ${NodePath.basename(command)}: ${error.message}`));
    });
    child.on("close", (code) => {
      options.signal.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      if (options.signal.aborted) reject(new InstallError("Cancelled."));
      else resolve({ code: code ?? 1, output });
    });
  });

/** A minimal environment for package managers: system PATH plus the given folders first. */
function toolEnv(
  os: ZenToolchainOs,
  pathFirst: ReadonlyArray<string>,
  extra: Record<string, string>,
): Record<string, string> {
  const keep = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "LANG",
    "LC_ALL",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
  ];
  const env: Record<string, string> = {};
  for (const name of keep) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const pathKey = os === "windows" && env.Path !== undefined ? "Path" : "PATH";
  env[pathKey] = [...pathFirst, env[pathKey] ?? ""].filter(Boolean).join(NodePath.delimiter);
  return { ...env, ...extra };
}

async function sha256File(file: string): Promise<string> {
  const hash = NodeCrypto.createHash("sha256");
  await NodeStreamPromises.pipeline(NodeFS.createReadStream(file), hash);
  return hash.digest("hex");
}

/** Downloads into the cache (by sha256) unless a verified copy is there; returns its path. */
async function fetchVerified(
  context: InstallContext,
  step: Extract<ZenRecipeStep, { type: "download" }>,
  target: MirrorTarget | null = null,
): Promise<string> {
  await NodeFS.promises.mkdir(context.cacheDir, { recursive: true });
  const cached = NodePath.join(context.cacheDir, step.sha256);
  if (NodeFS.existsSync(cached)) {
    if ((await sha256File(cached)) === step.sha256) {
      context.onProgress({
        state: "downloading",
        bytes: step.size,
        totalBytes: step.size,
        message: jobText(context.locale).savedDownload,
      });
      return cached;
    }
    await NodeFS.promises.rm(cached, { force: true });
  }
  const sources = downloadSources(context.mirrors ?? [], target, step);
  const failures: string[] = [];
  for (const [index, source] of sources.entries()) {
    if (context.signal.aborted) throw new InstallError("Cancelled.");
    const last = index === sources.length - 1;
    try {
      await fetchFrom(context, step, source, cached);
      return cached;
    } catch (error) {
      if (context.signal.aborted) throw new InstallError("Cancelled.");
      const message = String((error as Error)?.message ?? error);
      failures.push(message);
      if (!last) {
        context.onProgress({
          state: "downloading",
          bytes: 0,
          totalBytes: step.size,
          message: jobText(context.locale).retryFrom(
            source.mirror ? jobText(context.locale).theMirror : source.host,
            sources[index + 1]!.host,
          ),
        });
      }
    }
  }
  throw new InstallError(failures.length === 1 ? failures[0]! : failures.join(" "));
}

/** One attempt from one source; the bytes must hash to the catalog's sha256. */
async function fetchFrom(
  context: InstallContext,
  step: Extract<ZenRecipeStep, { type: "download" }>,
  source: DownloadSource,
  cached: string,
): Promise<void> {
  const partial = `${cached}.part-${process.pid}-${NodeCrypto.randomBytes(4).toString("hex")}`;
  const from = jobText(context.locale).downloadingFrom(source.host, source.mirror);
  try {
    context.onProgress({
      state: "downloading",
      bytes: 0,
      totalBytes: step.size,
      message: from,
    });
    const response = await context.fetch(source.url, {
      signal: context.signal,
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw new InstallError(`The download failed (${response.status}) from ${source.host}.`);
    }
    const total = Number(response.headers.get("content-length")) || step.size;
    const hash = NodeCrypto.createHash("sha256");
    const out = NodeFS.createWriteStream(partial);
    let bytes = 0;
    let lastReport = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      bytes += value.byteLength;
      if (!out.write(value))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      if (bytes - lastReport > 512 * 1024 || bytes === total) {
        lastReport = bytes;
        context.onProgress({
          state: "downloading",
          bytes,
          totalBytes: total,
          message: from,
        });
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
    const digest = hash.digest("hex");
    if (digest !== step.sha256) {
      throw new InstallError(
        `The file from ${source.host} does not match its checksum, so it was thrown away (expected ${step.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…).`,
      );
    }
    await NodeFS.promises.rename(partial, cached);
  } catch (error) {
    await NodeFS.promises.rm(partial, { force: true });
    if (context.signal.aborted) throw new InstallError("Cancelled.");
    throw error instanceof InstallError
      ? error
      : new InstallError(
          `The download from ${source.host} failed: ${String((error as Error)?.message ?? error)}`,
        );
  }
}

function unzip(archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Yauzl.open(
      archive,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: false },
      (error, zip) => {
        if (error || !zip) {
          reject(new InstallError("The archive could not be opened."));
          return;
        }
        zip.on("error", (cause: Error) =>
          reject(new InstallError(`The archive is damaged: ${cause.message}`)),
        );
        zip.on("end", () => resolve());
        zip.on("entry", (entry: Yauzl.Entry) => {
          const name = entry.fileName.replace(/\\/g, "/");
          const target = NodePath.resolve(into, name);
          if (!target.startsWith(NodePath.resolve(into) + NodePath.sep)) {
            reject(new InstallError(`The archive has an unsafe path: ${name}`));
            zip.close();
            return;
          }
          if (name.endsWith("/")) {
            NodeFS.mkdirSync(target, { recursive: true });
            zip.readEntry();
            return;
          }
          NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              reject(new InstallError("The archive could not be read."));
              return;
            }
            const mode = (entry.externalFileAttributes >>> 16) & 0o777;
            NodeStreamPromises.pipeline(
              stream,
              NodeFS.createWriteStream(target, { mode: mode || 0o644 }),
            )
              .then(() => zip.readEntry())
              .catch((cause: Error) => reject(new InstallError(cause.message)));
          });
        });
        zip.readEntry();
      },
    );
  });
}

/** Moves the unpacked content into place, after stripComponents, keeping only `files` if set. */
async function placeUnpacked(
  staging: string,
  target: string,
  strip: number,
  files: ReadonlyArray<string> | undefined,
): Promise<void> {
  // Folders at depth `strip` become the new roots.
  let roots = [staging];
  for (let level = 0; level < strip; level++) {
    const next: string[] = [];
    for (const root of roots) {
      for (const child of await NodeFS.promises.readdir(root, { withFileTypes: true })) {
        if (child.isDirectory()) next.push(NodePath.join(root, child.name));
      }
    }
    roots = next;
  }
  await NodeFS.promises.mkdir(target, { recursive: true });
  for (const root of roots) {
    if (files) {
      for (const file of files) {
        const from = NodePath.join(root, file);
        if (!NodeFS.existsSync(from)) continue;
        const to = NodePath.join(target, file);
        await NodeFS.promises.mkdir(NodePath.dirname(to), { recursive: true });
        await NodeFS.promises.rename(from, to);
      }
    } else {
      for (const child of await NodeFS.promises.readdir(root)) {
        await NodeFS.promises.rename(NodePath.join(root, child), NodePath.join(target, child));
      }
    }
  }
  for (const file of files ?? []) {
    if (!NodeFS.existsSync(NodePath.join(target, file))) {
      throw new InstallError(`The archive did not contain ${file}.`);
    }
  }
}

async function runDownload(
  context: InstallContext,
  step: Extract<ZenRecipeStep, { type: "download" }>,
  dir: string,
  target: MirrorTarget | null,
): Promise<void> {
  const file = await fetchVerified(context, step, target);
  context.onProgress({ state: "installing", message: jobText(context.locale).unpacking });
  const archive = step.archive ?? "none";
  if (archive === "none" || archive === "gz") {
    const dest = NodePath.join(dir, step.dest!);
    await NodeFS.promises.mkdir(NodePath.dirname(dest), { recursive: true });
    if (archive === "gz") {
      await NodeStreamPromises.pipeline(
        NodeFS.createReadStream(file),
        NodeZlib.createGunzip(),
        NodeFS.createWriteStream(dest),
      );
    } else {
      await NodeFS.promises.copyFile(file, dest);
    }
    if (step.executable && context.os !== "windows") await NodeFS.promises.chmod(dest, 0o755);
    return;
  }
  const staging = NodePath.join(dir, `.unpack-${NodeCrypto.randomBytes(4).toString("hex")}`);
  await NodeFS.promises.mkdir(staging, { recursive: true });
  try {
    if (archive === "zip") {
      await unzip(file, staging);
    } else {
      const result = await context.run("tar", ["-xf", file, "-C", staging], {
        cwd: dir,
        env: toolEnv(context.os, [], {}),
        signal: context.signal,
      });
      if (result.code !== 0)
        throw new InstallError(`Unpacking failed: ${result.output.slice(-400)}`);
    }
    await placeUnpacked(
      staging,
      step.dest ? NodePath.join(dir, step.dest) : dir,
      step.stripComponents ?? 0,
      step.files,
    );
  } finally {
    await NodeFS.promises.rm(staging, { recursive: true, force: true });
  }
}

function need(context: InstallContext, toolId: string, bin: string): string {
  const dependency = context.dependency(toolId);
  const path = dependency?.bins[bin];
  if (!path) throw new InstallError(`${toolId} must be installed first.`);
  return path;
}

async function checked(result: Promise<RunResult>, what: string): Promise<string> {
  const { code, output } = await result;
  if (code !== 0) throw new InstallError(`${what} failed:\n${output.slice(-1200)}`);
  return output;
}

async function runStep(
  context: InstallContext,
  step: ZenRecipeStep,
  dir: string,
  target: MirrorTarget | null = null,
): Promise<void> {
  const cache = (name: string) => NodePath.join(context.cacheDir, name);
  switch (step.type) {
    case "download":
      return runDownload(context, step, dir, target);
    case "npm": {
      const node = need(context, "node", "node");
      const npm = need(context, "node", "npm");
      const source = NodePath.join(context.catalogDir, step.lockfileDir);
      for (const file of ["package.json", "package-lock.json"]) {
        await NodeFS.promises.copyFile(NodePath.join(source, file), NodePath.join(dir, file));
      }
      context.onProgress({
        state: "installing",
        message: jobText(context.locale).npm,
      });
      await checked(
        context.run(
          node,
          [
            npm,
            "ci",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--omit=dev",
            "--no-update-notifier",
          ],
          {
            cwd: dir,
            env: toolEnv(context.os, [NodePath.dirname(node)], {
              npm_config_cache: cache("npm"),
              npm_config_userconfig: NodePath.join(dir, ".npmrc-none"),
            }),
            signal: context.signal,
            timeoutMs: 15 * 60_000,
          },
        ),
        "npm ci",
      );
      return;
    }
    case "remotionBrowser": {
      const node = need(context, "node", "node");
      context.onProgress({
        state: "installing",
        message: jobText(context.locale).browser,
      });
      await checked(
        context.run(
          node,
          [
            NodePath.join(dir, "node_modules", "@remotion", "cli", "remotion-cli.js"),
            "browser",
            "ensure",
          ],
          {
            cwd: dir,
            env: toolEnv(context.os, [NodePath.dirname(node)], {}),
            signal: context.signal,
            timeoutMs: 15 * 60_000,
          },
        ),
        "remotion browser ensure",
      );
      return;
    }
    case "uvPython": {
      const uv = need(context, "uv", "uv");
      context.onProgress({
        state: "installing",
        message: `${jobText(context.locale).pythonRuntime} ${step.python}`,
      });
      await checked(
        context.run(
          uv,
          [
            "python",
            "install",
            step.python,
            "--install-dir",
            NodePath.join(dir, "python"),
            "--no-config",
          ],
          {
            cwd: dir,
            env: toolEnv(context.os, [], {
              UV_PYTHON_BIN_DIR: NodePath.join(dir, "bin"),
              UV_CACHE_DIR: cache("uv"),
              UV_PYTHON_INSTALL_REGISTRY: "0",
              UV_NO_MODIFY_PATH: "1",
            }),
            signal: context.signal,
            timeoutMs: 15 * 60_000,
          },
        ),
        "uv python install",
      );
      return;
    }
    case "venv": {
      const uv = need(context, "uv", "uv");
      const python = need(context, step.pythonTool, "python");
      context.onProgress({ state: "installing", message: jobText(context.locale).pythonEnv });
      await checked(
        context.run(
          uv,
          ["venv", NodePath.join(dir, "venv"), "--python", python, "--no-project", "--no-config"],
          {
            cwd: dir,
            env: toolEnv(context.os, [], {
              UV_PYTHON_DOWNLOADS: "never",
              UV_CACHE_DIR: cache("uv"),
            }),
            signal: context.signal,
          },
        ),
        "uv venv",
      );
      return;
    }
    case "pip": {
      const uv = need(context, "uv", "uv");
      const venvPython =
        context.os === "windows"
          ? NodePath.join(dir, "venv", "Scripts", "python.exe")
          : NodePath.join(dir, "venv", "bin", "python");
      context.onProgress({
        state: "installing",
        message: jobText(context.locale).pip,
      });
      await checked(
        context.run(
          uv,
          [
            "pip",
            "install",
            "--python",
            venvPython,
            "--require-hashes",
            "--only-binary",
            ":all:",
            "--no-config",
            "-r",
            NodePath.join(context.catalogDir, step.requirements),
          ],
          {
            cwd: dir,
            env: toolEnv(context.os, [], {
              UV_CACHE_DIR: cache("uv"),
              UV_PYTHON_DOWNLOADS: "never",
            }),
            signal: context.signal,
            timeoutMs: 20 * 60_000,
          },
        ),
        "uv pip install",
      );
      return;
    }
  }
}

/** Bytes on disk under a folder (symlinks counted as links). */
async function folderSize(dir: string): Promise<number> {
  let total = 0;
  const walk = async (current: string) => {
    let entries: NodeFS.Dirent[];
    try {
      entries = await NodeFS.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = NodePath.join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        try {
          total += (await NodeFS.promises.lstat(path)).size;
        } catch {
          // gone
        }
      }
    }
  };
  await walk(dir);
  return total;
}

/** The argv prefix for a bin: scripts run through the node toolchain. */
function commandFor(binPath: string, node: string | null): string[] {
  return /\.(c|m)?js$/.test(binPath) && node ? [node, binPath] : [binPath];
}

/** Runs the catalog's verify command (or, for models, checks the files are there). */
export async function verifyToolchain(
  entry: CatalogEntry,
  marker: Pick<ToolchainMarker, "commands" | "bins">,
  dir: string,
  run: ProcessRunner,
  signal: AbortSignal,
  os: ZenToolchainOs,
): Promise<{ readonly ok: boolean; readonly output: string }> {
  if (entry.verify.bin === "") {
    const recipe = entry.versions.flatMap((version) => version.recipes)[0];
    // A library without a command (models, fonts, npm packages such as pptxgenjs): its downloaded
    // files, and for an npm step every top-level dependency of the shipped package.json, must exist.
    const npmDependencies = (step: ZenRecipeStep): ReadonlyArray<string> => {
      if (step.type !== "npm") return [];
      try {
        const manifest = JSON.parse(
          NodeFS.readFileSync(NodePath.join(dir, "package.json"), "utf8"),
        ) as { dependencies?: Record<string, string> };
        return Object.keys(manifest.dependencies ?? {}).map((name) =>
          NodePath.join("node_modules", name, "package.json"),
        );
      } catch {
        return ["package.json"];
      }
    };
    const files = (recipe?.steps ?? []).flatMap((step) =>
      step.type === "download" && step.dest ? [step.dest] : npmDependencies(step),
    );
    const missing = files.filter((file) => !NodeFS.existsSync(NodePath.join(dir, file)));
    return missing.length === 0
      ? { ok: true, output: `${files.length} files present` }
      : { ok: false, output: `missing: ${missing.join(", ")}` };
  }
  const command = marker.commands[entry.verify.bin];
  if (!command) return { ok: false, output: `no command ${entry.verify.bin}` };
  try {
    const result = await run(command[0]!, [...command.slice(1), ...entry.verify.args], {
      cwd: dir,
      env: toolEnv(os, [], {}),
      signal,
      timeoutMs: 60_000,
    });
    const output = result.output.trim().slice(0, 2000);
    const ok = result.code === 0 && new RegExp(entry.verify.expect, "m").test(output);
    return { ok, output };
  } catch (error) {
    return { ok: false, output: String((error as Error).message ?? error) };
  }
}

/** Installs one toolchain; returns its marker. The folder is removed on failure or cancel. */
export async function installToolchain(
  context: InstallContext,
  entry: CatalogEntry,
  version: string,
  recipe: ZenToolRecipe,
): Promise<ToolchainMarker> {
  const dir = NodePath.join(context.root, entry.id, version);
  await NodeFS.promises.rm(dir, { recursive: true, force: true });
  await NodeFS.promises.mkdir(dir, { recursive: true });
  try {
    for (const step of recipe.steps) {
      if (context.signal.aborted) throw new InstallError("Cancelled.");
      await runStep(context, step, dir, {
        toolId: entry.id,
        version,
        os: recipe.os,
        arch: recipe.arch,
      });
    }
    const node =
      context.dependency("node")?.bins.node ??
      (entry.id === "node" ? NodePath.join(dir, recipe.bin.node ?? "") : null);
    const bins: Record<string, string> = {};
    const commands: Record<string, string[]> = {};
    for (const [name, relative] of Object.entries(recipe.bin)) {
      const absolute = NodePath.join(dir, relative);
      if (!NodeFS.existsSync(absolute))
        throw new InstallError(`${entry.name} did not install ${relative}.`);
      if (context.os !== "windows" && !/\.(c|m)?js$/.test(absolute)) {
        await NodeFS.promises.chmod(absolute, 0o755).catch(() => undefined);
      }
      bins[name] = absolute;
      commands[name] = commandFor(absolute, node);
    }
    const env = Object.fromEntries(
      Object.entries(recipe.env ?? {}).map(([name, value]) => [
        name,
        value.replaceAll("${dir}", dir),
      ]),
    );
    context.onProgress({ state: "verifying", message: jobText(context.locale).checking });
    const verified = await verifyToolchain(
      entry,
      { bins, commands },
      dir,
      context.run,
      context.signal,
      context.os,
    );
    if (!verified.ok) {
      throw new InstallError(
        `${entry.name} was installed but does not start: ${verified.output.slice(-600)}`,
      );
    }
    const marker: ToolchainMarker = {
      toolId: entry.id,
      version,
      os: recipe.os,
      arch: recipe.arch,
      recipeStatus: recipe.status,
      installedAt: new Date().toISOString(),
      sizeBytes: await folderSize(dir),
      bins,
      commands,
      env,
    };
    await NodeFS.promises.writeFile(
      NodePath.join(dir, MARKER_FILE),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
    return marker;
  } catch (error) {
    await NodeFS.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
