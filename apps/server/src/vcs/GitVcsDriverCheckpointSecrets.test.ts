// Zen Staff: checkpoints skip untracked secret files (ZEN.md "Checkpoints skip secret files").
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { assert, it } from "@effect/vitest";

import { CheckpointRef } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";

const layerGit = Layer.mergeAll(GitVcsDriver.layerVcs, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-checkpoint-secrets-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const makeRepo = Effect.fn("makeRepo")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.makeVcsDriverShape();
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix });
  const git = (args: ReadonlyArray<string>, stdin?: string) =>
    driver.execute({
      operation: "checkpoint-secrets-test",
      cwd,
      args,
      ...(stdin !== undefined ? { stdin } : {}),
    });
  const write = (file: string, contents: string) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.dirname(path.join(cwd, file)), { recursive: true });
      yield* fileSystem.writeFileString(path.join(cwd, file), contents);
    });
  const read = (file: string) => fileSystem.readFileString(path.join(cwd, file));
  const exists = (file: string) => fileSystem.exists(path.join(cwd, file));
  yield* git(["init"]);
  yield* git(["config", "user.name", "Test"]);
  yield* git(["config", "user.email", "test@test.com"]);
  yield* write("file.txt", "initial\n");
  yield* write(".env.tracked", "TRACKED=1\n");
  yield* git(["add", "."]);
  yield* git(["commit", "-m", "initial"]);
  const filesIn = (ref: string) =>
    git(["ls-tree", "-r", "-z", "--name-only", ref]).pipe(
      Effect.map((result) => result.stdout.split("\0").filter((file) => file.length > 0)),
    );
  const hasObject = (contents: string) =>
    Effect.gen(function* () {
      const oid = (yield* git(["hash-object", "--stdin"], contents)).stdout.trim();
      const probe = yield* driver.execute({
        operation: "checkpoint-secrets-test",
        cwd,
        args: ["cat-file", "-e", oid],
        allowNonZeroExit: true,
      });
      return probe.exitCode === 0;
    });
  return { driver, cwd, git, write, read, exists, filesIn, hasObject };
});

const SECRET_FILES = {
  ".env": "API_KEY=live-env\n",
  ".env.bak-20261108-cf": "API_KEY=live-backup\n",
  "keys/id_ed25519": "PRIVATE KEY\n",
  "sub/server.pem": "PEM KEY\n",
  "sub/service-account-prod.json": '{"private_key":"x"}\n',
  ".npmrc": "//registry.npmjs.org/:_authToken=npm-token\n",
} as const;

