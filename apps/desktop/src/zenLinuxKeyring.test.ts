import { afterEach, describe, expect, it } from "vite-plus/test";

import { ZEN_LINUX_WM_CLASS } from "@t3tools/contracts/zen";

import { ZEN_LINUX_DESKTOP_ENTRY_NAMES } from "./zen.ts";
import {
  classifyProbe,
  probeSecretService,
  resetZenKeyringFallback,
  shouldUseBasicStore,
  withZenKeyringFallback,
  zenKeyringFallbackReason,
  zenKeyringNoticeText,
  type ZenProbeRun,
  type ZenProbeRunner,
} from "./zenLinuxKeyring.ts";

const ok = (stdout: string): ZenProbeRun => ({ status: 0, stdout, stderr: "", errorCode: null });
const failed = (stderr: string): ZenProbeRun => ({
  status: 1,
  stdout: "",
  stderr,
  errorCode: null,
});
const missing: ZenProbeRun = { status: null, stdout: "", stderr: "", errorCode: "ENOENT" };
const timedOut: ZenProbeRun = { status: null, stdout: "", stderr: "", errorCode: "ETIMEDOUT" };

describe("zenLinuxKeyring", () => {
  afterEach(() => resetZenKeyringFallback());

  it("reads gdbus and busctl answers", () => {
    expect(classifyProbe(ok("(<false>,)\n"))).toBe("unlocked");
    expect(classifyProbe(ok("(<true>,)\n"))).toBe("locked");
    expect(classifyProbe(ok("b true\n"))).toBe("locked");
    expect(classifyProbe(ok("b false\n"))).toBe("unlocked");
    expect(classifyProbe(timedOut)).toBe("timeout");
    expect(
      classifyProbe(
        failed(
          "Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets was not provided by any .service files",
        ),
      ),
    ).toBe("unavailable");
    expect(classifyProbe(failed("Error: GDBus.Error:org.freedesktop.DBus.Error.NoReply"))).toBe(
      "timeout",
    );
    expect(classifyProbe(failed("something else"))).toBe("unknown");
  });

  it("falls back to busctl when gdbus is not installed, and gives up when neither is", () => {
    const calls: string[] = [];
    const busctlOnly: ZenProbeRunner = (command) => {
      calls.push(command);
      return command === "gdbus" ? missing : ok("b true");
    };
    expect(probeSecretService(busctlOnly)).toBe("locked");
    expect(calls).toEqual(["gdbus", "busctl"]);
    expect(probeSecretService(() => missing)).toBe("unknown");
  });

  it("uses the basic store only for the automatic choice and never on KDE", () => {
    const gnome = { XDG_CURRENT_DESKTOP: "GNOME" };
    const locked = () => "locked" as const;
    expect(
      shouldUseBasicStore({ preference: "auto", passwordStore: null, env: gnome, probe: locked }),
    ).toBe("locked");
    expect(
      shouldUseBasicStore({
        preference: "auto",
        passwordStore: "gnome-libsecret",
        env: { XDG_CURRENT_DESKTOP: "LXQt" },
        probe: () => "timeout",
      }),
    ).toBe("timeout");
    // The person chose the keyring in Settings: keep it.
    expect(
      shouldUseBasicStore({
        preference: "gnome-libsecret",
        passwordStore: "gnome-libsecret",
        env: gnome,
        probe: locked,
      }),
    ).toBeNull();
    expect(
      shouldUseBasicStore({
        preference: "auto",
        passwordStore: null,
        env: { XDG_CURRENT_DESKTOP: "KDE" },
        probe: locked,
      }),
    ).toBeNull();
    for (const probe of ["unlocked", "unknown"] as const) {
      expect(
        shouldUseBasicStore({
          preference: "auto",
          passwordStore: null,
          env: gnome,
          probe: () => probe,
        }),
      ).toBeNull();
    }
  });

  it("switches the early options to the basic store once and remembers why", () => {
    let probes = 0;
    const run: ZenProbeRunner = () => {
      probes += 1;
      return timedOut;
    };
    const options = { isDevelopment: false, passwordStore: null };
    const input = { preference: "auto" as const, env: { XDG_CURRENT_DESKTOP: "GNOME" } };
    expect(withZenKeyringFallback(options, input, run).passwordStore).toBe("basic");
    expect(withZenKeyringFallback(options, input, run).passwordStore).toBe("basic");
    expect(probes).toBe(1);
    expect(zenKeyringFallbackReason()).toBe("timeout");
  });

  it("keeps the options when the keyring answers", () => {
    const options = { passwordStore: "gnome-libsecret" as const };
    const input = { preference: "auto" as const, env: {} };
    expect(withZenKeyringFallback(options, input, () => ok("(<false>,)"))).toBe(options);
    expect(zenKeyringFallbackReason()).toBeNull();
  });

  it("explains the fallback in Romanian and English", () => {
    expect(zenKeyringNoticeText("ro-RO", "locked").body).toContain("blocat");
    expect(zenKeyringNoticeText("en-US", "timeout").body).toContain("did not answer");
  });

  it("names the desktop entry after the window class", () => {
    expect(ZEN_LINUX_DESKTOP_ENTRY_NAMES.production).toBe(`${ZEN_LINUX_WM_CLASS}.desktop`);
  });
});
