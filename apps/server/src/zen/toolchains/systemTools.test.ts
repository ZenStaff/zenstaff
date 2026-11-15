// @effect-diagnostics nodeBuiltinImport:off globalDate:off - tests of the plain async toolchain core.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  ZenMachineProbe,
  ZenToolCatalogEntry,
  ZenToolchainOs,
} from "@t3tools/contracts/zenToolchains";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { mergeBlockLists } from "./advisories.ts";
import { parseCatalogEntry } from "./catalog.ts";
import { evaluateWorkflow } from "./evaluate.ts";
import { ToolchainManager } from "./manager.ts";
import {
  FFMPEG_NEEDS,
  detectSystemTools,
  ffmpegNames,
  fontFamilies,
  parsePyLauncher,
  type DetectDeps,
  type SystemToolchain,
} from "./systemTools.ts";

const catalogDir = NodePath.join(import.meta.dirname, "catalog");

function shippedCatalog(): Map<string, ZenToolCatalogEntry> {
  const map = new Map<string, ZenToolCatalogEntry>();
  for (const name of NodeFS.readdirSync(NodePath.join(catalogDir, "tools"))) {
    const parsed = parseCatalogEntry(
      NodeFS.readFileSync(NodePath.join(catalogDir, "tools", name), "utf8"),
    );
    if ("error" in parsed) throw new Error(`${name}: ${parsed.error}`);
    map.set(parsed.entry.id, parsed.entry);
  }
  return map;
}

const ENCODERS = (names: ReadonlyArray<string>) =>
  [
    "Encoders:",
    " V..... = Video",
    " ------",
    ...names.map((name) => ` V....D ${name}             some encoder`),
  ].join("\n");
const FILTERS = (names: ReadonlyArray<string>) =>
  ["Filters:", ...names.map((name) => ` TSC ${name}            A->A       some filter`)].join("\n");

interface FakeMachine {
  readonly os: ZenToolchainOs;
  readonly env: Record<string, string>;
  /** path -> output of each argv (joined by space), or null when it fails. */
  readonly programs: Record<string, Record<string, string | null>>;
  readonly dirs?: Record<string, string[]>;
  readonly files?: string[];
}

function fakeDeps(machine: FakeMachine): DetectDeps {
  const files = new Set([...Object.keys(machine.programs), ...(machine.files ?? [])]);
  return {
    os: machine.os,
    env: machine.env,
    isFile: (path) => files.has(path),
    listDir: (path) => machine.dirs?.[path] ?? [],
    realPath: (path) => path,
    run: async (command, args) => {
      const program = machine.programs[command];
      if (!program) return null;
      const key = args.join(" ");
      return key in program ? program[key]! : null;
    },
  };
}

const goodFfmpeg = (version: string) => ({
  "-hide_banner -version": `ffmpeg version ${version} Copyright (c) 2000-2025 the FFmpeg developers`,
  "-hide_banner -encoders": ENCODERS(FFMPEG_NEEDS.encoders),
  "-hide_banner -filters": FILTERS(FFMPEG_NEEDS.filters),
});

