// @effect-diagnostics nodeBuiltinImport:off - runs before Electron is ready, outside app services.
// Zen Staff: a locked or missing Linux keyring must not freeze startup. Chromium asks the Secret
// Service (libsecret) for its key synchronously; when the keyring is locked with no prompt, or the
// service never answers, the app sat on its loading spinner. Before ready, while the password
// store is "auto", a short D-Bus probe (2 s) checks the default collection; when it is locked,
// missing or silent, Zen starts with Chromium's basic store and tells the person. ZEN.md, "Linux".
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  LinuxPasswordStorePreference,
  LinuxPasswordStoreSwitch,
} from "./linuxSecretStorage.ts";

export type ZenKeyringProbe = "unlocked" | "locked" | "unavailable" | "timeout" | "unknown";

const ZEN_KEYRING_PROBE_TIMEOUT_MS = 2_000;

export interface ZenProbeRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** "ENOENT" when the tool is not installed, "ETIMEDOUT" on timeout. */
  readonly errorCode: string | null;
}

export type ZenProbeRunner = (command: string, args: ReadonlyArray<string>) => ZenProbeRun;

const DEFAULT_COLLECTION = "/org/freedesktop/secrets/aliases/default";

/** Reads the default collection's Locked property through gdbus, else busctl. */
export function probeSecretService(run: ZenProbeRunner): ZenKeyringProbe {
  const attempts: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    [
      "gdbus",
      [
        "call",
        "--session",
        "--timeout",
        "2",
        "--dest",
        "org.freedesktop.secrets",
        "--object-path",
        DEFAULT_COLLECTION,
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.freedesktop.Secret.Collection",
        "Locked",
      ],
    ],
    [
      "busctl",
      [
        "--user",
        "--timeout=2",
        "get-property",
        "org.freedesktop.secrets",
        DEFAULT_COLLECTION,
        "org.freedesktop.Secret.Collection",
        "Locked",
      ],
    ],
  ];
  for (const [command, args] of attempts) {
    const result = run(command, args);
    if (result.errorCode === "ENOENT") continue;
    return classifyProbe(result);
  }
  return "unknown";
}

/** gdbus prints `(<true>,)`, busctl `b true`; anything else is read from the error text. */
export function classifyProbe(result: ZenProbeRun): ZenKeyringProbe {
  if (result.errorCode === "ETIMEDOUT") return "timeout";
  const out = result.stdout.trim();
  if (result.status === 0) {
    if (/<true>|^b true$/.test(out)) return "locked";
    if (/<false>|^b false$/.test(out)) return "unlocked";
    return "unknown";
  }
  const error = `${result.stderr}\n${out}`;
  if (/Timeout|timed out|NoReply/i.test(error)) return "timeout";
  // No Secret Service on the bus, no session bus, or no default keyring yet (creating one prompts).
  if (
    /ServiceUnknown|NameHasNoOwner|NoSuchObject|UnknownObject|not provided by any|Failed to connect|Cannot autolaunch|DBUS_SESSION_BUS_ADDRESS/i.test(
      error,
    )
  ) {
    return "unavailable";
  }
  return "unknown";
}

/** Only the automatic choice is changed; a store the person picked in Settings is kept. */
export function shouldUseBasicStore(input: {
  readonly preference: LinuxPasswordStorePreference;
  readonly passwordStore: LinuxPasswordStoreSwitch | null;
  readonly env: NodeJS.ProcessEnv;
  readonly probe: () => ZenKeyringProbe;
}): ZenKeyringProbe | null {
  if (input.preference !== "auto") return null;
  // KDE picks KWallet itself; libsecret is what blocks.
  const desktops = (input.env.XDG_CURRENT_DESKTOP ?? "").split(":").map((name) => name.trim());
  if (input.passwordStore === null && desktops.includes("KDE")) return null;
  const probe = input.probe();
  return probe === "locked" || probe === "unavailable" || probe === "timeout" ? probe : null;
}

const nodeRunner: ZenProbeRunner = (command, args) => {
  try {
    const result = NodeChildProcess.spawnSync(command, [...args], {
      encoding: "utf8",
      timeout: ZEN_KEYRING_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024,
    });
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code ?? null;
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      errorCode,
    };
  } catch {
    // Could not spawn at all: treat like a missing tool, so startup goes on unchanged.
    return { status: null, stdout: "", stderr: "", errorCode: "ENOENT" };
  }
};

let fallbackReason: ZenKeyringProbe | null | undefined;

/**
 * Wraps upstream's early Linux options: the same options, with Chromium's "basic" store when the
 * keyring cannot answer. The probe runs once per process (both startup paths call this).
 */
export function withZenKeyringFallback<
  T extends { readonly passwordStore: LinuxPasswordStoreSwitch | null },
>(
  options: T,
  input: { readonly preference: LinuxPasswordStorePreference; readonly env: NodeJS.ProcessEnv },
  run: ZenProbeRunner = nodeRunner,
): T {
  if (fallbackReason === undefined) {
    fallbackReason = shouldUseBasicStore({
      preference: input.preference,
      passwordStore: options.passwordStore,
      env: input.env,
      probe: () => probeSecretService(run),
    });
  }
  if (fallbackReason === null) return options;
  // Electron accepts "basic" (Chromium's plain store); upstream's switch type lists only keyrings.
  return { ...options, passwordStore: "basic" as LinuxPasswordStoreSwitch };
}

/** Why the basic store was chosen in this process, or null. */
export function zenKeyringFallbackReason(): ZenKeyringProbe | null {
  return fallbackReason ?? null;
}

/** For tests. */
export function resetZenKeyringFallback(): void {
  fallbackReason = undefined;
}

export function zenKeyringNoticeText(locale: string, reason: ZenKeyringProbe) {
  const ro = locale.toLowerCase().startsWith("ro");
  const why =
    reason === "locked"
      ? ro
        ? "portofelul de chei al sistemului este blocat"
        : "the system keyring is locked"
      : reason === "timeout"
        ? ro
          ? "portofelul de chei al sistemului nu a răspuns"
          : "the system keyring did not answer"
        : ro
          ? "portofelul de chei al sistemului nu este disponibil"
          : "the system keyring is not available";
  return ro
    ? {
        title: "Zen Staff folosește stocarea simplă a parolelor",
        body: `Pentru că ${why}, conexiunile salvate sunt păstrate fără criptarea sistemului. Deblochează portofelul și repornește aplicația, sau alege stocarea în Setări.`,
      }
    : {
        title: "Zen Staff is using basic password storage",
        body: `Because ${why}, saved connections are kept without the system's encryption. Unlock the keyring and restart the app, or choose the store in Settings.`,
      };
}

/**
 * Shows the notice once per reason (a marker file in the profile), after the app is ready.
 * `notify` is Electron's Notification; it is passed in so this file stays free of Electron.
 */
export function showZenKeyringNoticeOnce(input: {
  readonly userDataPath: string;
  readonly locale: string;
  readonly notify: (title: string, body: string) => void;
}): void {
  const reason = zenKeyringFallbackReason();
  if (reason === null) return;
  const text = zenKeyringNoticeText(input.locale, reason);
  const marker = NodePath.join(input.userDataPath, "zen-keyring-notice");
  try {
    if (NodeFS.readFileSync(marker, "utf8").trim() === reason) return;
  } catch {}
  try {
    input.notify(text.title, text.body);
    NodeFS.writeFileSync(marker, `${reason}\n`, "utf8");
  } catch {}
}