it.effect("checkpoints leave untracked secret files out of the tree and the object database", () =>
  Effect.gen(function* () {
    const repo = yield* makeRepo("t3-checkpoint-secrets-capture-");
    for (const [file, contents] of Object.entries(SECRET_FILES)) yield* repo.write(file, contents);
    yield* repo.write(".env.example", "API_KEY=\n");
    yield* repo.write("notes.txt", "note\n");
    yield* repo.write(".env.tracked", "TRACKED=2\n");
    const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/secrets");

    yield* repo.driver.checkpoints.captureCheckpoint({ cwd: repo.cwd, checkpointRef });

    const files = yield* repo.filesIn(checkpointRef);
    for (const file of Object.keys(SECRET_FILES)) assert.notInclude(files, file);
    for (const contents of Object.values(SECRET_FILES)) {
      assert.isFalse(yield* repo.hasObject(contents), `object stored for ${contents}`);
    }
    assert.includeMembers(files, [".env.example", "notes.txt", "file.txt", ".env.tracked"]);
    // A secret-looking file the repository tracks is captured as before.
    assert.strictEqual(
      (yield* repo.git(["show", `${checkpointRef}:.env.tracked`])).stdout,
      "TRACKED=2\n",
    );
    // The user's own staged changes and untracked files are untouched.
    assert.strictEqual((yield* repo.git(["diff", "--cached", "--name-only"])).stdout, "");
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);

it.effect("checkpoints keep the user's global ignore rules next to the secret rules", () =>
  Effect.gen(function* () {
    const repo = yield* makeRepo("t3-checkpoint-secrets-global-");
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const globalIgnore = path.join(repo.cwd, ".git", "global-ignore");
    yield* fileSystem.writeFileString(globalIgnore, "*.log");
    yield* repo.git(["config", "core.excludesFile", globalIgnore]);
    yield* repo.write("debug.log", "log\n");
    yield* repo.write(".env", "API_KEY=live\n");
    yield* repo.write("kept.txt", "kept\n");
    const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/global");

    yield* repo.driver.checkpoints.captureCheckpoint({ cwd: repo.cwd, checkpointRef });

    const files = yield* repo.filesIn(checkpointRef);
    assert.notInclude(files, "debug.log");
    assert.notInclude(files, ".env");
    assert.include(files, "kept.txt");
    // The scratch excludes file is removed with the scratch index.
    const leftovers = (yield* fileSystem.readDirectory(path.join(repo.cwd, ".git"))).filter(
      (entry) => entry.startsWith("t3-checkpoint-"),
    );
    assert.deepEqual(leftovers, []);
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);

it.effect("restoring a checkpoint leaves untracked secret files alone", () =>
  Effect.gen(function* () {
    const repo = yield* makeRepo("t3-checkpoint-secrets-restore-");
    yield* repo.write(".env", "API_KEY=before\n");
    yield* repo.write(".env.example", "API_KEY=\n");
    const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/restore");
    yield* repo.driver.checkpoints.captureCheckpoint({ cwd: repo.cwd, checkpointRef });

    // The turn: edits the secret, adds new ones, a plain file, and changes tracked files.
    yield* repo.write(".env", "API_KEY=after\n");
    yield* repo.write(".env.local", "API_KEY=local\n");
    yield* repo.write("certs/new.key", "KEY\n");
    yield* repo.write(".env.example", "API_KEY=changed\n");
    yield* repo.write(".env.tracked", "TRACKED=changed\n");
    yield* repo.write("extra.txt", "extra\n");
    // Staged but never committed: in the index, not in the checkpoint.
    yield* repo.write(".env.staged", "API_KEY=staged\n");
    yield* repo.git(["add", ".env.staged"]);

    assert.isTrue(
      yield* repo.driver.checkpoints.restoreCheckpoint({
        cwd: repo.cwd,
        checkpointRef,
        fallbackToHead: false,
      }),
    );

    // Secret files absent from the checkpoint are neither deleted nor overwritten.
    assert.strictEqual(yield* repo.read(".env"), "API_KEY=after\n");
    assert.strictEqual(yield* repo.read(".env.local"), "API_KEY=local\n");
    assert.strictEqual(yield* repo.read("certs/new.key"), "KEY\n");
    assert.strictEqual(yield* repo.read(".env.staged"), "API_KEY=staged\n");
    // Everything else rolls back as before, tracked secret-looking files included.
    assert.strictEqual(yield* repo.read(".env.example"), "API_KEY=\n");
    assert.strictEqual(yield* repo.read(".env.tracked"), "TRACKED=1\n");
    assert.isFalse(yield* repo.exists("extra.txt"));
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);

it.effect("restoring a checkpoint of a subdirectory workspace keeps its secret files", () =>
  Effect.gen(function* () {
    const repo = yield* makeRepo("t3-checkpoint-secrets-nested-");
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* repo.write("app/main.ts", "export {};\n");
    yield* repo.git(["add", "."]);
    yield* repo.git(["commit", "-m", "app"]);
    const cwd = path.join(repo.cwd, "app");
    const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/nested");
    yield* repo.write("app/.env", "API_KEY=before\n");
    yield* repo.driver.checkpoints.captureCheckpoint({ cwd, checkpointRef });
    assert.notInclude(yield* repo.filesIn(checkpointRef), "app/.env");

    yield* repo.write("app/.env", "API_KEY=after\n");
    yield* repo.write("app/.env.staged", "API_KEY=staged\n");
    yield* repo.git(["add", "app/.env.staged"]);
    yield* repo.write("app/main.ts", "changed\n");

    assert.isTrue(
      yield* repo.driver.checkpoints.restoreCheckpoint({
        cwd,
        checkpointRef,
        fallbackToHead: false,
      }),
    );

    assert.strictEqual(yield* repo.read("app/.env"), "API_KEY=after\n");
    assert.strictEqual(yield* repo.read("app/.env.staged"), "API_KEY=staged\n");
    assert.strictEqual(yield* repo.read("app/main.ts"), "export {};\n");
    assert.isTrue(yield* fileSystem.exists(path.join(cwd, ".env")));
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);
