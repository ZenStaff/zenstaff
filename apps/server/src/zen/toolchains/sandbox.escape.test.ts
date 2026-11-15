// @effect-diagnostics nodeBuiltinImport:off - runs the real bubblewrap launcher against escape attempts.
// Zen Staff: end-to-end check of the Linux tool sandbox (docs/zen-toolchain-security.md, section 3).
// A launcher made by shimFiles runs `node` as the "tool" (node's own folder is its toolchain) and
// tries to leave the sandbox. Skipped where bubblewrap cannot run (macOS, Windows, no bwrap).
// No internet: the network checks use a TCP server on the host's loopback.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { findOnPath } from "./probe.ts";
import { shimFiles, type SandboxPolicy } from "./sandbox.ts";

const bwrap = HostProcess.Platform.defaultValue() === "linux" ? findOnPath("bwrap") : null;
const usable =
  bwrap !== null &&
  NodeChildProcess.spawnSync(
    bwrap,
    ["--unshare-user", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "true"],
    {
      stdio: "ignore",
    },
  ).status === 0;

/** The probe each sandboxed run executes: one JSON line with what it could and could not do. */
const PROBE = String.raw`
const fs = require("node:fs");
const net = require("node:net");
const cp = require("node:child_process");
const [workflowDir, taskDir, secretFile, toolDir, port] = process.argv.slice(2);
const result = {};
const attempt = (name, run) => { try { result[name] = { ok: true, value: run() }; } catch (error) { result[name] = { ok: false, code: error.code ?? String(error.message).slice(0, 80) }; } };
attempt("readWorkflow", () => fs.readFileSync(workflowDir + "/workflow.json", "utf8"));
attempt("writeTask", () => fs.writeFileSync(taskDir + "/out.txt", "result"));
attempt("writeWorkflow", () => fs.writeFileSync(workflowDir + "/evil.txt", "x"));
attempt("writeToolchain", () => fs.writeFileSync(toolDir + "/evil.txt", "x"));
attempt("readSecret", () => fs.readFileSync(secretFile, "utf8"));
attempt("readSecretViaDotDot", () => fs.readFileSync(taskDir + "/../secret/key.txt", "utf8"));
attempt("readSecretViaSymlink", () => fs.readFileSync(taskDir + "/link-to-secret", "utf8"));
attempt("readHostHome", () => fs.readdirSync(process.env.ZEN_TEST_HOST_HOME));
attempt("readSshDir", () => fs.readdirSync(process.env.ZEN_TEST_HOST_HOME + "/.ssh"));
attempt("readEtcShadow", () => fs.readFileSync("/etc/shadow", "utf8"));
attempt("readEtcPasswd", () => fs.readFileSync("/etc/passwd", "utf8"));
attempt("hostPids", () => fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name)).length);
attempt("uid", () => process.getuid());
attempt("capEff", () => /CapEff:\s*(\w+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]);
attempt("remountToolchain", () => cp.execFileSync("mount", ["-o", "remount,rw,bind", toolDir], { stdio: "pipe" }).toString());
attempt("writeToolchainAfterRemount", () => fs.writeFileSync(toolDir + "/evil2.txt", "x"));
attempt("netInterfaces", () => Object.keys(require("node:os").networkInterfaces()));
require("node:dns").lookup("localhost", { family: 4 }, (error, address) => {
result.lookupLocalhost = error ? { ok: false, code: error.code } : { ok: true, value: address };
const socket = net.connect({ host: "127.0.0.1", port: Number(port) });
socket.setTimeout(1500);
const done = (net) => { result.loopback = net; process.stdout.write(JSON.stringify(result) + "\n"); process.exit(0); };
socket.on("connect", () => { socket.end(); done({ ok: true }); });
socket.on("error", (error) => done({ ok: false, code: error.code }));
socket.on("timeout", () => done({ ok: false, code: "TIMEOUT" }));
});
`;

type Attempt = { readonly ok: boolean; readonly value?: unknown; readonly code?: string };

