import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as CliSessionImport from "./CliSessionImport.ts";
import * as ZenCliSessions from "./ZenCliSessions.ts";

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const SDK = "33333333-3333-4333-8333-333333333333";
const EMPTY = "44444444-4444-4444-8444-444444444444";

const userLine = (input: {
  readonly sessionId: string;
  readonly cwd: string;
  readonly text: string;
  readonly entrypoint?: string;
  readonly timestamp?: string;
}) =>
  JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content: input.text },
    timestamp: input.timestamp ?? "2026-11-01T10:00:00.000Z",
    entrypoint: input.entrypoint ?? "cli",
    cwd: input.cwd,
    sessionId: input.sessionId,
    gitBranch: "main",
  });

const answerLine = (sessionId: string, cwd: string, text: string) =>
  JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    message: { role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "text", text }] },
    type: "assistant",
    timestamp: "2026-11-01T10:00:05.000Z",
    entrypoint: "cli",
    cwd,
    sessionId,
  });

interface Fixture {
  readonly claudeHome: string;
  readonly workspace: string;
  readonly transcript: (sessionId: string, project?: string) => string;
}

const writeFile = Effect.fn("ZenCliSessions.test.writeFile")(function* (
  filePath: string,
  lines: ReadonlyArray<string>,
  mtimeSeconds: number,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, `${lines.join("\n")}\n`);
  yield* fileSystem.utimes(filePath, mtimeSeconds, mtimeSeconds);
});

const makeFixture = Effect.fn("ZenCliSessions.test.makeFixture")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-cli-sessions-" });
  const claudeHome = path.join(root, "claude");
  const workspace = path.join(root, "work", "horeca");
  yield* fileSystem.makeDirectory(workspace, { recursive: true });
  const fixture: Fixture = {
    claudeHome,
    workspace,
    transcript: (sessionId, project = "-work-horeca") =>
      path.join(claudeHome, "projects", project, `${sessionId}.jsonl`),
  };
  yield* writeFile(
    fixture.transcript(OLD, "-work-old"),
    [userLine({ sessionId: OLD, cwd: workspace, text: "Configurează backup-ul Supabase" })],
    1_700_000_000,
  );
  yield* writeFile(
    fixture.transcript(NEW),
    [
      userLine({ sessionId: NEW, cwd: workspace, text: "Generează ședința de inventar" }),
      answerLine(NEW, workspace, "Am adăugat exportul PDF pentru inventar."),
      JSON.stringify({ type: "ai-title", aiTitle: "Inventar lunar", sessionId: NEW }),
    ],
    1_700_000_300,
  );
  yield* writeFile(
    fixture.transcript(SDK),
    [
      userLine({
        sessionId: SDK,
        cwd: workspace,
        text: "Scrie articolul de blog",
        entrypoint: "sdk-cli",
      }),
    ],
    1_700_000_200,
  );
  yield* writeFile(
    fixture.transcript(EMPTY),
    [JSON.stringify({ type: "permission-mode", permissionMode: "default", sessionId: EMPTY })],
    1_700_000_400,
  );
  // Subagent transcripts sit below the session folder and are not sessions of their own.
  yield* writeFile(
    path.join(claudeHome, "projects", "-work-horeca", NEW, "subagents", "agent-a1.jsonl"),
    [userLine({ sessionId: NEW, cwd: workspace, text: "subagent task" })],
    1_700_000_500,
  );
  return fixture;
});

const layerFor = (
  fixture: Fixture,
  imports: Ref.Ref<ReadonlyArray<CliSessionImport.CliSessionImportInput>>,
  baseDir: string,
) =>
  ZenCliSessions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CliSessionImport.CliSessionImport)({
          importSession: (input) =>
            Ref.update(imports, (all) => [...all, input]).pipe(
              Effect.as({
                threadId: ThreadId.make(`import:${input.providerInstanceId}:${input.sessionId}`),
                projectId: ProjectId.make("project-1"),
                created: true,
              }),
            ),
        }),
        ServerSettings.layerTest({
          providerInstances: {
            [ProviderInstanceId.make("claudeAgent")]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              config: { homePath: fixture.claudeHome },
            },
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: { homePath: `${fixture.claudeHome}/no-codex` },
            },
          },
        }),
        ServerConfig.layerTest(fixture.workspace, baseDir),
      ),
    ),
  );

