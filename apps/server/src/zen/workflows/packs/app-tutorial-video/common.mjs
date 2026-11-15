// Shared helpers for the tutorial scripts: arguments, tools, the browser, fonts and cards.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

export const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

export function options(argv) {
  const args = argv.slice(2);
  return {
    command: args[0],
    get: (name, fallback) => {
      const index = args.indexOf(`--${name}`);
      return index >= 0 ? args[index + 1] : fallback;
    },
    has: (name) => args.includes(`--${name}`),
  };
}

export const tool = (name) =>
  process.env[`ZEN_TOOL_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`] || name;

export function run(command, args, { input, allowFail = false, cwd } = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    encoding: input === undefined ? "utf8" : undefined,
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) fail(`${NodePath.basename(command)} could not start: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) {
    const err = String(result.stderr ?? "")
      .trim()
      .split("\n")
      .slice(-3)
      .join(" | ");
    fail(`${NodePath.basename(command)} failed: ${err}`);
  }
  return result;
}

export function loadPlaywright() {
  const modules = process.env.ZEN_PLAYWRIGHT_MODULES;
  const chrome = process.env.ZEN_CHROME;
  if (!modules || !NodeFS.existsSync(modules) || !chrome || !NodeFS.existsSync(chrome)) {
    fail(
      "The browser tools are not prepared (ZEN_PLAYWRIGHT_MODULES / ZEN_CHROME are not set). Start the task from Zen Staff.",
    );
  }
  const require = NodeModule.createRequire(NodePath.join(modules, "zen.cjs"));
  return { chromium: require("playwright-core").chromium, chrome };
}

export const FORMATS = {
  landscape: {
    viewport: { width: 1280, height: 720 },
    scale: 1.5,
    size: [1920, 1080],
    mobile: false,
  },
  vertical: { viewport: { width: 432, height: 768 }, scale: 2.5, size: [1080, 1920], mobile: true },
};
