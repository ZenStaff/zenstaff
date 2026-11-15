import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  buildWorkflowMessage,
  missingRequiredInputs,
  renderWorkflowTemplate,
  splitWorkflowMessage,
  templatePlaceholders,
  templateSectionProblems,
  validateWorkflow,
  workflowIdFromName,
  type ZenRegistryEntry,
  type ZenWorkflow,
  type ZenWorkflowManifest,
} from "@t3tools/contracts/zenOffice";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { privateNamesPattern } from "./privateNames.test-support.ts";

import {
  loadWorkflowDir,
  marketplaceView,
  mergeWorkflows,
  packWorkflowIds,
  parseRegistry,
  parseWorkflowFolder,
  resolveSkillFolder,
  workflowBelongsToPack,
} from "./workflowStore.ts";

const manifest = (overrides: Partial<ZenWorkflowManifest> = {}): ZenWorkflowManifest => ({
  id: "press-release",
  name: "Press release",
  description: "A press release.",
  category: "pr",
  icon: "newspaper",
  inputs: [
    { id: "news", label: "News", type: "longtext", required: true },
    { id: "quote", label: "Quote", type: "text", required: false },
  ],
  output: "press-release.md",
  version: "1.0.0",
  author: "Zen Staff",
  ...overrides,
});

const workflow = (id: string, source: ZenWorkflow["source"], name = id): ZenWorkflow => ({
  manifest: manifest({ id, name }),
  prompt: "{{news}}",
  skill: null,
  source,
  packId: null,
  editable: source === "user",
});

describe("template rendering", () => {
  it("fills placeholders and marks missing values", () => {
    expect(
      renderWorkflowTemplate("News: {{news}}. Quote: {{ quote }}.", { news: " Opening " }),
    ).toBe("News: Opening. Quote: (not given).");
  });

  it("keeps a section only when its input has a value, and inverted sections otherwise", () => {
    const template = "A{{#quote}} quote={{quote}}{{/quote}}{{^quote}} no quote{{/quote}}.";
    expect(renderWorkflowTemplate(template, { quote: "Hi" })).toBe("A quote=Hi.");
    expect(renderWorkflowTemplate(template, { quote: "  " })).toBe("A no quote.");
  });

  it("resolves nested sections", () => {
    const template = "{{^a}}{{^b}}neither{{/b}}{{#b}}b only{{/b}}{{/a}}{{#a}}a{{/a}}";
    expect(renderWorkflowTemplate(template, {})).toBe("neither");
    expect(renderWorkflowTemplate(template, { b: "x" })).toBe("b only");
    expect(renderWorkflowTemplate(template, { a: "x", b: "x" })).toBe("a");
  });

  it("collapses blank lines left by removed sections", () => {
    expect(renderWorkflowTemplate("one\n\n{{#x}}two{{/x}}\n\n\nthree", {})).toBe("one\n\nthree");
  });

  it("lists placeholders once, in order, and reports broken sections", () => {
    expect(templatePlaceholders("{{b}} {{#a}}{{a}}{{/a}} {{b}}")).toEqual(["b", "a"]);
    expect(templateSectionProblems("{{#a}}x")).toHaveLength(1);
    expect(templateSectionProblems("x{{/a}}")).toHaveLength(1);
    expect(templateSectionProblems("{{#a}}{{#b}}{{/a}}{{/b}}").length).toBeGreaterThan(0);
    expect(templateSectionProblems("{{#a}}{{^b}}{{/b}}{{/a}}")).toEqual([]);
  });

  it("appends SKILL.md as guidance", () => {
    expect(
      buildWorkflowMessage({ prompt: "Do {{news}}", skill: "Be brief." }, { news: "it" }),
    ).toBe("Do it\n\n---\nGuidance for this task:\n\nBe brief.");
    expect(buildWorkflowMessage({ prompt: "Do {{news}}", skill: null }, { news: "it" })).toBe(
      "Do it",
    );
  });

  it("points SKILL.md at the folder it was read from", () => {
    expect(resolveSkillFolder("Read {{workflow_folder}}/references/a.md", "/w/x")).toBe(
      "Read /w/x/references/a.md",
    );
    expect(resolveSkillFolder(null, "/w/x")).toBeNull();
  });

  it("finds required inputs without a value", () => {
    expect(missingRequiredInputs(manifest(), { news: "" }).map((input) => input.id)).toEqual([
      "news",
    ]);
    expect(missingRequiredInputs(manifest(), { news: "x" })).toEqual([]);
  });
});

