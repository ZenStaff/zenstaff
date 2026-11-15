// Zen Staff: with the one-line installers published, `zs install` from a CLI that cannot link
// itself names them. See ZEN.md "CLI command" (One-line installer).
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ZEN_CLI_INSTALL_PS1_TARGET,
  ZEN_CLI_INSTALL_PS1_URL,
  ZEN_CLI_INSTALL_SH_TARGET,
  ZEN_CLI_INSTALL_SH_URL,
} from "@t3tools/contracts/zen";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { installCli } from "../../cli/install.ts";

it("publishes the installers at their target URLs", () => {
  assert.equal(ZEN_CLI_INSTALL_SH_URL, "https://zenstaff.app/install.sh");
  assert.equal(ZEN_CLI_INSTALL_PS1_URL, "https://zenstaff.app/install.ps1");
  assert.equal(ZEN_CLI_INSTALL_SH_URL, ZEN_CLI_INSTALL_SH_TARGET);
  assert.equal(ZEN_CLI_INSTALL_PS1_URL, ZEN_CLI_INSTALL_PS1_TARGET);
});

it.layer(NodeServices.layer)("zs install outside a standalone runtime", (it) => {
  it.effect.each([
    { platform: "linux", line: "curl -fsSL https://zenstaff.app/install.sh | sh" },
    { platform: "darwin", line: "curl -fsSL https://zenstaff.app/install.sh | sh" },
    { platform: "win32", line: "irm https://zenstaff.app/install.ps1 | iex" },
  ] as const)("names the $platform one-liner", ({ platform, line }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(installCli());
      assert.equal(
        error.message,
        `Only the standalone zs can install itself. Use \`${line}\`, or Settings in the desktop app.`,
      );
    }).pipe(
      Effect.provideService(HostProcess.Platform, platform),
      Effect.provideService(HostProcess.HomeDirectory, "/home/zen"),
      Effect.provideService(HostProcess.IsExecutable, false),
      Effect.provideService(HostProcess.ExecutablePath, "/usr/bin/node"),
      Effect.provideService(HostProcess.Environment, { PATH: "/usr/bin" }),
    ),
  );
});
