// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - tests of the plain async toolchain core.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  ZenAdvisoryFile,
  ZenMachineProbe,
  ZenToolCatalogEntry,
  ZenWorkflowRequires,
} from "@t3tools/contracts/zenToolchains";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { blockReason, mergeBlockLists } from "./advisories.ts";
import { isSafeRelativePath, parseCatalogEntry, validateCatalogEntry } from "./catalog.ts";
import { evaluateWorkflow, toolchainReferences, type InstalledToolchainRef } from "./evaluate.ts";
import { verifyToolchain } from "./installer.ts";
import { setZenHubBridge } from "../hub/hubBridge.ts";
import { isAdvisoriesUrl, ToolchainManager, toolEnvName } from "./manager.ts";
import {
  buildAdvisoryFile,
  buildOsvQueries,
  lockfilePackages,
  parseOsvBatch,
  parseOsvVuln,
  requirementsPackages,
} from "./osvScanner.ts";
import {
  parseMemAvailableGb,
  parseNvidiaSmiCudaVersion,
  parseNvidiaSmiQuery,
  parseSystemProfilerDisplays,
  parseWindowsVideoControllers,
} from "./probe.ts";
import { bwrapArgs, seatbeltProfile, shimFiles, workflowPermissionRules } from "./sandbox.ts";
import {
  setZenToolchainThreadResolver,
  withZenToolchainEnv,
  withZenToolchainSettings,
} from "./threadEnv.ts";
import { compareVersions, isValidRange, satisfiesRange } from "./versions.ts";
import { parseRequires } from "./workflowRequirements.ts";

const here = import.meta.dirname;
const catalogDir = NodePath.join(here, "catalog");
const sha = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

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

const probe = (patch: Partial<ZenMachineProbe> = {}): ZenMachineProbe => ({
  probedAt: "2026-11-07T00:00:00.000Z",
  durationMs: 10,
  os: "linux",
  arch: "x64",
  osVersion: "6.8",
  hostname: "laptop",
  cpuModel: "Test CPU",
  cpuCores: 8,
  totalRamGb: 16,
  freeRamGb: 8,
  zenHome: "/home/u/.zen",
  installDir: "/home/u/.zen/toolchains",
  installDirWritable: true,
  freeDiskGb: 100,
  gpus: [],
  toolsOnPath: {},
  network: [],
  sandbox: "none",
  companyRunner: false,
  ...patch,
});

const installedRef = (toolId: string, version: string): InstalledToolchainRef => ({
  toolId,
  version,
  dir: `/t/${toolId}/${version}`,
  bins: {},
  commands: {},
  env: {},
});

const promoRequires = (): ZenWorkflowRequires => {
  const text = NodeFS.readFileSync(
    NodePath.join(here, "..", "workflows", "packs", "promo-video-30s", "workflow.json"),
    "utf8",
  );
  const parsed = parseRequires(text);
  if (!parsed.requires) throw new Error(parsed.problem ?? "no requires");
  return parsed.requires;
};

const baseInput = (
  requires: ZenWorkflowRequires | null,
  patch: Partial<Parameters<typeof evaluateWorkflow>[0]> = {},
) => {
  const tools = shippedCatalog();
  return {
    workflowId: "w",
    requires,
    tools,
    connectors: new Map([
      [
        "elevenlabs",
        {
          id: "elevenlabs",
          name: "ElevenLabs (voice-over)",
          description: "",
          envVar: "ELEVENLABS_API_KEY",
        },
      ],
    ]),
    configuredConnectors: new Set<string>(),
    probe: probe(),
    installed: [] as InstalledToolchainRef[],
    blockList: mergeBlockLists(tools.values(), []),
    ...patch,
  };
};

describe("versions", () => {
  it("compares dotted versions", () => {
    expect(compareVersions("8.1.3", "8.1.10")).toBe(-1);
    expect(compareVersions("2026.10.21", "2026.10.3")).toBe(1);
    expect(compareVersions("v24.22.1", "24.22.1")).toBe(0);
    expect(compareVersions("1.0.0+abc", "1.0.0")).toBe(0);
  });

  it("matches ranges", () => {
    expect(satisfiesRange("8.1.3", ">=6")).toBe(true);
    expect(satisfiesRange("6.1.1", ">=6 <8")).toBe(true);
    expect(satisfiesRange("8.1.3", ">=6 <8")).toBe(false);
    expect(satisfiesRange("4.0.538", "^4.0.500")).toBe(true);
    expect(satisfiesRange("4.0.499", "^4.0.500")).toBe(false);
    expect(satisfiesRange("5.0.0", "^4.0.500")).toBe(false);
    expect(satisfiesRange("3.12.15", "~3.12")).toBe(true);
    expect(satisfiesRange("3.13.0", "~3.12")).toBe(false);
    expect(satisfiesRange("1.2.9", "1.2.x || >=2")).toBe(true);
    expect(satisfiesRange("1.3.0", "1.2.x || >=2")).toBe(false);
    expect(satisfiesRange("0.13.5", "^0.13")).toBe(true);
    expect(satisfiesRange("0.14.0", "^0.13")).toBe(false);
    expect(satisfiesRange("1.0.0", undefined)).toBe(true);
    expect(isValidRange(">=6 <9")).toBe(true);
    expect(isValidRange("latest")).toBe(false);
  });
});

