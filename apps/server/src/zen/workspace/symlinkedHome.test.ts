// Zen Staff: the Files panel through a symlinked home (`/root -> /data/root`, or $HOME a link).
// Agents report symlink-resolved paths while the thread's folder keeps the link's spelling, so
// every way the panel names a file must read it: relative, absolute through either spelling, ~/.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../../workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(
        Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
      ),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
    ),
  ),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "zen-symlinked-home-test-" }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.layer(layerTest, { excludeTestServices: true })("Files panel, symlinked home", (it) => {
  describe("reads", () => {
    it.effect.skipIf(!symlinksSupported || HostProcess.Platform.defaultValue() === "win32")(
      "reads a company file by every spelling when the home folder is a symlink",
      () =>
        Effect.gen(function* () {
          const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
          const entries = yield* WorkspaceEntries.WorkspaceEntries;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const base = yield* fs.makeTempDirectoryScoped({ prefix: "zen-symlinked-home-" });
          const realHome = path.join(base, "data", "root");
          const home = path.join(base, "root");
          const realFolder = path.join(realHome, "Zen Staff", "Firma");
          yield* fs.makeDirectory(path.join(realFolder, "docs"), { recursive: true });
          yield* fs.writeFileString(path.join(realFolder, "afis final.md"), "# Afis\n");
          yield* fs.writeFileString(path.join(realFolder, "docs", "plan.md"), "plan\n");
          yield* fs.symlink(realHome, home);
          const cwd = path.join(home, "Zen Staff", "Firma");
          const withHome = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(Effect.provideService(HostProcess.HomeDirectory, home));

          for (const relativePath of [
            "afis final.md",
            path.join(cwd, "afis final.md"),
            path.join(realFolder, "afis final.md"),
            "~/Zen Staff/Firma/afis final.md",
          ]) {
            const read = yield* withHome(files.readFile({ cwd, relativePath }));
            expect(read.contents, relativePath).toBe("# Afis\n");
          }
          // The physical folder as cwd (what the agent sees) reads the same file.
          const physical = yield* files.readFile({ cwd: realFolder, relativePath: "docs/plan.md" });
          expect(physical.contents).toBe("plan\n");

          const listed = yield* entries.list({ cwd, directoryPath: "docs" });
          expect(listed.entries.map((entry) => entry.path)).toEqual(["docs/plan.md"]);
        }),
    );
  });
});
