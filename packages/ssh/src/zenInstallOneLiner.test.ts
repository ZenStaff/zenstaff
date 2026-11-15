// Zen Staff: when an SSH host cannot download the CLI archive, the error names the published
// one-line installer. See ZEN.md "CLI command" (One-line installer).
import { describe, expect, it } from "vite-plus/test";

import { buildRemoteT3RunnerScript } from "./tunnel.ts";

describe("SSH host install with the one-liner published", () => {
  it("names https://zenstaff.app/install.sh in the download error", () => {
    const script = buildRemoteT3RunnerScript({ archiveVersion: "0.2.8" });
    expect(script).toContain(
      "If this host cannot reach it, install zs %s on it with https://zenstaff.app/install.sh (T3CODE_VERSION=%s;",
    );
  });
});
