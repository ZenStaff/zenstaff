// @effect-diagnostics nodeBuiltinImport:off globalDate:off - plain async code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: the secrets vault for enterprise workflows, on the runner only. Values are encrypted
// (AES-256-GCM) in `<toolchains>/access/vault.json` (mode 600); the key lives in the OS keychain
// when one answers (secret-tool, macOS security, Windows DPAPI), else in `vault.key` (mode 600).
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export type KeyStore = "keychain" | "file";

interface VaultFile {
  readonly version: 1;
  /** `${workflowId}/${secretId}` -> encrypted value. */
  readonly entries: Record<string, { iv: string; tag: string; data: string; at: string }>;
}

const SERVICE = "zen-staff-toolchains-vault";

function run(command: string, args: ReadonlyArray<string>, input?: string): string | null {
  try {
    const result = NodeChildProcess.spawnSync(command, args as string[], {
      input,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** The vault key from the OS keychain, created there on first use; null when none answers. */
function keychainKey(platform: NodeJS.Platform, account: string): Buffer | null {
  const fresh = NodeCrypto.randomBytes(32).toString("base64");
  if (platform === "darwin") {
    const found = run("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    if (found) return Buffer.from(found, "base64");
    if (
      run("security", ["add-generic-password", "-s", SERVICE, "-a", account, "-w", fresh]) === null
    )
      return null;
    return Buffer.from(fresh, "base64");
  }
  if (platform === "linux") {
    const found = run("secret-tool", ["lookup", "service", SERVICE, "account", account]);
    if (found) return Buffer.from(found, "base64");
    if (
      run(
        "secret-tool",
        ["store", "--label", "Zen Staff vault", "service", SERVICE, "account", account],
        fresh,
      ) === null
    ) {
      return null;
    }
    return run("secret-tool", ["lookup", "service", SERVICE, "account", account]) === fresh
      ? Buffer.from(fresh, "base64")
      : null;
  }
  return null;
}

export class SecretVault {
  private readonly file: string;
  private readonly keyFile: string;
  private readonly dpapiFile: string;
  private key: Buffer | null = null;
  keyStore: KeyStore = "file";

  private readonly platform: NodeJS.Platform;
  private readonly useKeychain: boolean;

  constructor(dir: string, platform: NodeJS.Platform, useKeychain = true) {
    this.platform = platform;
    this.useKeychain = useKeychain;
    this.file = NodePath.join(dir, "vault.json");
    this.keyFile = NodePath.join(dir, "vault.key");
    this.dpapiFile = NodePath.join(dir, "vault.key.dpapi");
    NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private loadKey(): Buffer {
    if (this.key) return this.key;
    if (this.useKeychain) {
      const fromKeychain =
        this.platform === "win32" ? this.windowsKey() : keychainKey(this.platform, this.file);
      if (fromKeychain && fromKeychain.length === 32) {
        this.keyStore = "keychain";
        this.key = fromKeychain;
        return fromKeychain;
      }
    }
    if (!NodeFS.existsSync(this.keyFile)) {
      NodeFS.writeFileSync(this.keyFile, NodeCrypto.randomBytes(32).toString("base64"), {
        mode: 0o600,
      });
    }
    NodeFS.chmodSync(this.keyFile, 0o600);
    this.keyStore = "file";
    this.key = Buffer.from(NodeFS.readFileSync(this.keyFile, "utf8").trim(), "base64");
    return this.key;
  }

  /** Windows: the key is protected with DPAPI for the current user (untested). */
  private windowsKey(): Buffer | null {
    const ps = (script: string) =>
      run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    const load =
      "Add-Type -AssemblyName System.Security;" +
      `$b=[IO.File]::ReadAllBytes('${this.dpapiFile}');` +
      "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
    if (NodeFS.existsSync(this.dpapiFile)) {
      const found = ps(load);
      return found ? Buffer.from(found, "base64") : null;
    }
    const fresh = NodeCrypto.randomBytes(32).toString("base64");
    const saved = ps(
      "Add-Type -AssemblyName System.Security;" +
        `$k=[Convert]::FromBase64String('${fresh}');` +
        `[IO.File]::WriteAllBytes('${this.dpapiFile}',[Security.Cryptography.ProtectedData]::Protect($k,$null,'CurrentUser'))`,
    );
    return saved === null ? null : Buffer.from(fresh, "base64");
  }

  private read(): VaultFile {
    try {
      return JSON.parse(NodeFS.readFileSync(this.file, "utf8")) as VaultFile;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private write(vault: VaultFile) {
    const temporary = `${this.file}.${process.pid}.tmp`;
    NodeFS.writeFileSync(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
    NodeFS.renameSync(temporary, this.file);
    NodeFS.chmodSync(this.file, 0o600);
  }

  set(workflowId: string, secretId: string, value: string): void {
    const key = this.loadKey();
    const iv = NodeCrypto.randomBytes(12);
    const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const vault = this.read();
    vault.entries[`${workflowId}/${secretId}`] = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
      at: new Date().toISOString(),
    };
    this.write(vault);
  }

  /** The value, or null when missing or unreadable (wrong key, tampered file). */
  get(workflowId: string, secretId: string): string | null {
    const entry = this.read().entries[`${workflowId}/${secretId}`];
    if (!entry) return null;
    try {
      const decipher = NodeCrypto.createDecipheriv(
        "aes-256-gcm",
        this.loadKey(),
        Buffer.from(entry.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(entry.data, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }

  has(workflowId: string, secretId: string): boolean {
    return this.read().entries[`${workflowId}/${secretId}`] !== undefined;
  }

  remove(workflowId: string, secretId: string): void {
    const vault = this.read();
    delete vault.entries[`${workflowId}/${secretId}`];
    this.write(vault);
  }
}