describe("tools already on the computer", () => {
  const catalog = shippedCatalog();

  it("finds FFmpeg, Node and Python on Linux and reads their versions", async () => {
    const found = await detectSystemTools(
      fakeDeps({
        os: "linux",
        env: { PATH: "/usr/local/bin:/usr/bin", HOME: "/home/u" },
        programs: {
          "/usr/bin/ffmpeg": goodFfmpeg("9.1.2-1ubuntu1"),
          "/usr/bin/ffprobe": {},
          "/usr/local/bin/node": { "--version": "v24.11.0\n" },
          "/usr/bin/python3": { "--version": "Python 3.12.3\n" },
          "/home/u/.local/bin/uv": { "--version": "uv 0.13.7 (abc 2026-11-03)\n" },
          "/usr/bin/pandoc": { "--version": "pandoc 3.1.3\nFeatures: +server +lua" },
        },
        files: ["/usr/local/lib/node_modules/npm/bin/npm-cli.js"],
      }),
      catalog,
    );
    const usable = (id: string) => found.tools.find((tool) => tool.toolId === id);
    expect(usable("ffmpeg")).toMatchObject({
      version: "9.1.2",
      bins: { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" },
      source: "PATH",
      system: true,
    });
    expect(usable("node")?.commands.npm).toEqual([
      "/usr/local/bin/node",
      "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    ]);
    expect(usable("python")?.version).toBe("3.12.3");
    expect(usable("uv")).toMatchObject({ version: "0.13.7", source: "~/.local/bin" });
    expect(usable("pandoc")?.version).toBe("3.1.3");
  });

  it("refuses an FFmpeg without the codecs and filters the packs use", async () => {
    const found = await detectSystemTools(
      fakeDeps({
        os: "linux",
        env: { PATH: "/usr/bin" },
        programs: {
          "/usr/bin/ffmpeg": {
            ...goodFfmpeg("7.1"),
            "-hide_banner -encoders": ENCODERS(["aac", "pcm_s16le"]),
            "-hide_banner -filters": FILTERS(
              FFMPEG_NEEDS.filters.filter((name) => name !== "drawtext"),
            ),
          },
          "/usr/bin/ffprobe": {},
        },
      }),
      catalog,
    );
    expect(found.tools.filter((tool) => tool.toolId === "ffmpeg")).toEqual([]);
    expect(found.detections.find((d) => d.toolId === "ffmpeg")).toMatchObject({
      accepted: false,
      reason: "missing libx264, drawtext",
    });
  });

  it("refuses a development FFmpeg build whose version cannot be checked", async () => {
    const found = await detectSystemTools(
      fakeDeps({
        os: "linux",
        env: { PATH: "/usr/bin" },
        programs: {
          "/usr/bin/ffmpeg": {
            ...goodFfmpeg("x"),
            "-hide_banner -version": "ffmpeg version N-128560-g967f0ffb10 Copyright",
          },
          "/usr/bin/ffprobe": {},
        },
      }),
      catalog,
    );
    expect(found.detections[0]).toMatchObject({ accepted: false, version: null });
  });

  it("looks in winget, Program Files and the py launcher on Windows", async () => {
    const local = "C:\\Users\\alex\\AppData\\Local";
    const winget = `${local}\\Microsoft\\WinGet\\Packages`;
    const gyan = `${winget}\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe`;
    const build = `${gyan}\\ffmpeg-7.1.1-full_build`;
    const found = await detectSystemTools(
      fakeDeps({
        os: "windows",
        env: {
          Path: "C:\\Windows\\system32;C:\\Users\\alex\\AppData\\Local\\Microsoft\\WindowsApps",
          LOCALAPPDATA: local,
          USERPROFILE: "C:\\Users\\alex",
          ProgramFiles: "C:\\Program Files",
          WINDIR: "C:\\Windows",
        },
        dirs: {
          [winget]: ["Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"],
          [gyan]: ["ffmpeg-7.1.1-full_build"],
          "C:\\Windows\\Fonts": ["arial.ttf", "Barlow-Regular.ttf"],
        },
        programs: {
          [`${build}\\bin\\ffmpeg.exe`]: goodFfmpeg("7.1.1-full_build-www.gyan.dev"),
          [`${build}\\bin\\ffprobe.exe`]: {},
          "C:\\Program Files\\nodejs\\node.exe": { "--version": "v24.9.0" },
          // The Store stub on PATH must be skipped.
          "C:\\Users\\alex\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe": {
            "--version": "Python 3.12.0",
          },
          py: {
            "-0p":
              " -V:3.12 *        C:\\Python312\\python.exe\n -V:3.11          C:\\Python311\\python.exe\n",
          },
          "C:\\Python312\\python.exe": { "--version": "Python 3.12.7" },
          "C:\\Python311\\python.exe": { "--version": "Python 3.11.9" },
        },
        files: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
      }),
      catalog,
    );
    const ffmpeg = found.tools.find((tool) => tool.toolId === "ffmpeg");
    expect(ffmpeg).toMatchObject({ version: "7.1.1", source: "winget" });
    expect(ffmpeg?.bins.ffprobe).toBe(`${build}\\bin\\ffprobe.exe`);
    expect(found.tools.find((tool) => tool.toolId === "node")).toMatchObject({
      version: "24.9.0",
      source: "Program Files",
    });
    const pythons = found.tools.filter((tool) => tool.toolId === "python");
    expect(pythons.map((tool) => [tool.version, tool.source])).toEqual([
      ["3.12.7", "py launcher"],
      ["3.11.9", "py launcher"],
    ]);
    // Only one of the families is there.
    expect(found.tools.some((tool) => tool.toolId === "open-fonts")).toBe(false);
    expect(found.detections.find((d) => d.toolId === "open-fonts")?.reason).toMatch(
      /^missing families: barlowcondensed/,
    );
  });

  it("uses Homebrew on macOS and system fonts when every family is in one folder", async () => {
    const fonts = catalog.get("open-fonts")!;
    const families = fontFamilies(fonts, "2026.11.08+86aced9");
    expect(families).toEqual(expect.arrayContaining(["barlow", "barlowcondensed", "sourcesans3"]));
    const listing = families
      .map((family) => `${family}\t/Users/a/Library/Fonts/${family}.ttf`)
      .join("\n");
    const found = await detectSystemTools(
      fakeDeps({
        os: "macos",
        env: { PATH: "/usr/bin:/bin", HOME: "/Users/a" },
        programs: {
          "/opt/homebrew/bin/ffmpeg": goodFfmpeg("8.0"),
          "/opt/homebrew/bin/ffprobe": {},
          "/opt/homebrew/bin/yt-dlp": { "--version": "2026.10.26\n" },
          "fc-list": { "--format %{family}\\t%{file}\\n": listing },
        },
        dirs: { "/Users/a/Library/Caches/ms-playwright": ["chromium_headless_shell-1200"] },
      }),
      catalog,
    );
    expect(found.tools.find((tool) => tool.toolId === "ffmpeg")?.source).toBe("Homebrew");
    expect(found.tools.find((tool) => tool.toolId === "yt-dlp")?.version).toBe("2026.10.26");
    expect(found.tools.find((tool) => tool.toolId === "open-fonts")).toMatchObject({
      version: "2026.11.08+86aced9",
      env: { ZEN_FONTS_DIR: "/Users/a/Library/Fonts" },
    });
    expect(found.detections.find((d) => d.toolId === "playwright")).toMatchObject({
      accepted: false,
    });
  });

  it("parses the py launcher and ffmpeg listings", () => {
    expect(
      parsePyLauncher(" -V:3.13          C:\\Py\\python.exe\r\n -V:3.12 * D:\\x y\\python.exe"),
    ).toEqual(["C:\\Py\\python.exe", "D:\\x y\\python.exe"]);
    expect([...ffmpegNames(" V....D libx264  H.264\n A..... aac   AAC\n ------")]).toEqual([
      "libx264",
      "aac",
    ]);
  });
});

describe("evaluation with tools already on the computer", () => {
  const tools = shippedCatalog();
  const probe: ZenMachineProbe = {
    probedAt: "2026-11-08T00:00:00.000Z",
    durationMs: 1,
    os: "linux",
    arch: "x64",
    osVersion: "6.8",
    hostname: "laptop",
    cpuModel: "cpu",
    cpuCores: 8,
    totalRamGb: 16,
    freeRamGb: 8,
    zenHome: "/h/.zen",
    installDir: "/h/.zen/toolchains",
    installDirWritable: true,
    freeDiskGb: 100,
    gpus: [],
    toolsOnPath: {},
    network: [],
    sandbox: "none",
    companyRunner: false,
  };
  const system = (toolId: string, version: string): SystemToolchain => ({
    toolId,
    version,
    dir: "/usr/bin",
    bins: { [toolId]: `/usr/bin/${toolId}` },
    commands: { [toolId]: [`/usr/bin/${toolId}`] },
    env: {},
    system: true,
    source: "apt",
  });
  const evaluate = (requirement: { id: string; version?: string }, found: SystemToolchain[]) =>
    evaluateWorkflow({
      workflowId: "w",
      requires: { tools: [requirement] },
      tools,
      connectors: new Map(),
      configuredConnectors: new Set(),
      probe,
      installed: [],
      blockList: mergeBlockLists(tools.values(), [
        {
          version: 1,
          generatedAt: "2026-11-08",
          source: "t",
          tools: { ffmpeg: { minSafeVersion: "9", blockedVersions: [] } },
        },
      ]),
      system: found,
      locale: "ro",
    });

  it("uses a fitting system tool instead of downloading", () => {
    const result = evaluate({ id: "pandoc", version: ">=3" }, [system("pandoc", "3.1.3")]);
    expect(result.plan).toEqual([]);
    expect(result.compatibility.status).toBe("ready");
    expect(result.uses).toEqual([
      { toolId: "pandoc", version: "3.1.3", optional: false, system: true },
    ]);
    expect(result.compatibility.tools[0]).toMatchObject({
      system: true,
      systemSource: "apt",
      dir: "/usr/bin",
    });
  });

  it("downloads when the version is out of range or blocked by advisories", () => {
    const old = evaluate({ id: "node", version: "^24" }, [system("node", "22.23.4")]);
    expect(old.plan.map((item) => item.entry.id)).toEqual(["node"]);
    const unsafe = evaluate({ id: "ffmpeg" }, [system("ffmpeg", "6.1.1")]);
    expect(unsafe.plan.map((item) => item.entry.id)).toEqual(["ffmpeg"]);
    expect(unsafe.compatibility.tools[0]?.system).toBeUndefined();
  });
});

describe("manager with tools already on the computer", () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const dir of temporary.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  const setup = () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-sys-"));
    temporary.push(root);
    const assets = NodePath.join(root, "assets");
    const workflow = NodePath.join(assets, "builtin", "doc-flow");
    NodeFS.mkdirSync(workflow, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(workflow, "workflow.json"),
      JSON.stringify({
        id: "doc-flow",
        name: "Doc flow",
        requires: { tools: [{ id: "pandoc", version: ">=3" }] },
      }),
    );
    const pandoc = NodePath.join(root, "sys", "pandoc");
    NodeFS.mkdirSync(NodePath.dirname(pandoc), { recursive: true });
    NodeFS.writeFileSync(pandoc, "#!/bin/sh\necho pandoc 3.1.3\n", { mode: 0o755 });
    const work = NodePath.join(root, "work");
    NodeFS.mkdirSync(work);
    const manager = new ToolchainManager({
      zenHome: NodePath.join(root, "home"),
      platform: "linux",
      arch: "x64",
      catalogDir,
      workflowsAssetsDir: assets,
      env: { ZEN_TOOLS_MIRROR: "off" },
      fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
      probeImpl: async () => ({
        probedAt: "2026-11-08T00:00:00.000Z",
        durationMs: 1,
        os: "linux",
        arch: "x64",
        osVersion: "6.8",
        hostname: "laptop",
        cpuModel: "cpu",
        cpuCores: 8,
        totalRamGb: 16,
        freeRamGb: 8,
        zenHome: NodePath.join(root, "home"),
        installDir: NodePath.join(root, "home", "toolchains"),
        installDirWritable: true,
        freeDiskGb: 100,
        gpus: [],
        toolsOnPath: {},
        network: [],
        sandbox: "none",
        companyRunner: false,
      }),
      detectSystem: async () => ({
        detections: [
          {
            toolId: "pandoc",
            path: pandoc,
            version: "3.1.3",
            source: "PATH",
            accepted: true,
            reason: null,
          },
        ],
        tools: [
          {
            toolId: "pandoc",
            version: "3.1.3",
            dir: NodePath.dirname(pandoc),
            bins: { pandoc },
            commands: { pandoc: [pandoc] },
            env: {},
            system: true,
            source: "PATH",
          },
        ],
      }),
    });
    return { manager, work, pandoc };
  };

  it("points the thread launcher at the system binary, and honours the settings", async () => {
    const { manager, work, pandoc } = setup();
    await manager.init();
    const check = await manager.checkWorkflow({ workflowId: "doc-flow", locale: "ro" });
    expect(check.status).toBe("ready");
    expect(check.tools[0]).toMatchObject({ system: true, version: "3.1.3" });
    const prepared = await manager.prepareThread({
      workflowId: "doc-flow",
      threadId: "t-sys",
      cwd: work,
    });
    const shim = NodeFS.readFileSync(prepared.env.ZEN_TOOL_PANDOC!, "utf8");
    expect(shim).toContain(pandoc);
    const overview = await manager.overview();
    expect(overview.systemTools).toEqual([
      expect.objectContaining({ toolId: "pandoc", usable: true, path: pandoc }),
    ]);

    // "Use the Zen version" for this tool, then the switch off, then a company that wants pins.
    await manager.setSettings({ ...overview.settings, pinnedTools: ["pandoc"] });
    expect((await manager.checkWorkflow({ workflowId: "doc-flow" })).status).toBe("needs-install");
    await manager.setSettings({ ...overview.settings, useSystemTools: false });
    expect((await manager.checkWorkflow({ workflowId: "doc-flow" })).status).toBe("needs-install");
    await manager.setSettings({ ...overview.settings, companyPinned: true });
    expect((await manager.checkWorkflow({ workflowId: "doc-flow" })).status).toBe("ready");
    expect(
      (await manager.checkWorkflow({ workflowId: "doc-flow", companyId: "acme" })).status,
    ).toBe("needs-install");
    await expect(
      manager.setSettings({ ...overview.settings, pinnedTools: ["not-a-tool"] }),
    ).rejects.toThrow(/Unknown tool/);
  });

  it("names the install steps in Romanian", async () => {
    const { manager } = setup();
    await manager.init();
    await manager.setSettings({ ...(await manager.overview()).settings, useSystemTools: false });
    const job = await manager.install({ workflowId: "doc-flow", locale: "ro" });
    expect(job.steps[0]?.name).toBe("Pandoc");
    expect(job.message).toBe("Așteaptă să înceapă");
  });
});
