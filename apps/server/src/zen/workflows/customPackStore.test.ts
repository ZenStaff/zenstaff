// Customized packs end to end through ZenOffice: customize -> draft -> review -> save, the copy
// used instead of the original, company copies, share, revert, and Keep / Take / Merge when a
// new version ships. A small pack in a temp registry stands in for a shipped one.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ZenOffice from "./ZenOffice.ts";

const PACK = "demo-reels";

const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
  id: PACK,
  name: "Demo reels",
  description: "Reels from a brief.",
  category: "video",
  icon: "film",
  inputs: [{ id: "brief", label: "Brief", type: "longtext", required: true }],
  output: "reels/",
  version,
  author: "Zen Staff",
  requires: { tools: [{ id: "ffmpeg", version: ">=6", purpose: "audio" }] },
  ...extra,
});

const promptV1 =
  ["Make reels from {{brief}}.", "Music level: 0.30.", "Voice: none.", "Font: Inter.", "End."].join(
    "\n",
  ) + "\n";

/** A registry folder with one pack; `ship` writes a new version of it. */
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "zen-custom-" });
  const baseDir = path.join(root, "home");
  const registryDir = path.join(root, "registry");
  const packDir = path.join(registryDir, "packs", PACK);
  const ship = (version: string, prompt: string, extra: Record<string, unknown> = {}) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(path.join(packDir, "template"), { recursive: true });
      yield* fs.writeFileString(
        path.join(packDir, "workflow.json"),
        JSON.stringify(manifest(version, extra), null, 2),
      );
      yield* fs.writeFileString(path.join(packDir, "prompt.md"), prompt);
      yield* fs.writeFileString(
        path.join(packDir, "SKILL.md"),
        "Read {{workflow_folder}}/template/render.mjs\n",
      );
      yield* fs.writeFileString(
        path.join(packDir, "template", "render.mjs"),
        "export const music = 0.3;\n",
      );
      yield* fs.writeFileString(
        path.join(registryDir, "registry.json"),
        JSON.stringify({
          version: 1,
          entries: [
            {
              id: PACK,
              name: "Demo reels",
              description: "Reels.",
              category: "video",
              icon: "film",
              version,
              author: "Zen Staff",
              kind: "pack",
              path: `packs/${PACK}`,
            },
          ],
        }),
      );
    });
  yield* ship("1.0.0", promptV1);
  yield* fs.makeDirectory(baseDir, { recursive: true });
  const office = yield* ZenOffice.make({
    registryPath: path.join(registryDir, "registry.json"),
    defaultRegistryUrl: null,
  }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)));
  const edit = (folder: string, file: string, change: (text: string) => string) =>
    fs
      .readFileString(path.join(folder, file))
      .pipe(Effect.flatMap((text) => fs.writeFileString(path.join(folder, file), change(text))));
  const passChecks = (folder: string) =>
    fs.writeFileString(
      path.join(folder, ".zen-custom", "checks.json"),
      JSON.stringify({
        passed: true,
        summary: "node --check ok",
        commands: ["node --check template/render.mjs"],
      }),
    );
  return { fs, path, baseDir, office, ship, edit, passChecks };
});

const promptOf = (list: {
  workflows: ReadonlyArray<{ manifest: { id: string }; prompt: string }>;
}) => list.workflows.find((workflow) => workflow.manifest.id === PACK)?.prompt ?? "";

