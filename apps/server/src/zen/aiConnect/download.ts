// @effect-diagnostics globalTimers:off extendsNativeError:off globalFetch:off - plain async code that runs outside the Effect runtime (wrapped by ZenAiConnect.ts).
// Zen Staff "Conectează-ți AI-ul": fetches an official installer script over HTTPS. Redirects are
// followed by hand so every hop is checked (https, an allowlisted host, default port); TLS is
// verified by fetch (Node rejects bad certificates; nothing here turns that off). Size and time
// are capped and the body must look like the script it claims to be. Network errors are retried.
import type { InstallerSource } from "./commands.ts";

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;

export class InstallerDownloadError extends Error {
  readonly kind: "network" | "rejected";
  constructor(kind: "network" | "rejected", message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Whether a URL is allowed for this installer: https, no credentials or port, allowlisted host. */
export function isAllowedInstallerUrl(source: InstallerSource, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    source.hosts.includes(url.hostname.toLowerCase())
  );
}

/** The script must be text in the expected language (a shebang for sh/bash, PowerShell text). */
export function looksLikeInstaller(source: InstallerSource, text: string): boolean {
  if (text.length < 64 || text.includes("\u0000")) return false;
  if (/^\s*<(!doctype|html)/i.test(text)) return false;
  if (source.kind === "powershell")
    return /\$[A-Za-z_]|param\s*\(|Write-(Host|Output|Error)/.test(text);
  return text.startsWith("#!");
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function fetchOnce(
  source: InstallerSource,
  fetchImpl: Fetch,
  signal: AbortSignal,
): Promise<string> {
  let url = source.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedInstallerUrl(source, url)) {
      throw new InstallerDownloadError("rejected", "The installer address is not an official one.");
    }
    const response = await fetchImpl(url, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new InstallerDownloadError("rejected", "The installer redirect has no address.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new InstallerDownloadError(
        response.status >= 500 || response.status === 429 ? "network" : "rejected",
        `The installer download answered ${response.status}.`,
      );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES)
      throw new InstallerDownloadError("rejected", "The installer is larger than expected.");
    const reader = response.body?.getReader();
    if (!reader) throw new InstallerDownloadError("network", "The installer download was empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new InstallerDownloadError("rejected", "The installer is larger than expected.");
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    if (!looksLikeInstaller(source, text)) {
      throw new InstallerDownloadError(
        "rejected",
        "The download is not the expected installer script.",
      );
    }
    return text;
  }
  throw new InstallerDownloadError("rejected", "Too many redirects for the installer.");
}

export interface DownloadOptions {
  readonly fetch?: Fetch;
  readonly attempts?: number;
  readonly timeoutMs?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly signal?: AbortSignal;
  readonly onRetry?: (attempt: number, error: Error) => void;
}

/** Downloads the script with retries (network errors only; a rejected download fails at once). */
export async function downloadInstaller(
  source: InstallerSource,
  options: DownloadOptions = {},
): Promise<string> {
  const attempts = options.attempts ?? 3;
  const fetchImpl: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  let last: Error = new InstallerDownloadError("network", "The installer could not be downloaded.");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new InstallerDownloadError("network", "Cancelled.");
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      return await fetchOnce(source, fetchImpl, signal);
    } catch (cause) {
      const error =
        cause instanceof InstallerDownloadError
          ? cause
          : new InstallerDownloadError(
              "network",
              timeout.aborted
                ? "The installer download timed out."
                : "The installer could not be downloaded. Check the internet connection.",
            );
      if (error.kind === "rejected" || attempt === attempts || options.signal?.aborted) throw error;
      last = error;
      options.onRetry?.(attempt + 1, error);
      const wait = options.backoffMs?.(attempt) ?? attempt * 2_000;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw last;
}