describe("validation", () => {
  it("accepts a well-formed workflow", () => {
    expect(validateWorkflow(manifest(), "{{news}} {{#quote}}{{quote}}{{/quote}}")).toEqual([]);
  });

  it("explains every problem in plain words", () => {
    const problems = validateWorkflow(
      manifest({
        id: "Bad Id",
        name: " ",
        inputs: [
          { id: "news", label: "News", type: "select", required: true, options: ["only one"] },
          { id: "news", label: "", type: "text", required: false },
        ],
      }),
      "{{missing}} {{#news}}",
    );
    expect(problems.join("\n")).toMatch(/lowercase/);
    expect(problems.join("\n")).toMatch(/name/);
    expect(problems.join("\n")).toMatch(/at least two options/);
    expect(problems.join("\n")).toMatch(/Two inputs use the id "news"/);
    expect(problems.join("\n")).toMatch(/needs a label/);
    expect(problems.join("\n")).toMatch(/\{\{missing\}\}/);
    expect(problems.join("\n")).toMatch(/never closed/);
  });

  it("makes ids from names", () => {
    expect(workflowIdFromName("Weekly report!")).toBe("weekly-report");
    expect(workflowIdFromName("Ofertă clienți")).toBe("oferta-clienti");
    expect(workflowIdFromName("!")).toBe("workflow-new");
  });
});