it.layer(Layer.mergeAll(NodeServices.layer, SqlitePersistence.layerMemory))(
  "custom packs",
  (it) => {
    describe("customize by prompt", () => {
      it.effect("drafts, reviews, saves and then uses the copy instead of the original", () =>
        Effect.gen(function* () {
          const { fs, path, baseDir, office, edit, passChecks } = yield* setup;
          yield* office.installPack({ id: PACK });

          const start = yield* office.customizePack({
            workflowId: PACK,
            request: "muzica mai încet",
            locale: "ro",
          });
          expect(start.pack).toMatchObject({
            customId: `${PACK}@personal`,
            status: "draft",
            hasActive: false,
          });
          expect(start.draftFolder).toBe(
            path.join(baseDir, "workflows", ".zen-custom-drafts", PACK),
          );
          expect(start.title).toBe("Personalizare: Demo reels");
          expect(start.message).toContain("muzica mai încet");
          // The original is kept as the merge base; nothing is used before saving.
          expect(
            yield* fs.exists(path.join(start.draftFolder, ".zen-custom", "base", "prompt.md")),
          ).toBe(true);
          expect(promptOf(yield* office.listWorkflows({}))).toBe(promptV1);

          const empty = yield* office.customDraft({ workflowId: PACK });
          expect(empty.blockers.join(" ")).toContain("Nothing has changed yet.");
          expect(empty.blockers.join(" ")).toContain("checks have not run");
          const refused = yield* office.saveCustomDraft({ workflowId: PACK }).pipe(Effect.flip);
          expect(refused.reason).toBe("invalid");

          yield* edit(start.draftFolder, "prompt.md", (text) => text.replace("0.30", "0.15"));
          yield* edit(start.draftFolder, "template/render.mjs", (text) =>
            text.replace("0.3", "0.15"),
          );
          yield* passChecks(start.draftFolder);
          const review = yield* office.customDraft({ workflowId: PACK });
          expect(review.blockers).toEqual([]);
          expect(review.files.map((file) => file.path)).toEqual([
            "prompt.md",
            "template/render.mjs",
          ]);
          expect(review.diff).toContain("-Music level: 0.30.\n+Music level: 0.15.");
          expect(review.checks?.passed).toBe(true);

          const saved = yield* office.saveCustomDraft({ workflowId: PACK });
          expect(saved).toMatchObject({
            status: "active",
            revision: 1,
            hasDraft: false,
            updateAvailable: null,
          });
          const listed = yield* office.listWorkflows({});
          const workflow = listed.workflows.find((item) => item.manifest.id === PACK)!;
          expect(workflow.prompt).toContain("0.15");
          expect(workflow.customization).toMatchObject({
            customId: `${PACK}@personal`,
            scope: "user",
          });
          expect(workflow.editable).toBe(false);
          expect(workflow.skill).toContain(path.join(baseDir, "workflows", PACK, "template"));
          const market = yield* office.registry;
          expect(market.entries[0]).toMatchObject({ installed: true, installedVersion: "1.0.0" });

          // Back to the original: the base is restored as a plain installed pack.
          yield* office.revertCustomPack({ workflowId: PACK });
          const back = (yield* office.listWorkflows({})).workflows.find(
            (item) => item.manifest.id === PACK,
          )!;
          expect(back.prompt).toBe(promptV1);
          expect(back.customization).toBeUndefined();
          expect(back.packId).toBe(PACK);
          expect(yield* office.customPacks({})).toEqual([]);
        }),
      );

      it.effect(
        "refuses a draft that changes tools or scheduled-run rules, or keeps conflicts",
        () =>
          Effect.gen(function* () {
            const { office, edit, passChecks } = yield* setup;
            yield* office.installPack({ id: PACK });
            const start = yield* office.customizePack({ workflowId: PACK });
            yield* edit(start.draftFolder, "workflow.json", (text) =>
              text.replace('"ffmpeg"', '"curl"'),
            );
            yield* edit(
              start.draftFolder,
              "prompt.md",
              (text) => `${text}<<<<<<< ours (your customized copy)\n`,
            );
            yield* passChecks(start.draftFolder);
            const review = yield* office.customDraft({ workflowId: PACK });
            expect(review.blockers.join(" ")).toContain("must stay as in the original: requires");
            expect(review.blockers.join(" ")).toContain("Conflicts are still marked in: prompt.md");
            yield* office.discardCustomDraft({ workflowId: PACK });
            expect(yield* office.customPacks({})).toEqual([]);
          }),
      );

      it.effect("customizes a built-in workflow and goes back to it", () =>
        Effect.gen(function* () {
          const { office, edit, passChecks } = yield* setup;
          const id = "client-offer-email";
          const start = yield* office.customizePack({
            workflowId: id,
            request: "semnătura noastră",
          });
          expect(start.pack.origin).toMatchObject({ kind: "builtin", packId: id });
          yield* edit(start.draftFolder, "prompt.md", (text) => `${text}\nSign as ACME.\n`);
          yield* passChecks(start.draftFolder);
          yield* office.saveCustomDraft({ workflowId: id });
          const custom = (yield* office.listWorkflows({})).workflows.find(
            (item) => item.manifest.id === id,
          )!;
          expect(custom).toMatchObject({ source: "user", packId: null });
          expect(custom.prompt).toContain("Sign as ACME.");
          yield* office.revertCustomPack({ workflowId: id });
          const back = (yield* office.listWorkflows({})).workflows.find(
            (item) => item.manifest.id === id,
          )!;
          expect(back.source).toBe("builtin");
        }),
      );
    });

    describe("company copies", () => {
      it.effect(
        "a company copy wins over the original for that company; share moves mine there",
        () =>
          Effect.gen(function* () {
            const { fs, path, baseDir, office, edit, passChecks } = yield* setup;
            yield* office.installPack({ id: PACK });
            const start = yield* office.customizePack({ workflowId: PACK, companyId: "acme" });
            expect(start.pack.customId).toBe(`${PACK}@firma`);
            expect(start.message).toContain("everyone in the company");
            yield* edit(start.draftFolder, "prompt.md", (text) =>
              text.replace("Inter", "Source Sans 3"),
            );
            yield* passChecks(start.draftFolder);
            yield* office.saveCustomDraft({ workflowId: PACK, companyId: "acme" });
            expect(promptOf(yield* office.listWorkflows({ companyId: "acme" }))).toContain(
              "Source Sans 3",
            );
            expect(promptOf(yield* office.listWorkflows({}))).toBe(promptV1);
            const listed = yield* office.customPacks({ companyId: "acme" });
            expect(listed.map((item) => [item.customId, item.scope, item.companyId])).toEqual([
              [`${PACK}@firma`, "company", "acme"],
            ]);
            yield* office.revertCustomPack({ workflowId: PACK, companyId: "acme" });
            expect(promptOf(yield* office.listWorkflows({ companyId: "acme" }))).toBe(promptV1);

            // Share: my own copy becomes the company's; my folder goes back to the original.
            const mine = yield* office.customizePack({ workflowId: PACK });
            yield* edit(mine.draftFolder, "prompt.md", (text) =>
              text.replace("Voice: none.", "Voice: piper."),
            );
            yield* passChecks(mine.draftFolder);
            yield* office.saveCustomDraft({ workflowId: PACK });
            const shared = yield* office.shareCustomPack({ workflowId: PACK, companyId: "acme" });
            expect(shared).toMatchObject({ customId: `${PACK}@firma`, scope: "company" });
            expect(promptOf(yield* office.listWorkflows({ companyId: "acme" }))).toContain(
              "Voice: piper.",
            );
            expect(promptOf(yield* office.listWorkflows({}))).toBe(promptV1);
            const marker = yield* fs.readFileString(
              path.join(baseDir, "companies", "acme", "workflows", PACK, ".zen-custom.json"),
            );
            expect(JSON.parse(marker)).toMatchObject({ scope: "company", companyId: "acme" });
          }),
      );
    });

    describe("when a new version ships", () => {
      const customized = Effect.gen(function* () {
        const env = yield* setup;
        yield* env.office.installPack({ id: PACK });
        const start = yield* env.office.customizePack({ workflowId: PACK });
        yield* env.edit(start.draftFolder, "prompt.md", (text) => text.replace("0.30", "0.15"));
        yield* env.passChecks(start.draftFolder);
        yield* env.office.saveCustomDraft({ workflowId: PACK });
        return env;
      });

      it.effect("an update never overwrites the copy; Merge combines both and is reviewed", () =>
        Effect.gen(function* () {
          const { office, ship, passChecks } = yield* customized;
          yield* ship(
            "1.1.0",
            promptV1.replace("Voice: none.", "Voice: piper preview.") +
              "Duck music 12 dB under voice.\n",
          );
          const [pack] = yield* office.customPacks({});
          expect(pack!.updateAvailable).toBe("1.1.0");
          // Updating the pack in the marketplace leaves the customized copy as it is.
          yield* office.installPack({ id: PACK });
          expect(promptOf(yield* office.listWorkflows({}))).toContain("0.15");

          const merged = yield* office.resolveCustomUpdate({
            workflowId: PACK,
            choice: "merge",
            locale: "en",
          });
          expect(merged.thread?.title).toBe("Update: Demo reels");
          expect(merged.thread?.message).toContain("version 1.1.0");
          expect(merged.thread?.pack.merge).toEqual({ from: "1.0.0", to: "1.1.0" });
          const review = yield* office.customDraft({ workflowId: PACK });
          expect(review.blockers).toEqual(["The pack's checks have not run on this draft yet."]);
          expect(review.diff).toContain("+Voice: piper preview.");
          expect(review.diff).toContain("+Duck music 12 dB under voice.");
          yield* passChecks(merged.thread!.draftFolder);
          const saved = yield* office.saveCustomDraft({ workflowId: PACK });
          expect(saved).toMatchObject({ updateAvailable: null, revision: 2 });
          expect(saved.origin.version).toBe("1.1.0");
          const prompt = promptOf(yield* office.listWorkflows({}));
          expect(prompt).toContain("Music level: 0.15.");
          expect(prompt).toContain("Voice: piper preview.");
          expect(prompt).toContain("Duck music 12 dB");
        }),
      );

      it.effect("a conflicting merge leaves markers the save refuses until resolved", () =>
        Effect.gen(function* () {
          const { office, ship, passChecks, edit } = yield* customized;
          yield* ship("1.1.0", promptV1.replace("0.30", "0.25 (ducked)"));
          const merged = yield* office.resolveCustomUpdate({ workflowId: PACK, choice: "merge" });
          expect(merged.thread?.message).toContain("Files with conflicts to resolve: prompt.md");
          yield* passChecks(merged.thread!.draftFolder);
          const review = yield* office.customDraft({ workflowId: PACK });
          expect(review.files).toContainEqual({ path: "prompt.md", change: "conflict" });
          expect(review.blockers.join(" ")).toContain("Conflicts are still marked in: prompt.md");
          // The agent resolves it: keeps the person's level and the new ducking.
          yield* edit(merged.thread!.draftFolder, "prompt.md", () =>
            promptV1.replace("0.30", "0.15 (ducked)"),
          );
          yield* office.saveCustomDraft({ workflowId: PACK });
          expect(promptOf(yield* office.listWorkflows({}))).toContain("0.15 (ducked)");
        }),
      );

      it.effect("Keep mine stops offering that version; Take new replaces the copy", () =>
        Effect.gen(function* () {
          const { office, ship } = yield* customized;
          yield* ship("1.1.0", promptV1.replace("End.", "The end."));
          yield* office.resolveCustomUpdate({ workflowId: PACK, choice: "keep" });
          expect((yield* office.customPacks({}))[0]!.updateAvailable).toBeNull();
          expect(promptOf(yield* office.listWorkflows({}))).toContain("0.15");
          const none = yield* office
            .resolveCustomUpdate({ workflowId: PACK, choice: "take" })
            .pipe(Effect.flip);
          expect(none.reason).toBe("invalid");

          yield* ship("1.2.0", promptV1.replace("End.", "Fin."));
          expect((yield* office.customPacks({}))[0]!.updateAvailable).toBe("1.2.0");
          yield* office.resolveCustomUpdate({ workflowId: PACK, choice: "take" });
          const workflow = (yield* office.listWorkflows({})).workflows.find(
            (item) => item.manifest.id === PACK,
          )!;
          expect(workflow.customization).toBeUndefined();
          expect(workflow.prompt).toContain("Fin.");
          expect(workflow.manifest.version).toBe("1.2.0");
          expect((yield* office.registry).entries[0]).toMatchObject({ installedVersion: "1.2.0" });
        }),
      );
    });
  },
);
