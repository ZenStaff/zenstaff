// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalTimers:off globalDate:off - Live verification script.
// Zen Staff: two-machine "run on the company server" setup on one box. Starts a local zen-hub,
// a runner (company server, tools installed only there) and a laptop (no tools), both signed in
// to the same hub company, and prints the browser pairing links. The browser part (laptop UI,
// add the runner as a connection, start the workflow, read the result in chat) is driven by
// Playwright or by hand. Leaves everything running until Ctrl+C / SIGTERM.
//   node apps/server/scripts/zen/verify-company-server.ts --root <dir> --hub-dir ../hub \
//     --audio <file.wav> [--bin apps/server/dist/bin.mjs]
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { startLiveServer, type LiveServer } from "./liveServer.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    root: { type: "string" },
    "hub-dir": { type: "string", default: "../hub" },
    audio: { type: "string" },
    bin: {
      type: "string",
      default: NodePath.join(import.meta.dirname, "..", "..", "dist", "bin.mjs"),
    },
    "hub-port": { type: "string", default: "3948" },
    "laptop-port": { type: "string", default: "3935" },
    "runner-port": { type: "string", default: "3936" },
    workflow: { type: "string", default: "transcribe-recording" },
    // Runs agents as plain children instead of systemd user scopes (for nested test sessions).
    "no-agent-scopes": { type: "boolean", default: false },
  },
});
NodeAssert.ok(values.root && values.audio, "--root and --audio are required");
const root = NodePath.resolve(values.root);
const bin = NodePath.resolve(values.bin);
NodeFS.mkdirSync(root, { recursive: true });
const hubPort = Number(values["hub-port"]);
const hubUrl = `http://127.0.0.1:${hubPort}`;
const workflow = values.workflow;