describe("workflow folders", () => {
  const files = (overrides: Partial<Parameters<typeof parseWorkflowFolder>[0]> = {}) => ({
    folderName: "press-release",
    workflowJson: JSON.stringify(manifest()),
    prompt: "{{news}}",
    skill: null,
    packMarker: null,
    ...overrides,
  });

  it("parses a folder and marks user workflows editable", () => {
    const parsed = parseWorkflowFolder(files(), "user");
    expect(parsed._tag).toBe("ok");
    if (parsed._tag === "ok") {
      expect(parsed.workflow.editable).toBe(true);
      expect(parsed.workflow.packId).toBeNull();
    }
  });

  it("reads the pack marker; installed packs are not editable", () => {
    const parsed = parseWorkflowFolder(
      files({ packMarker: JSON.stringify({ packId: "press-release", version: "1.0.0" }) }),
      "user",
    );
    expect(parsed._tag === "ok" && parsed.workflow.packId).toBe("press-release");
    expect(parsed._tag === "ok" && parsed.workflow.editable).toBe(false);
  });

  it("reports missing files, bad JSON and an id that differs from the folder", () => {
    expect(parseWorkflowFolder(files({ workflowJson: null }), "user")).toMatchObject({
      _tag: "problem",
    });
    expect(parseWorkflowFolder(files({ prompt: null }), "user")).toMatchObject({ _tag: "problem" });
    expect(parseWorkflowFolder(files({ workflowJson: "{" }), "user")).toMatchObject({
      _tag: "problem",
    });
    const renamed = parseWorkflowFolder(files({ folderName: "other" }), "user");
    expect(renamed._tag === "problem" && renamed.problem.message).toMatch(/folder is "other"/);
  });

  it("lets user workflows replace built-ins with the same id", () => {
    const merged = mergeWorkflows([
      [workflow("a", "builtin"), workflow("b", "builtin")],
      [workflow("a", "user", "Mine")],
    ]);
    expect(merged.map((item) => [item.manifest.id, item.source])).toEqual([
      ["b", "builtin"],
      ["a", "user"],
    ]);
  });

  it("marks marketplace entries installed", () => {
    const registry = parseRegistry(
      JSON.stringify({
        version: 1,
        entries: [
          { ...manifest({ id: "a" }), kind: "builtin" },
          { ...manifest({ id: "p" }), kind: "pack", path: "packs/p" },
          { ...manifest({ id: "q" }), kind: "pack", path: "packs/q" },
          { ...manifest({ id: "soon" }), kind: "coming_soon" },
        ],
      }),
    );
    if ("error" in registry) throw new Error(registry.error);
    const installed = { ...workflow("p", "user"), packId: "p" };
    const view = marketplaceView("x", registry.entries, [workflow("a", "builtin")], [installed]);
    expect(view.entries.map((item) => [item.entry.id, item.installed])).toEqual([
      ["a", true],
      ["p", true],
      ["q", false],
      ["soon", false],
    ]);
    expect(parseRegistry("{}")).toHaveProperty("error");
  });

  it("company workflows are editable unless installed from a pack", () => {
    const parsed = parseWorkflowFolder(files(), "company");
    expect(parsed._tag === "ok" && parsed.workflow.editable).toBe(true);
    const installed = parseWorkflowFolder(
      files({ packMarker: JSON.stringify({ packId: "p", version: "1.0.0" }) }),
      "company",
    );
    expect(installed._tag === "ok" && installed.workflow.editable).toBe(false);
  });

  it("a pack of several workflows is installed when any of them is, old single packs too", () => {
    const entry = {
      ...manifest({ id: "health" }),
      kind: "pack" as const,
      path: "packs/health",
      workflows: ["speed", "google"],
    };
    expect(packWorkflowIds(entry)).toEqual(["speed", "google"]);
    expect(packWorkflowIds({ id: "solo" })).toEqual(["solo"]);
    const viaPack = { ...workflow("speed", "user"), packId: "health" };
    const legacy = { ...workflow("google", "user"), packId: "google" };
    const own = workflow("speed", "user");
    expect(workflowBelongsToPack(viaPack, entry)).toBe(true);
    expect(workflowBelongsToPack(legacy, entry)).toBe(true);
    expect(workflowBelongsToPack(own, entry)).toBe(false);
    expect(workflowBelongsToPack({ ...workflow("other", "user"), packId: "other" }, entry)).toBe(
      false,
    );
    const view = marketplaceView("x", [entry], [], [legacy]);
    expect(view.entries[0]?.installed).toBe(true);
    expect(marketplaceView("x", [entry], [], [own]).entries[0]?.installed).toBe(false);
  });

  it("validates the optional per-workflow model", () => {
    expect(validateWorkflow(manifest({ model: "claude-haiku-5-5" }), "Hi")).toEqual([]);
    expect(validateWorkflow(manifest({ model: "haiku" }), "Hi")).toEqual([]);
    expect(validateWorkflow(manifest({ model: "bad model!" }), "Hi").join(" ")).toMatch(/model/);
  });

  it("splits a workflow's first message into the person's answers and the instructions", () => {
    const text = buildWorkflowMessage(
      { prompt: "Write a press release about {{topic}}.", skill: "Be brief." },
      { topic: "Opening" },
      {
        locale: "ro",
        summary: { title: "Comunicat de presă", answers: [{ label: "Subiect", value: "Opening" }] },
      },
    );
    const split = splitWorkflowMessage(text);
    expect(split?.summary).toBe("Comunicat de presă\n\nSubiect: Opening");
    expect(split?.instructions).toMatch(/^Write a press release about Opening\./);
    expect(split?.instructions).toContain("Guidance for this task");
    // Without a language line it is still recognised by the guidance block.
    const noLocale = buildWorkflowMessage(
      { prompt: "Do {{x}}.", skill: "Tip." },
      { x: "it" },
      { summary: { title: "T", answers: [{ label: "X", value: "it" }] } },
    );
    expect(splitWorkflowMessage(noLocale)?.summary).toBe("T\n\nX: it");
    // Ordinary messages, even with a rule line, are left alone.
    expect(splitWorkflowMessage("Notes\n\n---\n\nMore notes")).toBeNull();
    expect(splitWorkflowMessage("Just a question")).toBeNull();
  });
});