const withService = <A, E, R>(
  fixture: Fixture,
  baseDir: string,
  body: (
    service: ZenCliSessions.ZenCliSessions["Service"],
    imports: Ref.Ref<ReadonlyArray<CliSessionImport.CliSessionImportInput>>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const imports = yield* Ref.make<ReadonlyArray<CliSessionImport.CliSessionImportInput>>([]);
    return yield* Effect.gen(function* () {
      return yield* body(yield* ZenCliSessions.ZenCliSessions, imports);
    }).pipe(Effect.provide(layerFor(fixture, imports, baseDir)));
  });

const tempBaseDir = Effect.fn("ZenCliSessions.test.tempBaseDir")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-cli-sessions-state-" });
});

it.layer(Layer.mergeAll(NodeServices.layer, SqlitePersistence.layerMemory))(
  "ZenCliSessions",
  (it) => {
    describe("list", () => {
      it.effect("lists sessions newest first, without empty or subagent transcripts", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const result = yield* withService(fixture, baseDir, (service) => service.list({}));
          expect(result.sessions.map((session) => session.sessionId)).toEqual([NEW, SDK, OLD]);
          expect(result.matchedCount).toBe(3);
          expect(result.sessions[0]).toMatchObject({
            title: "Inventar lunar",
            cwd: fixture.workspace,
            gitBranch: "main",
            origin: "terminal",
            client: "cli",
            messageCount: 2,
            threadId: null,
            lastActivityAt: "2023-11-14T22:18:20.000Z",
          });
          const terminalOnly = yield* withService(fixture, baseDir, (service) =>
            service.list({ origins: ["terminal"] }),
          );
          expect(terminalOnly.sessions.map((session) => session.sessionId)).toEqual([NEW, OLD]);
        }),
      );

      it.effect("searches titles before content, with a snippet for content hits", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const byTitle = yield* withService(fixture, baseDir, (service) =>
            service.list({ query: "inventar" }),
          );
          expect(byTitle.sessions.map((session) => [session.sessionId, session.snippet])).toEqual([
            [NEW, undefined],
          ]);
          const byContent = yield* withService(fixture, baseDir, (service) =>
            service.list({ query: "export pdf" }),
          );
          expect(byContent.sessions).toHaveLength(1);
          expect(byContent.sessions[0]?.snippet).toContain("exportul PDF");
          const none = yield* withService(fixture, baseDir, (service) =>
            service.list({ query: "subagent" }),
          );
          expect(none.sessions).toEqual([]);
        }),
      );

      it.effect("reads only appended lines on the next refresh", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const fileSystem = yield* FileSystem.FileSystem;
          yield* withService(fixture, baseDir, (service) =>
            Effect.gen(function* () {
              expect((yield* service.list({ query: "facturi" })).sessions).toEqual([]);
              yield* fileSystem.writeFileString(
                fixture.transcript(NEW),
                `${userLine({ sessionId: NEW, cwd: fixture.workspace, text: "Acum facturile restante" })}\n`,
                { flag: "a" },
              );
              // Within the refresh window the previous walk is reused.
              expect((yield* service.list({ query: "facturi" })).sessions).toEqual([]);
              yield* TestClock.adjust("5 seconds");
              const after = yield* service.list({ query: "facturi" });
              expect(
                after.sessions.map((session) => [session.sessionId, session.messageCount]),
              ).toEqual([[NEW, 3]]);
            }),
          );
        }),
      );

      it.effect("hides sessions a thread already continues unless asked", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const sql = yield* SqlClient.SqlClient;
          const now = "2026-11-01T00:00:00.000Z";
          yield* sql`
          INSERT INTO orchestration_v2_projection_threads
            (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
          VALUES ('thread-owner', 'project-1', 'Owner', 'claudeAgent', 'full-access', 'default', ${now}, ${now}, '{}')
        `;
          yield* sql`
          INSERT INTO orchestration_v2_projection_provider_threads
            (provider_thread_id, thread_id, provider, status, updated_at, payload_json, driver, provider_instance_id)
          VALUES ('pt-owner', 'thread-owner', 'claudeAgent', 'idle', ${now},
            ${JSON.stringify({ nativeThreadRef: { driver: "claudeAgent", nativeId: NEW, strength: "strong" } })},
            'claudeAgent', 'claudeAgent')
        `;
          const hidden = yield* withService(fixture, baseDir, (service) => service.list({}));
          expect(hidden.sessions.map((session) => session.sessionId)).toEqual([SDK, OLD]);
          const shown = yield* withService(fixture, baseDir, (service) =>
            service.list({ includeOwned: true }),
          );
          expect(shown.sessions[0]).toMatchObject({ sessionId: NEW, threadId: "thread-owner" });
          yield* sql`DELETE FROM orchestration_v2_projection_provider_threads WHERE provider_thread_id = 'pt-owner'`;
          yield* sql`DELETE FROM orchestration_v2_projection_threads WHERE thread_id = 'thread-owner'`;
        }),
      );

      it.effect("keeps the index between restarts, readable only by its owner", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* withService(fixture, baseDir, (service) => service.list({}));
          const stateDir = yield* Effect.provide(
            Effect.gen(function* () {
              const config = yield* ServerConfig.ServerConfig;
              return config.stateDir;
            }),
            ServerConfig.layerTest(fixture.workspace, baseDir),
          );
          const info = yield* fileSystem.stat(
            path.join(stateDir, "zen", "cli-sessions-index.json"),
          );
          if ((yield* HostProcess.Platform) !== "win32") expect(info.mode & 0o777).toBe(0o600);
          const again = yield* withService(fixture, baseDir, (service) => service.list({}));
          expect(again.sessions.map((session) => session.sessionId)).toEqual([NEW, SDK, OLD]);
        }),
      );
    });

    describe("resume", () => {
      it.effect("hands the session's folder, title and recent messages to the import", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const imported = yield* withService(fixture, baseDir, (service, imports) =>
            Effect.gen(function* () {
              const result = yield* service.resume({ provider: "claudeAgent", sessionId: NEW });
              expect(result).toEqual({
                threadId: `import:claudeAgent:${NEW}`,
                projectId: "project-1",
                created: true,
              });
              return yield* Ref.get(imports);
            }),
          );
          expect(imported).toHaveLength(1);
          expect(imported[0]).toMatchObject({
            provider: "claudeAgent",
            providerInstanceId: "claudeAgent",
            sessionId: NEW,
            ownerThreadId: null,
            cwd: fixture.workspace,
            title: "Inventar lunar",
            model: "claude-sonnet-4-5",
            omittedMessageCount: 0,
          });
          expect(
            imported[0]?.entries.map((entry) =>
              entry.kind === "message" ? entry.role : entry.name,
            ),
          ).toEqual(["user", "assistant"]);
        }),
      );

      it.effect("refuses sessions whose folder is gone or that are unknown", () =>
        Effect.gen(function* () {
          const fixture = yield* makeFixture();
          const baseDir = yield* tempBaseDir();
          const fileSystem = yield* FileSystem.FileSystem;
          yield* fileSystem.remove(fixture.workspace, { recursive: true });
          const errors = yield* withService(fixture, baseDir, (service) =>
            Effect.all([
              service.resume({ provider: "claudeAgent", sessionId: NEW }).pipe(Effect.flip),
              service.resume({ provider: "claudeAgent", sessionId: "missing" }).pipe(Effect.flip),
            ]),
          );
          expect(errors.map((error) => error.reason)).toEqual([
            "missing-directory",
            "session-not-found",
          ]);
        }),
      );
    });
  },
);
