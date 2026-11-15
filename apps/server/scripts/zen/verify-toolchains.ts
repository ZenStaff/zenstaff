// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalTimers:off globalDate:off - Live verification script.
// Zen Staff: verifies the toolchains on a real server, preferably the built bundle:
//   node apps/server/scripts/cli.ts build
//   node apps/server/scripts/zen/verify-toolchains.ts --bin apps/server/dist/bin.mjs \
//     --home /tmp/zen-verify-home --port 3941
// 1. the tool catalog and advisories come from the embedded copy (no source folder next to the
//    bundle), 2. a workflow's tools install from it (pip requirements and recipes included),
// 3. the prepared launchers confine the real tools with bubblewrap (escape attempts fail).
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { startLiveServer } from "./liveServer.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    bin: { type: "string" },
    home: { type: "string" },
    port: { type: "string", default: "3941" },
    workflow: { type: "string", default: "transcribe-recording" },
  },
});
NodeAssert.ok(values.bin && values.home, "--bin and --home are required");
const bin = NodePath.resolve(values.bin);
const home = NodePath.resolve(values.home);
const task = NodePath.join(home, "..", "verify-task");
NodeFS.mkdirSync(task, { recursive: true });
const secret = NodePath.join(home, "..", "verify-secret.txt");
NodeFS.writeFileSync(secret, "TOP-SECRET");

const server = await startLiveServer({
  bin,
  home,
  port: Number(values.port),
  cwd: task,
  log: NodePath.join(home, "..", "verify-server.log"),
});
const report: Record<string, unknown> = { bin };
try {
  const overview = await server.rpc<{
    root: string;
    sandbox: string;
    advisories: { source: string; generatedAt: string | null };
  }>("zen.toolchains.overview", {});
  report.sandbox = overview.sandbox;
  report.advisories = overview.advisories;
  const cacheRoot = NodePath.join(home, "caches", "zen-toolchain-catalog");
  const embedded = NodeFS.existsSync(cacheRoot) ? NodeFS.readdirSync(cacheRoot) : [];
  report.embeddedCatalog = embedded.map((name) => NodePath.join(cacheRoot, name));
  if (bin.endsWith(".mjs")) {
    NodeAssert.equal(embedded.filter((name) => !name.startsWith(".")).length, 1);
    NodeAssert.ok(
      NodeFS.existsSync(NodePath.join(cacheRoot, embedded[0]!, "tools", "ffmpeg.json")),
      "embedded catalog was not written",
    );
  }

  const target = { workflowId: values.workflow, packId: values.workflow, locale: "en" as const };
  const before = await server.rpc<{ status: string; headline: string; install: unknown[] }>(
    "zen.toolchains.checkWorkflow",
    target,
  );
  report.before = { status: before.status, headline: before.headline };
  if (before.status !== "ready") {
    let job = await server.rpc<{ jobId: string; state: string; message: string }>(
      "zen.toolchains.install",
      target,
    );
    const started = Date.now();
    while (job.state === "running") {
      await new Promise((done) => setTimeout(done, 3000));
      job = await server.rpc("zen.toolchains.job", { jobId: job.jobId });
      if (Date.now() - started > 20 * 60_000) throw new Error("install timed out");
    }
    report.install = {
      state: job.state,
      message: job.message,
      seconds: (Date.now() - started) / 1000,
    };
    NodeAssert.equal(job.state, "done", job.message);
  }
  const after = await server.rpc<{ status: string; headline: string }>(
    "zen.toolchains.checkWorkflow",
    target,
  );
  report.after = { status: after.status, headline: after.headline };
  NodeAssert.equal(after.status, "ready");

  const prepared = await server.rpc<{
    appendix: string;
    env: Record<string, string>;
    sandbox: string;
  }>("zen.toolchains.prepareThread", { ...target, threadId: "verify-thread", cwd: task });
  report.prepared = {
    sandbox: prepared.sandbox,
    tools: Object.keys(prepared.env).filter((k) => k.startsWith("ZEN_TOOL_")),
  };
  const ffmpeg = prepared.env.ZEN_TOOL_FFMPEG;
  NodeAssert.ok(ffmpeg, "no ffmpeg launcher");
  const run = (command: string, args: string[]) =>
    NodeChildProcess.spawnSync(command, args, { cwd: task, encoding: "utf8", timeout: 60_000 });
  const checks: Record<string, boolean> = {};
  const made = run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    NodePath.join(task, "tone.wav"),
  ]);
  checks.writesTaskFolder = made.status === 0 && NodeFS.existsSync(NodePath.join(task, "tone.wav"));
  const readSecret = run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "data",
    "-i",
    secret,
    "-map",
    "0",
    "-c",
    "copy",
    "-f",
    "data",
    NodePath.join(task, "leak.bin"),
  ]);
  checks.cannotReadOutside =
    readSecret.status !== 0 && !NodeFS.existsSync(NodePath.join(task, "leak.bin"));
  const outsideOut = NodePath.join(home, "..", "outside.wav");
  const writeOutside = run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=1",
    outsideOut,
  ]);
  // Under /tmp the write may land in the sandbox's private /tmp; it must never reach the host.
  checks.cannotWriteOutside = !NodeFS.existsSync(outsideOut);
  report.writeOutsideExit = writeOutside.status;
  const net = run(ffmpeg, [
    "-v",
    "error",
    "-rw_timeout",
    "3000000",
    "-i",
    "http://1.1.1.1/a.wav",
    "-f",
    "null",
    "-",
  ]);
  checks.noNetwork = net.status !== 0;
  report.networkError = (net.stderr || "").trim().split("\n").at(-1);
  const ssh = run(ffmpeg, [
    "-v",
    "error",
    "-f",
    "data",
    "-i",
    `${process.env.HOME}/.ssh/authorized_keys`,
    "-f",
    "null",
    "-",
  ]);
  checks.noSshKeys = ssh.status !== 0;
  report.checks = checks;
  NodeAssert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
  report.ok = true;
} finally {
  console.log(JSON.stringify(report, null, 2));
  await server.stop();
}