/** The shipped packs: one-workflow folders, and the sub-folders of packs with `workflows`. */
const loadShippedPacks = Effect.fn("test.loadShippedPacks")(function* (
  here: string,
  entries: ReadonlyArray<ZenRegistryEntry>,
) {
  const path = yield* Path.Path;
  const multi = entries.filter((entry) => entry.kind === "pack" && entry.workflows);
  const single = yield* loadWorkflowDir(path.join(here, "packs"), "user");
  const workflows = [...single.workflows];
  const problems = single.problems.filter(
    (problem) => !multi.some((entry) => problem.location === `user: ${entry.id}`),
  );
  for (const entry of multi) {
    const loaded = yield* loadWorkflowDir(path.join(here, "packs", entry.id), "user");
    workflows.push(...loaded.workflows);
    problems.push(...loaded.problems);
  }
  return { workflows, problems };
});

// Shipped workflows, packs and lessons reach every user: no real client or company of ours, and
// only obviously fictional phone numbers (0700 000 xxx). Casa Verde is the invented demo brand.
// The real names are in zen-names.private.txt (not public; see privateNames.test-support.ts).
const realClientNames = privateNamesPattern();
const realLookingPhone = /(?:\+40[ .]?|\b0)7(?!00[ .]?000)\d{2}[ .]?\d{3}[ .]?\d{3}\b/;

