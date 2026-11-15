import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import { withZenCompanyMemory, zenCompanyMemoryDirectory } from "./companyMemory.ts";
import * as ZenCompanies from "./ZenCompanies.ts";

const PROJECT = ProjectId.make("project-acme");
const OTHER = ProjectId.make("project-other");

const withService = <A, E>(
  baseDir: string,
  use: (service: ZenCompanies.ZenCompanies["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const service = yield* ZenCompanies.ZenCompanies;
    return yield* use(service);
  }).pipe(
    Effect.provide(
      ZenCompanies.layer.pipe(Layer.provide(ServerConfig.layerTest(baseDir, baseDir))),
    ),
  );

it.layer(NodeServices.layer)((it) => {
  describe("ZenCompanies", () => {
    it.effect("creates companies, maps projects and survives a restart", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-companies-" });

        const created = yield* withService(baseDir, (service) =>
          Effect.gen(function* () {
            const acme = yield* service.create({ name: "Acme Corp" });
            yield* service.create({ name: "Beta", memoryDirectory: path.join(baseDir, "beta") });
            yield* service.assignProject({ projectId: PROJECT, companyId: acme.id });
            yield* service.assignThread({
              threadId: ThreadId.make("thread-1"),
              companyId: acme.id,
            });
            return acme;
          }),
        );
        expect(created.memoryDirectory).toBe(
          path.join(baseDir, "companies", "acme-corp", "memory"),
        );
        expect(yield* fileSystem.exists(created.memoryDirectory!)).toBe(true);

        const listed = yield* withService(baseDir, (service) => service.list());
        expect(listed.companies.map((company) => company.id)).toEqual([
          "personal",
          "acme-corp",
          "beta",
        ]);
        expect(listed.projectCompanies).toEqual([{ projectId: PROJECT, companyId: "acme-corp" }]);
        expect(listed.threadCompanies).toEqual([{ threadId: "thread-1", companyId: "acme-corp" }]);

        const storeFile = path.join(baseDir, "userdata", "zen", "companies.json");
        const mode = (yield* fileSystem.stat(storeFile)).mode & 0o777;
        expect(mode).toBe(0o600);
      }),
    );

    it.effect("feeds the Claude adapter hook while the service runs", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-companies-" });
        const memory = path.join(baseDir, "companies", "acme", "memory");

        const settings = yield* withService(baseDir, (service) =>
          Effect.gen(function* () {
            yield* service.create({ name: "Acme" });
            yield* service.assignProject({ projectId: PROJECT, companyId: "acme" });
            return {
              assigned: withZenCompanyMemory(PROJECT, { model: "x" }),
              unassigned: withZenCompanyMemory(OTHER, undefined),
              unassignedWithSettings: withZenCompanyMemory(OTHER, { model: "y" }),
            };
          }),
        );
        expect(settings.assigned).toEqual({
          sdkSettings: { model: "x", autoMemoryDirectory: memory },
        });
        expect(settings.unassigned).toEqual({});
        expect(settings.unassignedWithSettings).toEqual({ sdkSettings: { model: "y" } });
        // The layer's finalizer removes the resolver with the service.
        expect(zenCompanyMemoryDirectory(PROJECT)).toBeNull();
      }),
    );

    it.effect("lists and reads markdown memory files, never outside the directory", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-companies-" });
        const memory = path.join(baseDir, "companies", "acme", "memory");

        const result = yield* withService(baseDir, (service) =>
          Effect.gen(function* () {
            yield* service.create({ name: "Acme" });
            yield* fileSystem.writeFileString(path.join(memory, "MEMORY.md"), "# Index\n");
            yield* fileSystem.writeFileString(path.join(memory, "a-note.md"), "note");
            yield* fileSystem.writeFileString(path.join(memory, "ignored.txt"), "x");
            yield* fileSystem.writeFileString(path.join(baseDir, "secret.md"), "secret");
            yield* fileSystem.symlink(
              path.join(baseDir, "secret.md"),
              path.join(memory, "link.md"),
            );
            const listing = yield* service.listMemory({ companyId: "acme" });
            const index = yield* service.readMemory({
              companyId: "acme",
              relativePath: "MEMORY.md",
            });
            const traversal = yield* service
              .readMemory({ companyId: "acme", relativePath: "../../../secret.md" })
              .pipe(Effect.flip);
            const viaLink = yield* service
              .readMemory({ companyId: "acme", relativePath: "link.md" })
              .pipe(Effect.flip);
            const personal = yield* service.listMemory({ companyId: "personal" });
            return { listing, index, traversal, viaLink, personal };
          }),
        );
        expect(result.listing.exists).toBe(true);
        expect(result.listing.files.map((file) => file.relativePath)).toEqual([
          "MEMORY.md",
          "a-note.md",
          "link.md",
        ]);
        expect(result.index).toMatchObject({ content: "# Index\n", truncated: false });
        expect(result.traversal.reason).toBe("file-not-found");
        expect(result.viaLink.reason).toBe("file-not-found");
        expect(result.personal).toEqual({ directory: null, exists: false, files: [] });
      }),
    );

    it.effect("refuses to delete Personal and reports unknown companies", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-companies-" });
        const errors = yield* withService(baseDir, (service) =>
          Effect.all([
            service.remove({ id: "personal" }).pipe(Effect.flip),
            service.assignProject({ projectId: PROJECT, companyId: "nope" }).pipe(Effect.flip),
            service.create({ name: "Bad", memoryDirectory: "relative/dir" }).pipe(Effect.flip),
          ]),
        );
        expect(errors.map((error) => error.reason)).toEqual([
          "default-company",
          "not-found",
          "invalid-input",
        ]);
      }),
    );
  });
});