// 1. The hub, fresh database, dev outbox for the e-mailed codes.
const hubLog = NodeFS.openSync(NodePath.join(root, "hub.log"), "a");
const hub = NodeChildProcess.spawn(process.execPath, ["src/server.ts"], {
  cwd: values["hub-dir"],
  env: {
    ...process.env,
    PORT: String(hubPort),
    HOST: "127.0.0.1",
    HUB_DB_PATH: NodePath.join(root, "hub.sqlite"),
    HUB_DEV_OUTBOX: "1",
    HUB_PUBLIC_URL: hubUrl,
  },
  stdio: ["ignore", hubLog, hubLog],
});
for (let attempt = 0; ; attempt++) {
  const ok = await fetch(`${hubUrl}/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (ok) break;
  NodeAssert.ok(attempt < 50, "hub did not start");
  await new Promise((done) => setTimeout(done, 200));
}

const outboxCode = async (email: string, pattern: RegExp): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const box = (await (
      await fetch(`${hubUrl}/v1/dev/outbox?email=${encodeURIComponent(email)}`)
    ).json()) as {
      messages: Array<{ text?: string; html?: string; subject?: string }>;
    };
    for (const message of box.messages.toReversed()) {
      const match = pattern.exec(
        `${message.subject ?? ""}\n${message.text ?? ""}\n${message.html ?? ""}`,
      );
      if (match) return match[1]!;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`no e-mail for ${email}`);
};

const { currentStep, totpAt } = (await import(
  NodePath.join(values["hub-dir"], "src", "totp.ts")
)) as {
  currentStep: (now?: number) => number;
  totpAt: (secret: string, step: number) => string;
};

const hubCall = <A = Record<string, unknown>>(
  server: LiveServer,
  op: string,
  input: Record<string, unknown> = {},
) => server.rpc<A>("zen.hub.call", { op, input });

const signIn = async (server: LiveServer, email: string) => {
  await hubCall(server, "signIn.start", { hubUrl, email });
  const code = await outboxCode(email, /\b(\d{6})\b/);
  await hubCall(server, "signIn.verify", { code });
};

const createProject = async (server: LiveServer, folder: string, title: string) => {
  NodeFS.mkdirSync(folder, { recursive: true });
  const response = await fetch(`${server.origin}/api/projects/mutate`, {
    method: "POST",
    headers: server.headers,
    body: JSON.stringify({
      type: "project.create",
      commandId: NodeCrypto.randomUUID(),
      projectId: NodeCrypto.randomUUID(),
      title,
      workspaceRoot: folder,
    }),
  });
  NodeAssert.ok(response.ok, `project.create: ${response.status} ${await response.text()}`);
};

const runner = await startLiveServer({
  bin,
  port: Number(values["runner-port"]),
  home: NodePath.join(root, "runner-home"),
  cwd: root,
  ...(values["no-agent-scopes"] ? { env: { XDG_RUNTIME_DIR: "" } } : {}),
  log: NodePath.join(root, "runner.log"),
});
const laptop = await startLiveServer({
  bin,
  port: Number(values["laptop-port"]),
  home: NodePath.join(root, "laptop-home"),
  cwd: root,
  ...(values["no-agent-scopes"] ? { env: { XDG_RUNTIME_DIR: "" } } : {}),
  log: NodePath.join(root, "laptop.log"),
});
const stopAll = async () => {
  await Promise.allSettled([runner.stop(), laptop.stop()]);
  if (hub.exitCode === null) hub.kill("SIGTERM");
};
process.on("SIGTERM", () => void stopAll().then(() => process.exit(0)));
process.on("SIGINT", () => void stopAll().then(() => process.exit(0)));

const report: Record<string, unknown> = { hubUrl, runner: runner.origin, laptop: laptop.origin };
try {
  // 2. Runner: Alex (owner, two-factor on), company Acme, this machine is its company server.
  await signIn(runner, "alex@acme.test");
  const company = await hubCall<{ id: string }>(runner, "company.create", { name: "Acme" });
  const setup = await hubCall<{ secret: string }>(runner, "twoFactor.setup");
  await hubCall(runner, "twoFactor.enable", { code: totpAt(setup.secret, currentStep()) });
  await hubCall(runner, "runner.set", { companyId: company.id });
  const invite = await hubCall<{ token: string }>(runner, "invite.create", {
    companyId: company.id,
    email: "maria@acme.test",
    role: "member",
  });
  // 3. Laptop: Maria, a member.
  await signIn(laptop, "maria@acme.test");
  await hubCall(laptop, "invite.accept", { token: invite.token });

  // 4. The workflow pack on both; its tools only on the runner.
  for (const server of [runner, laptop])
    await server.rpc("zen.office.installPack", { id: workflow });
  let job = await runner.rpc<{ jobId: string; state: string; message: string }>(
    "zen.toolchains.install",
    {
      workflowId: workflow,
    },
  );
  while (job.state === "running") {
    await new Promise((done) => setTimeout(done, 3000));
    job = await runner.rpc("zen.toolchains.job", { jobId: job.jobId });
  }
  NodeAssert.equal(job.state, "done", job.message);

  // 5. Project folders: the recording lives on the company server.
  const runnerFolder = NodePath.join(root, "runner-projects", "acme-recordings");
  await createProject(runner, runnerFolder, "Acme recordings");
  NodeFS.copyFileSync(values.audio, NodePath.join(runnerFolder, NodePath.basename(values.audio)));
  await createProject(laptop, NodePath.join(root, "laptop-projects", "acme"), "Acme");

  const runnerCheck = await runner.rpc<{ status: string }>("zen.toolchains.checkWorkflow", {
    workflowId: workflow,
  });
  const laptopCheck = await laptop.rpc<{ status: string; headline: string }>(
    "zen.toolchains.checkWorkflow",
    {
      workflowId: workflow,
    },
  );
  const runnerProbe = await runner.rpc<{ companyRunner: boolean }>("zen.toolchains.probe", {});
  report.runnerState = { check: runnerCheck.status, companyRunner: runnerProbe.companyRunner };
  report.laptopCheck = laptopCheck;
  NodeAssert.equal(runnerCheck.status, "ready");
  NodeAssert.equal(runnerProbe.companyRunner, true);
  NodeAssert.notEqual(laptopCheck.status, "ready");

  const pair = (home: string) =>
    NodeChildProcess.execFileSync(
      process.execPath,
      [bin, "pair", "--base-dir", home, "--ttl", "2h"],
      {
        env: { ...process.env, ZEN_HOME: home, T3CODE_HOME: home },
        encoding: "utf8",
      },
    );
  const link = (text: string) => /https?:\/\/\S+\/pair#token=\S+/.exec(text)?.[0] ?? text.trim();
  report.laptopPairing = link(pair(NodePath.join(root, "laptop-home")));
  report.runnerPairing = link(pair(NodePath.join(root, "runner-home")));
  report.runnerFolder = runnerFolder;
  NodeFS.writeFileSync(NodePath.join(root, "setup.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("READY");
} catch (error) {
  console.error(error);
  await stopAll();
  process.exit(1);
}