describe("catalog recipes", () => {
  it("verifies a library-only npm toolchain by its installed packages", async () => {
    const entry = shippedCatalog().get("pptxgenjs")!;
    expect(entry.kind).toBe("npm");
    expect(entry.license.commercialUse).toBe("free");
    const linux = entry.versions[0]!.recipes.find((r) => r.os === "linux" && r.arch === "x64")!;
    expect(linux.env?.ZEN_PPTXGENJS_MODULES).toBe("${dir}/node_modules");
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-verify-"));
    NodeFS.writeFileSync(
      NodePath.join(dir, "package.json"),
      JSON.stringify({ dependencies: { pptxgenjs: "4.0.1" } }),
    );
    const never = (() => {
      throw new Error("no command should run");
    }) as never;
    const signal = new AbortController().signal;
    const marker = { commands: {}, bins: {} };
    const missing = await verifyToolchain(entry, marker, dir, never, signal, "linux");
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("pptxgenjs");
    NodeFS.mkdirSync(NodePath.join(dir, "node_modules", "pptxgenjs"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, "node_modules", "pptxgenjs", "package.json"), "{}");
    const present = await verifyToolchain(entry, marker, dir, never, signal, "linux");
    expect(present.ok).toBe(true);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("ships a valid catalog where every recipe is pinned and declarative", () => {
    const tools = shippedCatalog();
    expect([...tools.keys()].toSorted()).toEqual([
      "crawlee",
      "faster-whisper",
      "ffmpeg",
      "node",
      "open-fonts",
      "pandoc",
      "piper-tts",
      "piper-voice-en",
      "piper-voice-ro",
      "playwright",
      "pptxgenjs",
      "python",
      "remotion",
      "tesseract",
      "uv",
      "whisper-model-base",
      "whisper-model-small",
      "whisper-model-tiny",
      "yt-dlp",
    ]);
    for (const entry of tools.values()) {
      for (const version of entry.versions) {
        for (const recipe of version.recipes) {
          for (const step of recipe.steps) {
            if (step.type === "download") {
              expect(step.sha256).toMatch(/^[0-9a-f]{64}$/);
              expect(step.url.startsWith("https://")).toBe(true);
            }
          }
        }
      }
      // Every tool has a tested Linux x64 recipe; other platforms are marked.
      const linux = entry.versions
        .flatMap((v) => v.recipes)
        .find((r) => r.os === "linux" && r.arch === "x64");
      expect(linux?.status).toBe("tested");
    }
    // Tools that read outside files are marked.
    for (const id of ["ffmpeg", "remotion", "yt-dlp", "pandoc", "faster-whisper", "playwright"]) {
      expect(tools.get(id)?.untrustedInput).toBe(true);
    }
    expect(tools.get("remotion")?.license.commercialUse).toBe("paid");
  });

  const recipe = (steps: unknown[]) =>
    JSON.stringify({
      id: "evil",
      name: "Evil",
      description: "x",
      homepage: "https://x",
      kind: "binary",
      license: { spdx: "MIT", name: "MIT", url: "https://x", commercialUse: "free", note: "x" },
      untrustedInput: false,
      verify: { bin: "evil", args: [], expect: "" },
      versions: [
        {
          version: "1.0.0",
          recipes: [
            {
              os: "linux",
              arch: "x64",
              status: "tested",
              steps,
              bin: { evil: "evil" },
              installedSize: 1,
            },
          ],
        },
      ],
    });

  it("rejects scripts, missing checksums, http and unsafe paths", () => {
    expect(
      parseCatalogEntry(recipe([{ type: "script", run: "curl https://x | sh" }])),
    ).toHaveProperty("error");
    expect(
      parseCatalogEntry(
        recipe([
          { type: "download", url: "https://x/evil", size: 1, archive: "none", dest: "evil" },
        ]),
      ),
    ).toHaveProperty("error");
    const noSha = parseCatalogEntry(
      recipe([
        {
          type: "download",
          url: "https://x/evil",
          sha256: "",
          size: 1,
          archive: "none",
          dest: "evil",
        },
      ]),
    );
    expect("error" in noSha && noSha.error).toContain("sha256 checksum is required");
    const http = parseCatalogEntry(
      recipe([
        {
          type: "download",
          url: "http://x/evil",
          sha256: "a".repeat(64),
          size: 1,
          archive: "none",
          dest: "evil",
        },
      ]),
    );
    expect("error" in http && http.error).toContain("https");
    const escape = parseCatalogEntry(
      recipe([
        {
          type: "download",
          url: "https://x/evil",
          sha256: "a".repeat(64),
          size: 1,
          archive: "none",
          dest: "../../bin/evil",
        },
      ]),
    );
    expect("error" in escape && escape.error).toContain("leaves the toolchain folder");
    expect(isSafeRelativePath("bin/ffmpeg")).toBe(true);
    expect(isSafeRelativePath("/usr/bin/x")).toBe(false);
    expect(isSafeRelativePath("C:\\x")).toBe(false);
    expect(
      parseCatalogEntry(
        recipe([
          {
            type: "download",
            url: "https://x/evil",
            sha256: "a".repeat(64),
            size: 1,
            archive: "none",
            dest: "evil",
          },
        ]),
      ),
    ).toHaveProperty("entry");
  });

  it("requires env names to start with ZEN_", () => {
    const tools = shippedCatalog();
    const entry = tools.get("remotion")!;
    const bad = {
      ...entry,
      versions: entry.versions.map((v) => ({
        ...v,
        recipes: v.recipes.map((r) => ({ ...r, env: { PATH: "/evil" } })),
      })),
    };
    expect(validateCatalogEntry(bad).join(" ")).toContain("must start with ZEN_");
  });
});

describe("shipped packs", () => {
  const packsDir = NodePath.join(here, "..", "workflows", "packs");
  const packs = NodeFS.readdirSync(packsDir)
    // A pack of several workflows (website-health) is a folder of workflow folders.
    .filter((id) => NodeFS.existsSync(NodePath.join(packsDir, id, "workflow.json")))
    .map((id) => ({
      id,
      text: NodeFS.readFileSync(NodePath.join(packsDir, id, "workflow.json"), "utf8"),
    }))
    .filter((pack) => pack.text.includes('"requires"'));

  it("declares requirements that resolve against the catalog on Linux x64", () => {
    const tools = shippedCatalog();
    expect(packs.map((pack) => pack.id)).toEqual(
      expect.arrayContaining([
        "app-tutorial-video",
        "brandbook-kit",
        "footage-rough-cut",
        "social-reels-kit",
        "video-brand-fix",
      ]),
    );
    for (const pack of packs) {
      const parsed = parseRequires(pack.text);
      expect(parsed.problem ?? null, pack.id).toBeNull();
      const requires = parsed.requires!;
      for (const tool of requires.tools ?? []) {
        expect(tools.has(tool.id), `${pack.id}: ${tool.id}`).toBe(true);
        if (tool.version)
          expect(isValidRange(tool.version), `${pack.id}: ${tool.version}`).toBe(true);
      }
      for (const alternative of requires.alternatives ?? []) {
        for (const [from, to] of Object.entries(alternative.replaceTools ?? {})) {
          expect(tools.has(from) && tools.has(to), `${pack.id}: ${from} -> ${to}`).toBe(true);
        }
        for (const id of alternative.dropTools ?? [])
          expect(tools.has(id), `${pack.id}: ${id}`).toBe(true);
      }
      const result = evaluateWorkflow(baseInput(requires));
      const codes = result.compatibility.reasons.map((reason) => reason.code);
      expect(
        codes.filter((code) => /unknown|broken|dependency-loop/.test(code)),
        pack.id,
      ).toEqual([]);
      expect(result.compatibility.status, pack.id).not.toBe("not-compatible");
      for (const item of result.plan) {
        const recipe = item.entry.versions
          .flatMap((version) => version.recipes)
          .find((r) => r.os === "linux" && r.arch === "x64");
        expect(recipe?.status, `${pack.id}: ${item.entry.id}`).toBe("tested");
      }
    }
  });

  it("marks the tools that read outside files and adds the browser and voice tools", () => {
    const tutorial = parseRequires(
      packs.find((pack) => pack.id === "app-tutorial-video")!.text,
    ).requires!;
    const result = evaluateWorkflow(baseInput(tutorial));
    expect(result.plan.map((item) => item.entry.id)).toEqual(
      expect.arrayContaining(["node", "playwright", "ffmpeg", "open-fonts", "piper-tts", "python"]),
    );
    expect(result.compatibility.untrustedInputTools).toEqual(
      expect.arrayContaining(["Web page tools (Playwright)"]),
    );
    const roughCut = parseRequires(
      packs.find((pack) => pack.id === "footage-rough-cut")!.text,
    ).requires!;
    const lighter = roughCut.alternatives?.find((alternative) => alternative.kind === "lighter");
    expect(lighter?.replaceTools).toEqual({ "whisper-model-small": "whisper-model-base" });
  });
});

describe("requirement evaluation", () => {
  it("is ready when a workflow has no requirements", () => {
    const result = evaluateWorkflow(baseInput(null));
    expect(result.compatibility.status).toBe("ready");
    expect(result.compatibility.hasRequirements).toBe(false);
  });

  it("plans the install with dependencies first, sizes, time and license notes", () => {
    const result = evaluateWorkflow(baseInput(promoRequires()));
    const c = result.compatibility;
    expect(c.status).toBe("needs-install");
    // The video tools first; the optional local preview voice (Piper) comes after them.
    expect(result.plan.map((item) => item.entry.id).slice(0, 3)).toEqual([
      "node",
      "remotion",
      "ffmpeg",
    ]);
    expect(result.plan.map((item) => item.entry.id)).toEqual(
      expect.arrayContaining(["open-fonts", "piper-tts", "piper-voice-ro", "piper-voice-en"]),
    );
    expect(c.install.find((item) => item.toolId === "node")?.reason).toBe("dependency");
    expect(c.downloadBytes).toBeGreaterThan(100 * 1024 * 1024);
    expect(c.headline).toMatch(
      /^Getting the video tools ready \(~\d+ MB, one time, .*\): Node.js, Remotion, FFmpeg, /,
    );
    expect(c.licenseNotes.find((note) => note.toolId === "remotion")?.note).toContain(
      "4 or more people",
    );
    expect(c.untrustedInputTools).toEqual(expect.arrayContaining(["Remotion", "FFmpeg"]));
    // The optional ElevenLabs connector is noted, never blocking.
    expect(c.reasons.map((r) => r.code)).toContain("optional-connector");
    expect(c.alternatives).toEqual([]);
  });

  it("is ready when everything is installed", () => {
    const installed = [
      installedRef("node", "24.22.2"),
      installedRef("remotion", "4.0.538"),
      installedRef("ffmpeg", "8.1.3"),
      installedRef("open-fonts", "2026.11.08+86aced9"),
      installedRef("uv", "0.13.7"),
      installedRef("python", "3.12.16"),
      installedRef("piper-tts", "1.8.0"),
      installedRef("piper-voice-ro", "1.0.0+e7229f7"),
      installedRef("piper-voice-en", "1.0.0+e7229f7"),
    ];
    const result = evaluateWorkflow(baseInput(promoRequires(), { installed }));
    expect(result.plan.map((item) => item.entry.id)).toEqual([]);
    expect(result.compatibility.status).toBe("ready");
    expect(result.plan).toEqual([]);
    expect(result.compatibility.runEstimate).toBe(
      "about 3 min for a 30-second video on this computer",
    );
  });

  it("plans uv for a pip tool when python comes from the system (invoices pack)", () => {
    const requires: ZenWorkflowRequires = {
      tools: [{ id: "tesseract", version: "^5.5", purpose: "OCR" }],
    };
    const system = [{ ...installedRef("python", "3.12.3"), system: true, source: "PATH" }];
    const result = evaluateWorkflow(baseInput(requires, { system }));
    expect(result.plan.map((item) => item.entry.id)).toEqual(["uv", "tesseract"]);
    // uv on the system is used as is, nothing extra to install.
    const withUv = evaluateWorkflow(
      baseInput(requires, {
        system: [...system, { ...installedRef("uv", "0.13.2"), system: true, source: "PATH" }],
      }),
    );
    expect(withUv.plan.map((item) => item.entry.id)).toEqual(["tesseract"]);
  });

  it("explains a low-memory computer and offers only the lighter variant that fits", () => {
    const result = evaluateWorkflow(
      baseInput(promoRequires(), { probe: probe({ totalRamGb: 3 }) }),
    );
    const c = result.compatibility;
    expect(c.status).toBe("not-compatible");
    expect(c.headline).toBe("This task needs 4 GB of memory (RAM); this computer has 3 GB.");
    expect(c.alternatives.map((a) => [a.id, a.kind, a.status])).toEqual([
      ["short-720p", "lighter", "needs-install"],
    ]);

    const tiny = evaluateWorkflow(baseInput(promoRequires(), { probe: probe({ totalRamGb: 1 }) }));
    expect(tiny.compatibility.status).toBe("not-compatible");
    expect(tiny.compatibility.alternatives).toEqual([]);
  });

  it("speaks Romanian when asked", () => {
    const result = evaluateWorkflow(
      baseInput(promoRequires(), { probe: probe({ totalRamGb: 1.5 }), locale: "ro" }),
    ).compatibility;
    expect(result.headline).toBe(
      "Această sarcină are nevoie de 4 GB de memorie (RAM); acest calculator are 1.5 GB.",
    );
    expect(result.licenseNotes.find((note) => note.toolId === "remotion")?.note).toContain(
      "4 sau mai mulți oameni",
    );
  });

  it("says in plain Romanian what it prepares, with the size up front", () => {
    const result = evaluateWorkflow(baseInput(promoRequires(), { locale: "ro" })).compatibility;
    expect(result.headline).toMatch(
      /^Pregătesc uneltele pentru video \(~\d+(,\d)? (MB|GB), o singură dată, .*\): Node\.js, Remotion, FFmpeg, .*Fonturi pentru titluri și subtitrări/,
    );
    expect(result.install.map((item) => item.name)).toContain(
      "Fonturi pentru titluri și subtitrări",
    );
  });

  it("says plainly that a graphics card is missing", () => {
    const requires: ZenWorkflowRequires = {
      tools: [],
      hardware: { gpu: { required: true, vendor: "nvidia", minVramGb: 8, api: "cuda" } },
    };
    const none = evaluateWorkflow(baseInput(requires)).compatibility;
    expect(none.headline).toBe(
      "This task needs a NVIDIA graphics card with 8 GB; this computer has none.",
    );
    const small = evaluateWorkflow(
      baseInput(requires, {
        probe: probe({
          gpus: [
            {
              vendor: "nvidia",
              name: "GTX 1650",
              vramGb: 4,
              cuda: "12.4",
              metal: false,
              driver: "550",
            },
          ],
        }),
      }),
    ).compatibility;
    expect(small.status).toBe("not-compatible");
    expect(small.headline).toContain("only GTX 1650 (4 GB)");
    const ok = evaluateWorkflow(
      baseInput(requires, {
        probe: probe({
          gpus: [
            {
              vendor: "nvidia",
              name: "RTX 4070",
              vramGb: 12,
              cuda: "12.4",
              metal: false,
              driver: "550",
            },
          ],
        }),
      }),
    ).compatibility;
    expect(ok.status).toBe("ready");
  });

  it("estimates slow runs from the processor and offers the declared connector", () => {
    const requires: ZenWorkflowRequires = {
      tools: [],
      runTime: {
        unit: "a 30-second video",
        seconds: 300,
        referenceCpuCores: 8,
        slowAfterSeconds: 600,
      },
      alternatives: [
        { id: "cloud", kind: "connector", label: "Use ElevenLabs", connector: "elevenlabs" },
      ],
    };
    const result = evaluateWorkflow(
      baseInput(requires, { probe: probe({ cpuCores: 2 }) }),
    ).compatibility;
    expect(result.status).toBe("slow");
    expect(result.runEstimate).toBe("about 20 min for a 30-second video on this computer");
    expect(result.alternatives).toEqual([
      expect.objectContaining({ kind: "connector", id: "cloud", available: false }),
    ]);
    const fast = evaluateWorkflow(
      baseInput(requires, { probe: probe({ cpuCores: 16 }) }),
    ).compatibility;
    expect(fast.status).toBe("ready");
    expect(fast.alternatives).toEqual([]);
  });

  it("checks OS, disk and the tools folder", () => {
    const requires: ZenWorkflowRequires = {
      tools: [{ id: "ffmpeg" }],
      hardware: { os: ["windows", "macos"] },
    };
    expect(evaluateWorkflow(baseInput(requires)).compatibility.headline).toBe(
      "This task works only on Windows or macOS; this computer runs Linux.",
    );
    const disk = evaluateWorkflow(
      baseInput({ tools: [{ id: "ffmpeg" }] }, { probe: probe({ freeDiskGb: 0.1 }) }),
    );
    expect(disk.compatibility.headline).toMatch(
      /needs 0\.\d GB of free disk space; this computer has 0\.1 GB free/,
    );
    const readOnly = evaluateWorkflow(
      baseInput({ tools: [{ id: "ffmpeg" }] }, { probe: probe({ installDirWritable: false }) }),
    );
    expect(readOnly.compatibility.reasons.map((r) => r.code)).toContain("install-dir");
  });

  it("picks the version that has a recipe for this platform", () => {
    const mac = evaluateWorkflow(
      baseInput(
        { tools: [{ id: "ffmpeg", version: ">=6" }] },
        { probe: probe({ os: "macos", arch: "arm64" }) },
      ),
    );
    expect(mac.plan.map((item) => [item.entry.id, item.version, item.recipe.status])).toEqual([
      ["ffmpeg", "6.1.1", "untested"],
    ]);
    const newer = evaluateWorkflow(
      baseInput(
        { tools: [{ id: "ffmpeg", version: ">=8" }] },
        { probe: probe({ os: "macos", arch: "arm64" }) },
      ),
    );
    expect(newer.compatibility.headline).toBe(
      "FFmpeg is not available for macOS on ARM computers.",
    );
    const unknown = evaluateWorkflow(baseInput({ tools: [{ id: "blender" }] }));
    expect(unknown.compatibility.status).toBe("not-compatible");
    const optionalUnknown = evaluateWorkflow(
      baseInput({ tools: [{ id: "blender", optional: true }] }),
    );
    expect(optionalUnknown.compatibility.status).toBe("ready");
  });
});

describe("blocked versions", () => {
  const advisories = (tools: ZenAdvisoryFile["tools"]): ZenAdvisoryFile => ({
    version: 1,
    generatedAt: "2026-11-07T00:00:00.000Z",
    source: "test",
    tools,
  });

  it("merges catalog rules and advisory files", () => {
    const tools = shippedCatalog();
    const list = mergeBlockLists(tools.values(), [
      advisories({ "yt-dlp": { minSafeVersion: "2026.10.21", blockedVersions: [] } }),
      advisories({
        pandoc: {
          blockedVersions: [
            { version: ">=3.0 <3.12.1", reason: "Bad parser", advisories: ["GHSA-x"] },
          ],
        },
      }),
      null,
    ]);
    expect(blockReason(list, "yt-dlp", "2026.08.19")).toContain(
      "older than the safe minimum 2026.10.21",
    );
    expect(blockReason(list, "yt-dlp", "2026.10.21")).toBeNull();
    expect(blockReason(list, "pandoc", "3.11")).toBe("Bad parser (GHSA-x)");
    expect(blockReason(list, "pandoc", "3.12.1")).toBeNull();
  });

  it("updates a blocked installed version for safety when a safe one exists", () => {
    const tools = shippedCatalog();
    const blockList = mergeBlockLists(tools.values(), [
      advisories({
        ffmpeg: { blockedVersions: [{ version: "6.1.1", reason: "Heap overflow in a demuxer" }] },
      }),
    ]);
    const result = evaluateWorkflow(
      baseInput(
        { tools: [{ id: "ffmpeg", version: ">=6" }] },
        { installed: [installedRef("ffmpeg", "6.1.1")], blockList },
      ),
    );
    expect(result.compatibility.status).toBe("updating");
    expect(result.plan.map((item) => [item.version, item.reason])).toEqual([
      ["9.1-dev.128560", "safety-update"],
    ]);
    expect(result.compatibility.reasons[0]?.message).toBe(
      "FFmpeg 6.1.1 has a known security problem, so it will be updated to 9.1-dev.128560 first.",
    );
  });

  it("blocks with a plain explanation when no safe version can be installed", () => {
    const tools = shippedCatalog();
    const blockList = mergeBlockLists(tools.values(), [
      advisories({
        "yt-dlp": {
          blockedVersions: [{ version: "<=2026.10.26", reason: "Remote code execution" }],
        },
      }),
    ]);
    for (const installed of [[], [installedRef("yt-dlp", "2026.10.26")]]) {
      const result = evaluateWorkflow(
        baseInput({ tools: [{ id: "yt-dlp" }] }, { installed, blockList }),
      );
      expect(result.compatibility.status).toBe("not-compatible");
      expect(result.compatibility.reasons[0]?.code).toBe("blocked");
      expect(result.compatibility.headline).toContain("known security problem and no safe version");
      expect(result.plan).toEqual([]);
    }
  });
});

describe("OSV scanner", () => {
  const fixtures = NodePath.join(here, "fixtures");

  it("parses a querybatch response and a vulnerability record", () => {
    const batch = JSON.parse(
      NodeFS.readFileSync(NodePath.join(fixtures, "osv-querybatch.json"), "utf8"),
    );
    expect(parseOsvBatch(batch, 3)).toEqual([
      ["GHSA-3ch3-jhc6-5r8x", "GHSA-42h4-v29r-42qg"],
      [],
      [],
    ]);
    const record = JSON.parse(
      NodeFS.readFileSync(NodePath.join(fixtures, "osv-vuln-GHSA-3ch3-jhc6-5r8x.json"), "utf8"),
    );
    const vuln = parseOsvVuln(record, "PyPI", "yt-dlp");
    expect(vuln).toEqual({
      id: "GHSA-3ch3-jhc6-5r8x",
      summary: "yt-dlp Generic Extractor MITM Vulnerability via Arbitrary Proxy Injection",
      severity: "MODERATE",
      fixed: ["2023.11.14"],
    });
    expect(parseOsvVuln(record, "npm", "yt-dlp").fixed).toEqual([]);
  });

  it("builds the advisories file: own packages set a minimum, dependencies block the version", () => {
    const own = {
      toolId: "yt-dlp",
      toolVersion: "2023.07.06",
      ecosystem: "PyPI",
      name: "yt-dlp",
      version: "2023.07.06",
      own: true,
    };
    const dep = {
      toolId: "remotion",
      toolVersion: "4.0.538",
      ecosystem: "npm",
      name: "zod",
      version: "4.5.4",
      own: false,
    };
    const file = buildAdvisoryFile(
      [
        {
          query: own,
          vulns: [
            { id: "A", summary: "RCE", severity: "HIGH", fixed: ["2023.11.14"] },
            { id: "B", summary: "x", severity: "LOW", fixed: ["2024.01.01"] },
          ],
        },
        {
          query: dep,
          vulns: [
            {
              id: "GHSA-mrhx",
              summary: "Zod can exhaust memory",
              severity: "HIGH",
              fixed: ["4.6.6"],
            },
          ],
        },
      ],
      { now: "2026-11-07T00:00:00.000Z" },
    );
    expect(file.tools["yt-dlp"]).toEqual({
      minSafeVersion: "2023.11.14",
      blockedVersions: [
        { version: "2023.07.06", reason: "Known security problem: RCE", advisories: ["A"] },
      ],
    });
    expect(file.tools.remotion).toEqual({
      blockedVersions: [
        {
          version: "4.0.538",
          reason: "Known security problem in zod@4.5.4: Zod can exhaust memory",
          advisories: ["GHSA-mrhx"],
        },
      ],
    });
    // Moderate findings block only with --block-moderate.
    const moderate = [
      { query: own, vulns: [{ id: "M", summary: "m", severity: "MODERATE" as const, fixed: [] }] },
    ];
    expect(buildAdvisoryFile(moderate, { now: "x" }).tools).toEqual({});
    expect(
      Object.keys(buildAdvisoryFile(moderate, { now: "x", blockModerate: true }).tools),
    ).toEqual(["yt-dlp"]);
  });

  it("queries the tool packages and every pinned package of the shipped lockfiles", () => {
    const queries = buildOsvQueries([...shippedCatalog().values()], (relative) =>
      NodeFS.readFileSync(NodePath.join(catalogDir, relative), "utf8"),
    );
    expect(queries).toContainEqual(
      expect.objectContaining({ toolId: "yt-dlp", name: "yt-dlp", own: true }),
    );
    expect(queries).toContainEqual(
      expect.objectContaining({
        toolId: "remotion",
        ecosystem: "npm",
        name: "zod",
        version: "4.6.6",
      }),
    );
    expect(queries).toContainEqual(
      expect.objectContaining({
        toolId: "faster-whisper",
        ecosystem: "PyPI",
        name: "av",
        version: "15.1.0",
      }),
    );
    expect(
      lockfilePackages(
        JSON.stringify({
          packages: { "": {}, "node_modules/a/node_modules/@b/c": { version: "1.0.0" } },
        }),
      ),
    ).toEqual([{ name: "@b/c", version: "1.0.0" }]);
    expect(
      requirementsPackages(
        "Foo==1.2 ; sys_platform == 'win32' \\\n    --hash=sha256:aa\n# via x\n",
      ),
    ).toEqual([{ name: "foo", version: "1.2" }]);
  });
});

describe("machine probe parsing", () => {
  it("reads nvidia-smi", () => {
    const query =
      "NVIDIA GeForce RTX 4070 Laptop GPU, 8188, 551.86\nNVIDIA RTX A2000, 6138, 551.86\n";
    const plain = "| NVIDIA-SMI 551.86   Driver Version: 551.86   CUDA Version: 12.4     |";
    const gpus = parseNvidiaSmiQuery(query, parseNvidiaSmiCudaVersion(plain));
    expect(gpus).toEqual([
      {
        vendor: "nvidia",
        name: "NVIDIA GeForce RTX 4070 Laptop GPU",
        vramGb: 8,
        cuda: "12.4",
        metal: false,
        driver: "551.86",
      },
      {
        vendor: "nvidia",
        name: "NVIDIA RTX A2000",
        vramGb: 6,
        cuda: "12.4",
        metal: false,
        driver: "551.86",
      },
    ]);
    expect(
      parseNvidiaSmiQuery("NVIDIA-SMI has failed because it couldn't communicate", null),
    ).toEqual([]);
  });

  it("reads the Windows CIM query, preferring the registry's 64-bit memory size", () => {
    const json = JSON.stringify([
      {
        Name: "NVIDIA GeForce RTX 3060",
        AdapterRAM: 4293918720,
        DriverVersion: "31.0.15.5186",
        AdapterCompatibility: "NVIDIA",
        QwMemorySize: 12884901888,
      },
      {
        Name: "Intel(R) UHD Graphics 770",
        AdapterRAM: 1073741824,
        DriverVersion: "31.0.101.4502",
        AdapterCompatibility: "Intel Corporation",
        QwMemorySize: null,
      },
      { Name: "Microsoft Basic Display Adapter", AdapterRAM: 0 },
    ]);
    expect(parseWindowsVideoControllers(json)).toEqual([
      {
        vendor: "nvidia",
        name: "NVIDIA GeForce RTX 3060",
        vramGb: 12,
        cuda: null,
        metal: false,
        driver: "31.0.15.5186",
      },
      {
        vendor: "intel",
        name: "Intel(R) UHD Graphics 770",
        vramGb: 1,
        cuda: null,
        metal: false,
        driver: "31.0.101.4502",
      },
    ]);
    // One adapter comes back as an object, not an array.
    expect(
      parseWindowsVideoControllers(
        JSON.stringify({
          Name: "AMD Radeon RX 6600",
          AdapterRAM: 4293918720,
          AdapterCompatibility: "Advanced Micro Devices, Inc.",
        }),
      )[0]?.vendor,
    ).toBe("amd");
    expect(parseWindowsVideoControllers("not json")).toEqual([]);
  });

  it("reads system_profiler and /proc/meminfo", () => {
    const apple = JSON.stringify({
      SPDisplaysDataType: [
        {
          _name: "Apple M2 Pro",
          sppci_model: "Apple M2 Pro",
          spdisplays_vendor: "sppci_vendor_Apple",
          spdisplays_mtlgpufamilysupport: "spdisplays_metal3",
        },
      ],
    });
    expect(parseSystemProfilerDisplays(apple, 16)).toEqual([
      { vendor: "apple", name: "Apple M2 Pro", vramGb: 12, cuda: null, metal: true, driver: null },
    ]);
    const intelMac = JSON.stringify({
      SPDisplaysDataType: [
        {
          sppci_model: "AMD Radeon Pro 5500M",
          spdisplays_vram: "8 GB",
          spdisplays_vendor: "sppci_vendor_amd",
          spdisplays_mtlgpufamilysupport: "spdisplays_metal3",
        },
      ],
    });
    expect(parseSystemProfilerDisplays(intelMac, 32)[0]).toMatchObject({
      vendor: "amd",
      vramGb: 8,
      metal: true,
    });
    expect(parseMemAvailableGb("MemTotal: 16000000 kB\nMemAvailable:    8388608 kB\n")).toBe(8);
  });
});

describe("reference counting", () => {
  it("counts the workflows that use each installed toolchain, dependencies included", () => {
    const tools = shippedCatalog();
    const installed = [
      installedRef("node", "24.22.2"),
      installedRef("remotion", "4.0.541"),
      installedRef("ffmpeg", "9.1-dev.128560"),
      installedRef("ffmpeg", "6.1.1"),
      installedRef("pandoc", "3.13"),
    ];
    const refs = toolchainReferences(
      installed,
      [
        { name: "Promo", requires: promoRequires() },
        { name: "Clip", requires: { tools: [{ id: "ffmpeg", version: "<7" }] } },
        { name: "Plain", requires: null },
      ],
      tools,
      mergeBlockLists(tools.values(), []),
    );
    expect(Object.fromEntries(refs)).toEqual({
      "node@24.22.2": ["Promo"],
      "remotion@4.0.541": ["Promo"],
      "ffmpeg@9.1-dev.128560": ["Promo"],
      "ffmpeg@6.1.1": ["Clip"],
      "pandoc@3.13": [],
    });
  });
});

describe("sandbox and thread environment", () => {
  const policy = {
    kind: "bwrap" as const,
    platform: "linux" as const,
    workDir: "/home/u/work",
    readOnlyDirs: ["/z/toolchains/ffmpeg/8.1.3", "/z/workflows/promo"],
    network: false,
    env: { ZEN_TOOL_FFMPEG: "/z/.threads/t/bin/ffmpeg" },
  };

  it("confines tools with bubblewrap: read-only tools, writable task folder, no network", () => {
    const args = bwrapArgs(policy);
    expect(args).toContain("--unshare-net");
    expect(args.join(" ")).toContain(
      "--ro-bind /z/toolchains/ffmpeg/8.1.3 /z/toolchains/ffmpeg/8.1.3",
    );
    expect(args.join(" ")).toContain("--bind /home/u/work /home/u/work");
    expect(args.join(" ")).not.toContain("/home/u ");
    expect(bwrapArgs({ ...policy, network: true })).not.toContain("--unshare-net");
    // Never root inside, no capabilities, even when the server runs as root.
    expect(args.join(" ")).toContain("--unshare-user --uid 65534 --gid 65534 --cap-drop ALL");
    // A workflow folder inside the task folder stays read-only (parents are mounted first).
    const nested = bwrapArgs({ ...policy, readOnlyDirs: ["/home/u/work/wf"] }).join(" ");
    expect(nested.indexOf("--bind /home/u/work /home/u/work")).toBeLessThan(
      nested.indexOf("--ro-bind /home/u/work/wf /home/u/work/wf"),
    );
    const [shim] = shimFiles(
      { name: "ffmpeg", command: ["/z/toolchains/ffmpeg/8.1.3/bin/ffmpeg"] },
      policy,
      "/usr/bin/bwrap",
    );
    expect(shim?.content).toContain("exec '/usr/bin/bwrap'");
    expect(shim?.content).toContain("'/z/toolchains/ffmpeg/8.1.3/bin/ffmpeg' \"$@\"");
    const [plain] = shimFiles(
      { name: "ffmpeg", command: ["/x/ffmpeg"] },
      { ...policy, kind: "none" },
      null,
    );
    expect(plain?.content).toContain("exec '/x/ffmpeg' \"$@\"");
    const [windows] = shimFiles(
      { name: "ffmpeg", command: ["C:\\z\\ffmpeg.exe"] },
      { ...policy, platform: "windows", kind: "none" },
      null,
    );
    expect(windows).toMatchObject({
      fileName: "ffmpeg.cmd",
      content: '@echo off\r\n"C:\\z\\ffmpeg.exe" %*\r\n',
    });
    expect(seatbeltProfile({ ...policy, kind: "sandbox-exec", platform: "macos" })).toContain(
      "(deny network-outbound (remote ip))",
    );
  });

  it("allows the declared commands and denies installers and downloads", () => {
    const rules = workflowPermissionRules(["ffmpeg", "node"], "/z/.threads/t/bin");
    expect(rules.allow).toEqual([
      "Bash(ffmpeg:*)",
      "Bash(/z/.threads/t/bin/ffmpeg:*)",
      "Bash(node:*)",
      "Bash(/z/.threads/t/bin/node:*)",
    ]);
    expect(rules.deny).toEqual(
      expect.arrayContaining([
        "Bash(sudo:*)",
        "Bash(npm install:*)",
        "Bash(curl:*)",
        "Bash(pip install:*)",
      ]),
    );
  });

  it("injects PATH, ZEN_TOOL_* and permission rules only into prepared threads", () => {
    setZenToolchainThreadResolver((threadId) =>
      threadId === "t1"
        ? {
            env: { ZEN_TOOL_FFMPEG: "/b/ffmpeg" },
            pathFirst: "/b",
            permissions: { allow: ["Bash(ffmpeg:*)"], deny: ["Bash(sudo:*)"] },
          }
        : null,
    );
    try {
      const env = withZenToolchainEnv("t1", { PATH: "/usr/bin", HOME: "/h" });
      expect(env.PATH).toBe(`/b${NodePath.delimiter}/usr/bin`);
      expect(env.ZEN_TOOL_FFMPEG).toBe("/b/ffmpeg");
      expect(withZenToolchainEnv("other", { PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
      expect(withZenToolchainSettings("t1", { permissions: { allow: ["Read"] } })).toEqual({
        env: { ZEN_TOOL_FFMPEG: "/b/ffmpeg" },
        permissions: { allow: ["Read", "Bash(ffmpeg:*)"], deny: ["Bash(sudo:*)"] },
      });
      expect(withZenToolchainSettings("t1", "/settings.json")).toBe("/settings.json");
      expect(withZenToolchainSettings("other", undefined)).toBeUndefined();
      expect(toolEnvName("whisper-python")).toBe("ZEN_TOOL_WHISPER_PYTHON");
    } finally {
      setZenToolchainThreadResolver(null);
    }
  });
});

describe("toolchain manager (mocked downloads)", () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const dir of temporary.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  const setup = (
    options: {
      content?: string;
      served?: string;
      advisories?: ZenAdvisoryFile;
      env?: Record<string, string>;
      /** Per-URL answers (status, body); other URLs get `served ?? content`. */
      responses?: Record<string, { status: number; body: string }>;
    } = {},
  ) => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-tc-"));
    temporary.push(root);
    const content = options.content ?? "#!/bin/sh\necho 'demo 1.0.0'\n";
    const catalog = NodePath.join(root, "catalog");
    NodeFS.mkdirSync(NodePath.join(catalog, "tools"), { recursive: true });
    const recipe = (os: string, arch: string) => ({
      os,
      arch,
      status: "tested",
      steps: [
        {
          type: "download",
          url: "https://downloads.example/demo",
          sha256: sha(content),
          size: content.length,
          archive: "none",
          dest: "demo",
          executable: true,
        },
      ],
      bin: { demo: "demo" },
      env: { ZEN_DEMO_HOME: "${dir}" },
      installedSize: content.length,
    });
    NodeFS.writeFileSync(
      NodePath.join(catalog, "tools", "demo.json"),
      JSON.stringify({
        id: "demo",
        name: "Demo",
        description: "x",
        homepage: "https://x",
        kind: "binary",
        license: {
          spdx: "MIT",
          name: "MIT",
          url: "https://x",
          commercialUse: "free",
          note: "Free.",
        },
        untrustedInput: true,
        verify: { bin: "demo", args: ["--version"], expect: "demo 1\\.0\\.0" },
        versions: [
          {
            version: "1.0.0",
            recipes: ["linux", "windows", "macos"].flatMap((os) =>
              ["x64", "arm64"].map((arch) => recipe(os, arch)),
            ),
          },
        ],
      }),
    );
    NodeFS.writeFileSync(
      NodePath.join(catalog, "advisories.json"),
      JSON.stringify(
        options.advisories ?? { version: 1, generatedAt: "2026-01-01", source: "t", tools: {} },
      ),
    );
    const assets = NodePath.join(root, "assets");
    const workflow = NodePath.join(assets, "builtin", "demo-flow");
    NodeFS.mkdirSync(workflow, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(workflow, "workflow.json"),
      JSON.stringify({ id: "demo-flow", name: "Demo flow", requires: { tools: [{ id: "demo" }] } }),
    );
    const zenHome = NodePath.join(root, "home");
    const work = NodePath.join(root, "work");
    NodeFS.mkdirSync(work, { recursive: true });
    const fetched: string[] = [];
    const fakeFetch = (async (url: string) => {
      fetched.push(String(url));
      const answer = options.responses?.[String(url)];
      if (answer) return new Response(answer.body, { status: answer.status });
      return new Response(options.served ?? content, { status: 200 });
    }) as unknown as typeof fetch;
    const runs: string[][] = [];
    const manager = new ToolchainManager({
      zenHome,
      platform: "linux",
      arch: "x64",
      catalogDir: catalog,
      workflowsAssetsDir: assets,
      fetch: fakeFetch,
      run: async (command, args) => {
        runs.push([command, ...args]);
        return { code: 0, output: "demo 1.0.0" };
      },
      env: options.env ?? { ZEN_TOOLS_MIRROR: "off" },
      probeImpl: async () => probe({ installDir: NodePath.join(zenHome, "toolchains") }),
    });
    return { manager, zenHome, work, fetched, runs };
  };

  const waitJob = async (manager: ToolchainManager, jobId: string) => {
    await expect.poll(() => manager.job(jobId).state, { timeout: 5_000 }).not.toBe("running");
    return manager.job(jobId);
  };

  const MIRRORED = "https://tools.zed-zen.com/demo/1.0.0/linux-x64/demo";

  it("downloads from the Zen mirror first and keeps the same checksum", async () => {
    const { manager, fetched } = setup({ env: {} });
    await manager.init();
    const job = await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    expect(job.state).toBe("done");
    expect(fetched).toEqual([MIRRORED]);
  });

  it("falls back to the official URL when the mirror fails or serves other bytes", async () => {
    for (const answer of [
      { status: 503, body: "busy" },
      { status: 200, body: "tampered by the mirror" },
    ]) {
      const { manager, fetched } = setup({ env: {}, responses: { [MIRRORED]: answer } });
      await manager.init();
      const job = await waitJob(
        manager,
        (await manager.install({ workflowId: "demo-flow" })).jobId,
      );
      expect(job.state).toBe("done");
      expect(fetched).toEqual([MIRRORED, "https://downloads.example/demo"]);
    }
  });

  it("fails with both reasons when the mirror and the official URL fail", async () => {
    const { manager } = setup({
      env: { ZEN_TOOLS_MIRROR: "https://mirror.example.org/zen/" },
      responses: {
        "https://mirror.example.org/zen/demo/1.0.0/linux-x64/demo": { status: 404, body: "" },
        "https://downloads.example/demo": { status: 503, body: "" },
      },
    });
    await manager.init();
    const job = await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    expect(job.state).toBe("failed");
    expect(job.message).toContain("(404) from mirror.example.org");
    expect(job.message).toContain("(503) from downloads.example");
  });

  it("takes the mirror from Settings when no env is set, and rejects a bad one", async () => {
    const { manager, fetched } = setup({ env: {} });
    await manager.init();
    const overview = await manager.overview();
    await manager.setSettings({ ...overview.settings, toolsMirror: "off" });
    expect(manager.mirrorBases()).toEqual([]);
    await expect(
      manager.setSettings({ ...overview.settings, toolsMirror: "http://mirror.example.org" }),
    ).rejects.toThrow(/https/);
    await manager.setSettings({ ...overview.settings, toolsMirror: "https://m.example.org/x" });
    expect(manager.mirrorBases()).toEqual(["https://m.example.org/x"]);
    const job = await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    expect(job.state).toBe("done");
    expect(fetched).toEqual(["https://m.example.org/x/demo/1.0.0/linux-x64/demo"]);
  });

  it("installs from a verified download, prepares a thread and counts references", async () => {
    const { manager, zenHome, work, fetched } = setup();
    await manager.init();
    expect((await manager.checkWorkflow({ workflowId: "demo-flow" })).status).toBe("needs-install");
    await expect(
      manager.prepareThread({ workflowId: "demo-flow", threadId: "t-1", cwd: work }),
    ).rejects.toThrow(/Set up Demo first/);
    const job = await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    expect(job.state).toBe("done");
    expect(fetched).toEqual(["https://downloads.example/demo"]);
    expect((await manager.checkWorkflow({ workflowId: "demo-flow" })).status).toBe("ready");

    const prepared = await manager.prepareThread({
      workflowId: "demo-flow",
      threadId: "t-1",
      cwd: work,
    });
    const shimDir = NodePath.join(zenHome, "toolchains", ".threads", "t-1", "bin");
    const shim = [NodePath.join(shimDir, "demo"), NodePath.join(shimDir, "demo.cmd")].find((file) =>
      NodeFS.existsSync(file),
    )!;
    expect(prepared.env.ZEN_TOOL_DEMO).toBe(shim);
    expect(prepared.env.ZEN_DEMO_HOME).toBe(NodePath.join(zenHome, "toolchains", "demo", "1.0.0"));
    expect(prepared.appendix).toContain(`- demo: ${shim}`);
    expect(NodeFS.existsSync(shim)).toBe(true);
    expect(manager.resolveThread("t-1")?.pathFirst).toBe(NodePath.dirname(shim));

    const overview = await manager.overview();
    expect(overview.installed.map((tool) => [tool.toolId, tool.usedBy])).toEqual([
      ["demo", ["Demo flow"]],
    ]);
    expect(overview.unusedCount).toBe(0);
    manager.dispose();
  });

  it("throws away a download whose checksum does not match", async () => {
    const { manager, zenHome } = setup({ served: "tampered" });
    await manager.init();
    const job = await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    expect(job.state).toBe("failed");
    expect(job.message).toContain("does not match its checksum");
    expect(NodeFS.existsSync(NodePath.join(zenHome, "toolchains", "demo", "1.0.0"))).toBe(false);
    expect((await manager.checkWorkflow({ workflowId: "demo-flow" })).status).toBe("needs-install");
    manager.dispose();
  });

  it("refuses to run a blocked version and updates when advisories block it", async () => {
    const { manager, work } = setup();
    await manager.init();
    await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    manager.applyAdvisories({
      version: 1,
      generatedAt: "2026-11-07",
      source: "hub",
      tools: {
        demo: {
          blockedVersions: [
            { version: "1.0.0", reason: "Known security problem", advisories: ["GHSA-demo"] },
          ],
        },
      },
    });
    const check = await manager.checkWorkflow({ workflowId: "demo-flow" });
    expect(check.status).toBe("not-compatible");
    expect(check.reasons[0]?.code).toBe("blocked");
    await expect(
      manager.prepareThread({ workflowId: "demo-flow", threadId: "t-2", cwd: work }),
    ).rejects.toMatchObject({ reason: "blocked" });
    expect((await manager.overview()).installed[0]?.blocked).toBe(
      "Known security problem (GHSA-demo)",
    );
    manager.dispose();
  });

  it("pulls the advisories file from the signed-in hub, never an older one", async () => {
    const { manager } = setup();
    await manager.init();
    const files: Record<string, string> = {
      new: JSON.stringify({
        version: 1,
        generatedAt: "2026-11-08T01:00:00.000Z",
        source: "osv.dev+nvd",
        tools: { demo: { blockedVersions: [{ version: "1.0.0", reason: "CVE-2026-1" }] } },
      }),
      old: JSON.stringify({
        version: 1,
        generatedAt: "2026-11-01T01:00:00.000Z",
        source: "x",
        tools: {},
      }),
    };
    let serve = "new";
    const asked: string[] = [];
    (manager as unknown as { fetchImpl: typeof fetch }).fetchImpl = (async (url: string) => {
      asked.push(String(url));
      return new Response(files[serve], { status: 200 });
    }) as unknown as typeof fetch;
    // No hub signed in, no setting: nothing is fetched.
    expect(await manager.refreshAdvisories()).toBe(false);
    setZenHubBridge({
      roleForLocalCompany: () => undefined,
      memorySettings: () => null,
      setMemorySettings: async () => undefined,
      accessLedger: () => null,
      runnerRole: () => null,
      grant: async () => undefined,
      revoke: async () => undefined,
      approveInstall: async () => undefined,
      advisoriesUrl: () => "http://127.0.0.1:8787/v1/toolchains/advisories",
    });
    try {
      expect(await manager.refreshAdvisories()).toBe(true);
      expect(asked).toEqual(["http://127.0.0.1:8787/v1/toolchains/advisories"]);
      expect((await manager.overview()).advisories.blockedCount).toBe(1);
      serve = "old";
      expect(await manager.refreshAdvisories()).toBe(false);
      expect((await manager.overview()).advisories.blockedCount).toBe(1);
    } finally {
      setZenHubBridge(null);
    }
    expect(isAdvisoriesUrl("http://hub.example.com/v1/toolchains/advisories")).toBe(false);
    expect(isAdvisoriesUrl("https://hub.example.com/v1/toolchains/advisories")).toBe(true);
  });

  it("cleans up unused toolchains and removes ones unused for N days", async () => {
    const { manager, zenHome } = setup();
    await manager.init();
    await waitJob(manager, (await manager.install({ workflowId: "demo-flow" })).jobId);
    // Still used by demo-flow: cleanup keeps it.
    expect((await manager.cleanup()).installed).toHaveLength(1);
    // Unused for longer than the setting: removed.
    await manager.setSettings({ autoRemoveDays: 1, companyRunner: false });
    const later = new ToolchainManager({
      zenHome,
      platform: "linux",
      arch: "x64",
      catalogDir: NodePath.join(zenHome, "..", "catalog"),
      workflowsAssetsDir: NodePath.join(zenHome, "..", "assets"),
      env: {},
      probeImpl: async () => probe(),
      now: () => new Date("2999-01-01T00:00:00.000Z"),
    });
    await later.init();
    expect(await later.autoRemove()).toEqual(["demo@1.0.0"]);
    expect((await later.installed()).length).toBe(0);
    later.dispose();
    manager.dispose();
    await expect(manager.setSettings({ autoRemoveDays: -1, companyRunner: false })).rejects.toThrow(
      /whole number/,
    );
  });

  it("cancels a running install and keeps nothing half-installed", async () => {
    const { manager, zenHome } = setup();
    let downloading!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      downloading = resolve;
    });
    const slow = manager as unknown as { fetchImpl: typeof fetch };
    slow.fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        downloading();
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    await manager.init();
    const started = await manager.install({ workflowId: "demo-flow" });
    await downloadStarted;
    manager.cancel(started.jobId);
    const job = await waitJob(manager, started.jobId);
    expect(job.state).toBe("cancelled");
    expect(NodeFS.existsSync(NodePath.join(zenHome, "toolchains", "demo", "1.0.0"))).toBe(false);
    manager.dispose();
  });
});