it.layer(NodeServices.layer)("shipped workflows", (it) => {
  it.effect("every built-in and pack loads and every pack in the registry exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const here = import.meta.dirname;
      const builtin = yield* loadWorkflowDir(path.join(here, "builtin"), "builtin");
      expect(builtin.problems).toEqual([]);
      expect(builtin.workflows).toHaveLength(7);
      const registry = parseRegistry(yield* fs.readFileString(path.join(here, "registry.json")));
      if ("error" in registry) throw new Error(registry.error);
      const packs = yield* loadShippedPacks(here, registry.entries);
      expect(packs.problems).toEqual([]);
      const ids = new Set(registry.entries.map((entry) => entry.id));
      expect(ids.size).toBe(registry.entries.length);
      for (const item of builtin.workflows) expect(ids.has(item.manifest.id)).toBe(true);
      for (const entry of registry.entries.filter((candidate) => candidate.kind === "pack")) {
        expect(entry.path).toBe(`packs/${entry.id}`);
        for (const id of packWorkflowIds(entry)) {
          const found = packs.workflows.find((item) => item.manifest.id === id);
          expect(found, id).toBeDefined();
          if (!entry.workflows) expect(found?.manifest.version).toBe(entry.version);
        }
      }
      // Every pack folder is listed: a one-workflow pack, or a pack's sub-folder.
      const listed = new Set(
        registry.entries.filter((entry) => entry.kind === "pack").flatMap(packWorkflowIds),
      );
      for (const item of packs.workflows)
        expect(listed.has(item.manifest.id), item.manifest.id).toBe(true);
    }),
  );

  it.effect("included packs are complete, translated, generic and match the registry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const here = import.meta.dirname;
      const registry = parseRegistry(yield* fs.readFileString(path.join(here, "registry.json")));
      if ("error" in registry) throw new Error(registry.error);
      const builtin = yield* loadWorkflowDir(path.join(here, "builtin"), "builtin");
      const packs = yield* loadShippedPacks(here, registry.entries);
      const included = registry.entries.filter(
        (entry) =>
          (entry.kind === "pack" && entry.tags?.includes("included")) ||
          entry.id === "press-release",
      );
      // A pack of several workflows is checked workflow by workflow, against its own manifest.
      const checked = included.flatMap((entry) => {
        if (!entry.workflows) return [{ entry, folder: entry.id }];
        expect(entry.i18n?.ro?.name && entry.i18n.ro.description, entry.id).toBeTruthy();
        return entry.workflows.map((id) => {
          const item = packs.workflows.find((candidate) => candidate.manifest.id === id);
          if (!item) throw new Error(`${id} did not load`);
          const ro = item.manifest.i18n?.ro;
          return {
            entry: {
              ...entry,
              id,
              name: item.manifest.name,
              description: item.manifest.description,
              category: item.manifest.category,
              icon: item.manifest.icon,
              version: item.manifest.version,
              author: item.manifest.author,
              i18n: { ro: { name: ro?.name, description: ro?.description } },
            },
            folder: `${entry.id}/${id}`,
          };
        });
      });
      expect(checked.length).toBeGreaterThanOrEqual(10);
      const endings = [
        "Answer the person in their language and write the documents in it too",
        "give one line on what it holds and its full absolute path",
        "embed it in the reply as `![short title](/absolute/path/to/file.ext)`",
      ];
      const companySpecific = new RegExp(
        `horecaos|zed-?zen|meniul ?zilei|\\/root\\/|${realClientNames.source}`,
        "i",
      );
      for (const { entry, folder: packFolder } of checked) {
        const found = [...builtin.workflows, ...packs.workflows].find(
          (item) => item.manifest.id === entry.id,
        );
        if (!found) throw new Error(`${entry.id} did not load`);
        const { manifest } = found;
        expect([entry.name, entry.description, entry.category, entry.icon, entry.version]).toEqual([
          manifest.name,
          manifest.description,
          manifest.category,
          manifest.icon,
          manifest.version,
        ]);
        expect(entry.author).toBe(manifest.author);
        const ro = manifest.i18n?.ro;
        expect(ro?.name && ro.description && ro.output, entry.id).toBeTruthy();
        expect(entry.i18n?.ro).toEqual({ name: ro?.name, description: ro?.description });
        for (const input of manifest.inputs) {
          const t = ro?.inputs?.[input.id];
          expect(t?.label, `${entry.id}.${input.id}`).toBeTruthy();
          if (input.options)
            expect(t?.options?.length, `${entry.id}.${input.id}`).toBe(input.options.length);
        }
        const tail = found.prompt.slice(-900);
        for (const line of endings) expect(tail, entry.id).toContain(line);
        const folder = path.join(here, entry.kind === "builtin" ? "builtin" : "packs", packFolder);
        const texts = [found.prompt, found.skill ?? ""];
        for (const reference of (found.skill ?? "").matchAll(/`(\/[^`]+?\.md)`/g)) {
          const file = reference[1]!;
          if (!file.startsWith(folder)) continue;
          expect(yield* fs.exists(file), file).toBe(true);
          texts.push(yield* fs.readFileString(file));
        }
        for (const text of texts) {
          expect(text.replaceAll(folder, ""), entry.id).not.toMatch(companySpecific);
        }
      }
    }),
  );

  it.effect(
    "no shipped workflow, pack, kit or lesson file names a real client or a real phone",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const here = import.meta.dirname;
        const roots = ["builtin", "packs", "premium-kit", "../academy/lessons"];
        const textFile = /\.(json|md|mjs|js|jsx|ts|tsx|html|css|svg|txt|csv|py|sample)$/i;
        const files = [path.join(here, "registry.json")];
        for (const root of roots) {
          const dir = path.join(here, root);
          const names = yield* fs.readDirectory(dir, { recursive: true });
          files.push(
            ...names.filter((name) => textFile.test(name)).map((name) => path.join(dir, name)),
          );
        }
        const checked: string[] = [];
        for (const file of files) {
          const text = yield* fs.readFileString(file);
          checked.push(file);
          expect(text, file).not.toMatch(realClientNames);
          expect(text, file).not.toMatch(realLookingPhone);
        }
        expect(checked.length).toBeGreaterThan(100);
      }),
  );
});