describe.runIf(usable)("bubblewrap tool sandbox: escape attempts", () => {
  let root = "";
  let server: NodeNet.Server;
  let port = 0;
  // A toolchain folder of our own holding a copy of node, so a regression never writes elsewhere.
  let toolDir = "";
  let toolNode = "";

  beforeAll(async () => {
    root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-sandbox-escape-"));
    for (const dir of ["workflow", "task", "secret", "bin", "toolchain/bin"]) {
      NodeFS.mkdirSync(NodePath.join(root, dir), { recursive: true });
    }
    toolDir = NodePath.join(root, "toolchain");
    toolNode = NodePath.join(toolDir, "bin", "node");
    try {
      NodeFS.linkSync(process.execPath, toolNode);
    } catch {
      NodeFS.copyFileSync(process.execPath, toolNode);
    }
    NodeFS.writeFileSync(NodePath.join(root, "workflow", "workflow.json"), '{"id":"demo"}');
    NodeFS.writeFileSync(NodePath.join(root, "workflow", "probe.cjs"), PROBE);
    NodeFS.writeFileSync(NodePath.join(root, "secret", "key.txt"), "TOP-SECRET");
    NodeFS.symlinkSync(
      NodePath.join(root, "secret", "key.txt"),
      NodePath.join(root, "task", "link-to-secret"),
    );
    server = NodeNet.createServer((socket) => socket.end());
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    port = (server.address() as NodeNet.AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    NodeFS.rmSync(root, { recursive: true, force: true });
  });

  const run = (network: boolean): Record<string, Attempt> => {
    const policy: SandboxPolicy = {
      kind: "bwrap",
      platform: "linux",
      workDir: NodePath.join(root, "task"),
      readOnlyDirs: [toolDir, NodePath.join(root, "workflow")],
      network,
      env: { ZEN_TEST_HOST_HOME: NodeOS.homedir() },
    };
    const [shim] = shimFiles({ name: "tool", command: [toolNode] }, policy, bwrap);
    const launcher = NodePath.join(root, "bin", network ? "tool-net" : "tool");
    NodeFS.writeFileSync(launcher, shim!.content, { mode: shim!.mode });
    const output = NodeChildProcess.execFileSync(
      launcher,
      [
        NodePath.join(root, "workflow", "probe.cjs"),
        NodePath.join(root, "workflow"),
        NodePath.join(root, "task"),
        NodePath.join(root, "secret", "key.txt"),
        toolDir,
        String(port),
      ],
      { cwd: NodePath.join(root, "task"), encoding: "utf8", timeout: 20_000 },
    );
    return JSON.parse(output.trim().split("\n").at(-1)!) as Record<string, Attempt>;
  };

  it("reads only its toolchain and the workflow folder, writes only the task folder", () => {
    const result = run(false);
    expect(result.readWorkflow).toEqual({ ok: true, value: '{"id":"demo"}' });
    expect(result.writeTask?.ok).toBe(true);
    expect(NodeFS.readFileSync(NodePath.join(root, "task", "out.txt"), "utf8")).toBe("result");
    expect(result.writeWorkflow).toMatchObject({ ok: false, code: "EROFS" });
    expect(result.writeToolchain?.ok).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(root, "workflow", "evil.txt"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(toolDir, "evil.txt"))).toBe(false);
    // Files next to the task folder, symlinks out of it, the home folder and SSH keys are absent.
    for (const name of [
      "readSecret",
      "readSecretViaDotDot",
      "readSecretViaSymlink",
      "readSshDir",
      "readEtcShadow",
      "readEtcPasswd",
    ]) {
      expect(result[name], name).toMatchObject({ ok: false, code: "ENOENT" });
    }
    // The home folder exists inside only as the path to a mounted folder, never its contents.
    const home = result.readHostHome;
    if (home?.ok) {
      for (const entry of home.value as string[]) {
        const inside = NodePath.join(NodeOS.homedir(), entry);
        expect(
          [root].some((dir) => dir === inside || dir.startsWith(`${inside}/`)),
          entry,
        ).toBe(true);
      }
    }
  });

  it("is never root, has no capabilities and cannot remount or nest namespaces", () => {
    const result = run(false);
    expect(result.uid).toEqual({ ok: true, value: 65534 });
    expect(result.capEff).toEqual({ ok: true, value: "0000000000000000" });
    expect(result.remountToolchain?.ok).toBe(false);
    expect(result.writeToolchainAfterRemount?.ok).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(toolDir, "evil2.txt"))).toBe(false);
    // Only the sandbox's own processes are visible (new PID namespace).
    expect(result.hostPids?.ok).toBe(true);
    expect(Number(result.hostPids?.value)).toBeLessThan(5);
  });

  it("lets one tool call another tool's launcher inside the same sandbox", () => {
    const bin = NodePath.join(root, "bin");
    const policy: SandboxPolicy = {
      kind: "bwrap",
      platform: "linux",
      workDir: NodePath.join(root, "task"),
      readOnlyDirs: [toolDir, NodePath.join(root, "workflow"), bin],
      network: false,
      env: { ZEN_TOOL_INNER: NodePath.join(bin, "inner") },
    };
    const inner = shimFiles(
      {
        name: "inner",
        command: [toolNode, "-e", "process.stdout.write('inner uid ' + process.getuid())"],
      },
      policy,
      bwrap,
    )[0]!;
    const outer = shimFiles({ name: "outer", command: [toolNode] }, policy, bwrap)[0]!;
    NodeFS.writeFileSync(NodePath.join(bin, "inner"), inner.content, { mode: inner.mode });
    NodeFS.writeFileSync(NodePath.join(bin, "outer"), outer.content, { mode: outer.mode });
    const output = NodeChildProcess.execFileSync(
      NodePath.join(bin, "outer"),
      [
        "-e",
        "const r = require('node:child_process').spawnSync(process.env.ZEN_TOOL_INNER, [], { encoding: 'utf8' }); process.stdout.write(JSON.stringify({ status: r.status, error: r.error?.code ?? null, out: r.stdout }));",
      ],
      { cwd: NodePath.join(root, "task"), encoding: "utf8", timeout: 20_000 },
    );
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      status: 0,
      error: null,
      out: "inner uid 65534",
    });
  });

  it("has no network unless the workflow declares it", () => {
    const offline = run(false);
    // `localhost` still resolves offline: Remotion fetches from its own loopback server by name.
    expect(offline.lookupLocalhost).toEqual({ ok: true, value: "127.0.0.1" });
    expect(offline.loopback?.ok).toBe(false);
    expect(offline.netInterfaces?.value).toEqual(["lo"]);
    const online = run(true);
    expect(online.loopback).toEqual({ ok: true });
    // Declaring network does not widen file access.
    expect(online.readSecret).toMatchObject({ ok: false, code: "ENOENT" });
    expect(online.writeWorkflow).toMatchObject({ ok: false, code: "EROFS" });
  });
});
