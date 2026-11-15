import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ZenWorkflowManifest } from "@t3tools/contracts/zenOffice";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ZenOffice from "./ZenOffice.ts";

const custom: ZenWorkflowManifest = {
  id: "thank-you-note",
  name: "Thank-you note",
  description: "A short thank-you note.",
  category: "admin",
  icon: "heart",
  inputs: [{ id: "person", label: "Who", type: "text", required: true }],
  output: "note.md",
  version: "1.0.0",
  author: "Me",
};

const withOffice = <A, E>(run: (office: ZenOffice.ZenOffice["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-" });
    const office = yield* ZenOffice.make().pipe(
      Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)),
    );
    return { result: yield* run(office), baseDir };
  });

it.layer(Layer.mergeAll(NodeServices.layer, SqlitePersistence.layerMemory))("ZenOffice", (it) => {
  describe("edition", () => {
    it.effect("defaults to code and remembers office", () =>
      withOffice((office) =>
        Effect.gen(function* () {
          expect((yield* office.settings).edition).toBe("code");
          yield* office.setEdition({ edition: "office" });
          return (yield* office.settings).edition;
        }),
      ).pipe(Effect.map(({ result }) => expect(result).toBe("office"))),
    );
  });

  describe("workflows", () => {
    it.effect("lists the built-ins, saves, renames and deletes a custom one", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const { result, baseDir } = yield* withOffice((office) =>
          Effect.gen(function* () {
            const before = yield* office.listWorkflows({});
            expect(before.problems).toEqual([]);
            expect(before.workflows.filter((item) => item.source === "builtin")).toHaveLength(7);

            const saved = yield* office.saveWorkflow({
              manifest: custom,
              prompt: "Thank {{person}}",
            });
            expect(saved).toMatchObject({ source: "user", editable: true });
            const duplicate = yield* office
              .saveWorkflow({ manifest: custom, prompt: "x" })
              .pipe(Effect.flip);
            expect(duplicate.reason).toBe("conflict");
            const invalid = yield* office
              .saveWorkflow({ manifest: { ...custom, id: "other" }, prompt: "{{nobody}}" })
              .pipe(Effect.flip);
            expect(invalid.reason).toBe("invalid");

            yield* office.saveWorkflow({
              manifest: { ...custom, id: "thanks", name: "Thanks" },
              prompt: "Thanks {{person}}",
              previousId: custom.id,
            });
            const after = yield* office.listWorkflows({ companyId: "acme" });
            const mine = after.workflows.filter((item) => item.source === "user");
            expect(mine.map((item) => item.manifest.id)).toEqual(["thanks"]);
            yield* office.deleteWorkflow({ id: "thanks" });
            return (yield* office.listWorkflows({})).workflows.filter(
              (item) => item.source === "user",
            );
          }),
        );
        expect(result).toEqual([]);
        expect(yield* fs.exists(path.join(baseDir, "workflows", "thanks"))).toBe(false);
      }),
    );

    it.effect("installs and uninstalls a marketplace pack; coming soon cannot install", () =>
      withOffice((office) =>
        Effect.gen(function* () {
          const market = yield* office.registry;
          const pack = market.entries.find((item) => item.entry.kind === "pack");
          if (!pack) throw new Error("no pack in registry.json");
          expect(pack.installed).toBe(false);
          const included = market.entries.filter((item) => item.entry.kind === "builtin");
          expect(included.every((item) => item.installed)).toBe(true);

          const installed = yield* office.installPack({ id: pack.entry.id });
          expect(installed.entries.find((item) => item.entry.id === pack.entry.id)).toMatchObject({
            installed: true,
            installedVersion: pack.entry.version,
          });
          const listed = yield* office.listWorkflows({});
          expect(listed.workflows.find((item) => item.manifest.id === pack.entry.id)).toMatchObject(
            { source: "user", packId: pack.entry.id, editable: false },
          );
          const edit = yield* office
            .saveWorkflow({
              manifest: { ...custom, id: pack.entry.id },
              prompt: "x {{person}}",
              previousId: pack.entry.id,
            })
            .pipe(Effect.flip);
          expect(edit.reason).toBe("conflict");

          const soon = market.entries.find((item) => item.entry.kind === "coming_soon");
          const refused = yield* office.installPack({ id: soon!.entry.id }).pipe(Effect.flip);
          expect(refused.reason).toBe("unavailable");

          const removed = yield* office.uninstallPack({ id: pack.entry.id });
          return removed.entries.find((item) => item.entry.id === pack.entry.id)?.installed;
        }),
      ).pipe(Effect.map(({ result }) => expect(result).toBe(false))),
    );

    it.effect("reads company workflows from <zen home>/companies/<id>/workflows by default", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({
          prefix: "zen-office-company-default-",
        });
        const folder = path.join(baseDir, "companies", "acme", "workflows", custom.id);
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "workflow.json"), JSON.stringify(custom));
        yield* fs.writeFileString(path.join(folder, "prompt.md"), "Hi {{person}}");
        const office = yield* ZenOffice.make().pipe(
          Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)),
        );
        const acme = yield* office.listWorkflows({ companyId: "acme" });
        expect(acme.workflows.find((item) => item.manifest.id === custom.id)?.source).toBe(
          "company",
        );
        const other = yield* office.listWorkflows({ companyId: "../acme" });
        expect(other.workflows.some((item) => item.manifest.id === custom.id)).toBe(false);
      }),
    );

    it.effect("lists company workflows through the seam, below the user's own", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-company-" });
        const companyDir = path.join(baseDir, "acme-workflows");
        const folder = path.join(companyDir, custom.id);
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "workflow.json"), JSON.stringify(custom));
        yield* fs.writeFileString(path.join(folder, "prompt.md"), "Hi {{person}}");
        const office = yield* ZenOffice.make({
          companyWorkflowsDir: (companyId) =>
            Effect.succeed(companyId === "acme" ? companyDir : null),
        }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)));
        const withCompany = yield* office.listWorkflows({ companyId: "acme" });
        expect(withCompany.workflows.find((item) => item.manifest.id === custom.id)?.source).toBe(
          "company",
        );
        const without = yield* office.listWorkflows({});
        expect(without.workflows.some((item) => item.manifest.id === custom.id)).toBe(false);
      }),
    );

    it.effect("saves, edits and deletes a workflow in the company folder", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const { result, baseDir } = yield* withOffice((office) =>
          Effect.gen(function* () {
            const saved = yield* office.saveWorkflow({
              manifest: custom,
              prompt: "Thank {{person}}",
              companyId: "acme",
            });
            expect(saved).toMatchObject({ source: "company", editable: true });
            // Not the person's own, and only listed with the company chosen.
            const mine = yield* office.listWorkflows({});
            expect(mine.workflows.some((item) => item.manifest.id === custom.id)).toBe(false);
            yield* office.saveWorkflow({
              manifest: { ...custom, name: "Thanks again" },
              prompt: "Thank {{person}} again",
              previousId: custom.id,
              companyId: "acme",
            });
            const listed = yield* office.listWorkflows({ companyId: "acme" });
            expect(listed.workflows.find((item) => item.manifest.id === custom.id)).toMatchObject({
              source: "company",
              prompt: "Thank {{person}} again\n",
            });
            const bad = yield* office
              .saveWorkflow({ manifest: custom, prompt: "x {{person}}", companyId: "../x" })
              .pipe(Effect.flip);
            expect(bad.reason).toBe("invalid");
            const notMine = yield* office.deleteWorkflow({ id: custom.id }).pipe(Effect.flip);
            expect(notMine.reason).toBe("not-found");
            yield* office.deleteWorkflow({ id: custom.id, companyId: "acme" });
            return (yield* office.listWorkflows({ companyId: "acme" })).workflows.filter(
              (item) => item.source === "company",
            );
          }),
        );
        expect(result).toEqual([]);
        const folder = path.join(baseDir, "companies", "acme", "workflows", custom.id);
        expect(yield* fs.exists(folder)).toBe(false);
      }),
    );

    it.effect("installs and uninstalls a pack of several workflows (Website health)", () =>
      withOffice((office) =>
        Effect.gen(function* () {
          const market = yield* office.registry;
          const health = market.entries.find((item) => item.entry.id === "website-health");
          expect(health?.entry.workflows).toHaveLength(5);
          // The five checks are no longer separate entries.
          expect(market.entries.some((item) => item.entry.id === "website-speed-check")).toBe(
            false,
          );
          const installed = yield* office.installPack({ id: "website-health" });
          expect(
            installed.entries.find((item) => item.entry.id === "website-health")?.installed,
          ).toBe(true);
          const listed = yield* office.listWorkflows({});
          const fromPack = listed.workflows.filter((item) => item.packId === "website-health");
          expect(fromPack.map((item) => item.manifest.id).toSorted()).toEqual(
            [...health!.entry.workflows!].toSorted(),
          );
          expect(fromPack.every((item) => !item.editable)).toBe(true);
          yield* office.uninstallPack({ id: "website-health" });
          return (yield* office.listWorkflows({})).workflows.filter((item) => item.packId !== null);
        }),
      ).pipe(Effect.map(({ result }) => expect(result).toEqual([]))),
    );

    it.effect(
      "uninstalling the new pack also removes a check installed as an old single pack",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const { result, baseDir } = yield* withOffice((office) => Effect.succeed(office));
          // An install from before the regrouping: the check's own id as pack id.
          const old = path.join(baseDir, "workflows", "website-speed-check");
          const shipped = path.join(
            import.meta.dirname,
            "packs",
            "website-health",
            "website-speed-check",
          );
          yield* fs.copy(shipped, old);
          yield* fs.writeFileString(
            path.join(old, ".zen-pack.json"),
            JSON.stringify({ packId: "website-speed-check", version: "1.0.0" }),
          );
          const market = yield* result.registry;
          expect(market.entries.find((item) => item.entry.id === "website-health")?.installed).toBe(
            true,
          );
          yield* result.uninstallPack({ id: "website-health" });
          expect(yield* fs.exists(old)).toBe(false);
        }),
    );

    it.effect("copies a chosen file into <work folder>/inputs without overwriting", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { result, baseDir } = yield* withOffice((office) => Effect.succeed(office));
        const cwd = path.join(baseDir, "work");
        yield* fs.makeDirectory(cwd);
        const data = Buffer.from("hello").toString("base64");
        const first = yield* result.uploadInputFile({
          cwd,
          fileName: "../Brief.pdf",
          dataBase64: data,
        });
        expect(first).toMatchObject({ relativePath: "inputs/Brief.pdf", bytes: 5 });
        expect(yield* fs.readFileString(first.absolutePath)).toBe("hello");
        const second = yield* result.uploadInputFile({
          cwd,
          fileName: "Brief.pdf",
          dataBase64: data,
        });
        expect(second.relativePath).toBe("inputs/Brief-2.pdf");
        const hidden = yield* result.uploadInputFile({ cwd, fileName: ".env", dataBase64: data });
        expect(hidden.relativePath).toBe("inputs/env");
        const relative = yield* result
          .uploadInputFile({ cwd: "work", fileName: "a.txt", dataBase64: data })
          .pipe(Effect.flip);
        expect(relative.reason).toBe("invalid");
        const missing = yield* result
          .uploadInputFile({ cwd: path.join(baseDir, "nope"), fileName: "a.txt", dataBase64: data })
          .pipe(Effect.flip);
        expect(missing.reason).toBe("not-found");
        expect(ZenOffice.safeUploadName("a\\b/c:d?.txt")).toBe("cd.txt");
        expect(ZenOffice.safeUploadName("...")).toBeNull();
      }),
    );

    it.effect("drafting needs the thread store; without it the error is plain", () =>
      withOffice((office) =>
        office.draftWorkflow({ threadId: "t1", locale: "ro" }).pipe(Effect.flip),
      ).pipe(Effect.map(({ result }) => expect(result.reason).toBe("unavailable"))),
    );

    // 0.2.4 on Windows: a missing bundled index made the whole Library a blank error page.
    it.effect("the library still opens, with a notice, when the bundled index cannot be read", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-noindex-" });
        const office = yield* ZenOffice.make({ assetsDir: dir, defaultRegistryUrl: null }).pipe(
          Effect.provide(ServerConfig.ServerConfig.layerTest(dir, dir)),
        );
        const view = yield* office.registry;
        expect(view.notice).toBe(
          "The workflows that come with the app could not be read. Restart Zen Staff to see them again.",
        );
        expect(view.entries).toEqual([]);
      }),
    );

    it.effect("serves a pack's showcase sample: bundled file, https, missing, unsafe", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-sample-" });
        const entry = (id: string, extra: object) => ({
          id,
          name: id,
          description: "d",
          category: "video",
          icon: "video",
          version: "1.0.0",
          author: "Zen",
          kind: "pack",
          path: `packs/${id}`,
          ...extra,
        });
        yield* fs.makeDirectory(path.join(dir, "samples"));
        yield* fs.writeFile(path.join(dir, "samples", "a.mp4"), new Uint8Array([1, 2, 3]));
        yield* fs.writeFileString(path.join(dir, "secret.mp4"), "x");
        const registryPath = path.join(dir, "registry.json");
        yield* fs.writeFileString(
          registryPath,
          JSON.stringify({
            version: 1,
            entries: [
              entry("a", {
                sample: {
                  src: "samples/a.mp4",
                  kind: "video",
                  caption: "Made with a pro voice",
                  i18n: { ro: { caption: "Făcut cu voce profesională" } },
                },
              }),
              entry("b", { sample: { src: "https://cdn.example/b.mp3", kind: "audio" } }),
              entry("c", { sample: { src: "samples/missing.mp4", kind: "video" } }),
              entry("d", { sample: { src: "../secret.mp4", kind: "video" } }),
              entry("pack", {
                workflows: ["one", "two"],
                sample: { src: "https://cdn.example/pack.mp4", kind: "video" },
              }),
              entry("plain", {}),
            ],
          }),
        );
        const office = yield* ZenOffice.make({
          assetsDir: dir,
          registryPath,
          defaultRegistryUrl: null,
        }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(dir, dir)));
        const a = yield* office.sampleMedia({ id: "a" });
        expect(a).toMatchObject({
          kind: "video",
          url: "data:video/mp4;base64,AQID",
          caption: "Made with a pro voice",
          i18n: { ro: { caption: "Făcut cu voce profesională" } },
        });
        expect((yield* office.sampleMedia({ id: "b" }))?.url).toBe("https://cdn.example/b.mp3");
        expect(yield* office.sampleMedia({ id: "c" })).toBeNull();
        expect(yield* office.sampleMedia({ id: "d" })).toBeNull();
        expect(yield* office.sampleMedia({ id: "plain" })).toBeNull();
        // A workflow of a pack shows the pack's sample.
        expect((yield* office.sampleMedia({ id: "two" }))?.url).toBe(
          "https://cdn.example/pack.mp4",
        );
      }),
    );
  });
});
