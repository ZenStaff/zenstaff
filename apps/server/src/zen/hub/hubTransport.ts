// @effect-diagnostics extendsNativeError:off globalFetch:off globalTimers:off -- A plain WebSocket/fetch client; the hub is not an Effect service.
// Zen Staff hub: HTTPS calls to the hub, and the runner's outbound WebSocket.
// The runner dials out and keeps one socket open; it never listens for the hub.
import type { RequestSignature } from "./hubCrypto.ts";
import type { RelayDevice } from "./relayTrust.ts";

export class HubHttpError extends Error {
  readonly status: number;
  /** The hub's machine-readable code, e.g. "two_factor_required". */
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function hubFetch<T>(
  hubUrl: string,
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 45_000,
  authorization: string | null = token === null ? null : `Bearer ${token}`,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${hubUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(authorization === null ? {} : { authorization }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HubHttpError(0, "The hub cannot be reached. Check the address and your connection.");
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message =
      typeof json === "object" && json !== null && "error" in json && typeof json.error === "string"
        ? json.error
        : `The hub answered ${response.status}.`;
    const code =
      typeof json === "object" && json !== null && "code" in json && typeof json.code === "string"
        ? json.code
        : null;
    throw new HubHttpError(response.status, message, code);
  }
  return json as T;
}

/** A call authenticated as this machine's runner (its credential), not as the signed-in person. */
export function runnerFetch<T>(hubUrl: string, credential: string, path: string, body: unknown) {
  return hubFetch<T>(hubUrl, null, "POST", path, body, 15_000, `Runner ${credential}`);
}

/** A comment as the hub hands it to the runner (`thread.meta`). */
export interface RelayComment {
  readonly id: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly createdAt: string;
  /** Written before end-to-end comments: plaintext the hub saw. */
  readonly legacy?: { readonly body: string; readonly messageId: string | null };
  readonly sealed?: string;
  readonly sig?: RequestSignature;
  readonly device?: RelayDevice;
}

export interface RelayFrame {
  readonly t: "req";
  readonly id: string;
  readonly op: string;
  readonly shareId: string;
  readonly threadId: string;
  readonly shareKind: string;
  readonly companyId: string;
  readonly actor: { readonly userId: string; readonly email: string; readonly name: string };
  /** Hub v9: the asker's role and permissions in that company, as the hub computed them. */
  readonly actorAccess?: import("@t3tools/contracts/zenHub").ZenHubAccess | null;
  readonly input: unknown;
  /** v2: the asking device's signature and keys (relayTrust.ts checks both). */
  readonly sig?: RequestSignature;
  readonly device?: RelayDevice;
  /** `thread.meta`: the share's comments and the title this runner sealed to itself. */
  readonly comments?: ReadonlyArray<RelayComment>;
  readonly titleSealed?: string | null;
}

export class RunnerRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Keeps one outbound socket to the hub open, reconnecting with backoff. */
export class RunnerSocket {
  #socket: WebSocket | null = null;
  #stopped = false;
  #connected = false;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  lastError: string | null = null;

  readonly options: {
    readonly hubUrl: string;
    readonly credential: string;
    readonly onRequest: (frame: RelayFrame) => Promise<unknown>;
    /** Hub notices, e.g. `{kind: "device.revoked", userId, keyIds}`. */
    readonly onNotice?: (frame: Record<string, unknown>) => void;
    readonly log: (line: string) => void;
  };

  constructor(options: RunnerSocket["options"]) {
    this.options = options;
  }

  get connected(): boolean {
    return this.#connected;
  }

  start(): void {
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#socket?.close(1000, "stopped");
    this.#socket = null;
    this.#connected = false;
  }

  #open() {
    if (this.#stopped) return;
    const url = `${this.options.hubUrl.replace(/^http/, "ws")}/v1/runner`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.lastError = String(error);
      this.#retry();
      return;
    }
    this.#socket = socket;
    socket.addEventListener("open", () => {
      // The credential travels in the first frame, never in the URL.
      socket.send(JSON.stringify({ t: "hello", credential: this.options.credential }));
    });
    socket.addEventListener("message", (event) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame.t === "welcome") {
        this.#connected = true;
        this.#attempt = 0;
        this.lastError = null;
        this.options.log("zen hub: runner connected");
        return;
      }
      if (frame.t === "notice") {
        this.options.onNotice?.(frame);
        return;
      }
      if (frame.t === "error") {
        this.lastError = typeof frame.error === "string" ? frame.error : "refused";
        return;
      }
      if (frame.t !== "req" || typeof frame.id !== "string") return;
      const request = frame as unknown as RelayFrame;
      this.options.onRequest(request).then(
        (result) => socket.send(JSON.stringify({ t: "res", id: request.id, ok: true, result })),
        (error: unknown) =>
          socket.send(
            JSON.stringify({
              t: "res",
              id: request.id,
              ok: false,
              status: error instanceof RunnerRequestError ? error.status : 500,
              error:
                error instanceof RunnerRequestError
                  ? error.message
                  : "The runner could not do that.",
            }),
          ),
      );
    });
    socket.addEventListener("close", (event) => {
      this.#connected = false;
      if (this.#socket === socket) this.#socket = null;
      if (event.code === 4004) this.lastError = "The hub no longer knows this machine.";
      this.#retry();
    });
    socket.addEventListener("error", () => {
      this.lastError = this.lastError ?? "The hub cannot be reached.";
    });
  }

  #retry() {
    if (this.#stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.#attempt);
    this.#attempt += 1;
    this.#timer = setTimeout(() => this.#open(), delay);
  }
}
