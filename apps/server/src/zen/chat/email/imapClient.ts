// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- A small socket client, outside the Effect runtime (the adapter's poll loop drives it).
// Zen Staff e-mail channel: just enough IMAP4rev1 (RFC 3501) to read a mailbox. LOGIN with an app
// password, SELECT, UID SEARCH UNSEEN, UID FETCH BODY.PEEK[] (literals), UID STORE +FLAGS \Seen,
// LOGOUT. TLS on 993; plain only for a local test server.
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

export interface ImapOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly timeoutMs?: number;
}

export interface FetchedMessage {
  readonly uid: number;
  readonly raw: Uint8Array;
}

/** IMAP quoted string. */
function imapQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Modified UTF-7 (RFC 3501 5.1.3) for folder names with non-ASCII letters. */
function encodeMailboxName(name: string): string {
  let out = "";
  let pending = "";
  const flush = () => {
    if (pending === "") return;
    const bytes = Buffer.from(pending, "utf16le");
    // UTF-16BE
    for (let index = 0; index < bytes.length; index += 2) {
      const low = bytes[index]!;
      bytes[index] = bytes[index + 1]!;
      bytes[index + 1] = low;
    }
    out += `&${bytes.toString("base64").replace(/=+$/, "").replace(/\//g, ",")}-`;
    pending = "";
  };
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      flush();
      out += char === "&" ? "&-" : char;
    } else pending += char;
  }
  flush();
  return out;
}

/** Parses tagged responses and FETCH literals from the raw byte stream. */
class ImapConnection {
  private socket: NodeNet.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private tagCounter = 0;
  private closed = false;
  private readonly options: ImapOptions;

  constructor(options: ImapOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { host, port, secure } = this.options;
    const socket = await new Promise<NodeNet.Socket>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      const created = secure
        ? NodeTls.connect({ host, port, servername: host }, () => resolve(created))
        : NodeNet.connect({ host, port }, () => resolve(created));
      created.once("error", onError);
      created.setTimeout(this.options.timeoutMs ?? 30_000, () =>
        created.destroy(new Error("IMAP timeout")),
      );
    });
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const waiting = this.waiters;
      this.waiters = [];
      for (const wake of waiting) wake();
    });
    socket.on("close", () => {
      this.closed = true;
      const waiting = this.waiters;
      this.waiters = [];
      for (const wake of waiting) wake();
    });
    socket.on("error", () => undefined);
    const greeting = await this.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greeting))
      throw new Error(`IMAP server refused: ${greeting.slice(0, 120)}`);
  }

  private async waitData(): Promise<void> {
    if (this.closed) throw new Error("IMAP connection closed");
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end !== -1) {
        const line = this.buffer.subarray(0, end).toString("utf8");
        this.buffer = this.buffer.subarray(end + 2);
        return line;
      }
      await this.waitData();
    }
  }

  private async readBytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) await this.waitData();
    const bytes = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return Buffer.from(bytes);
  }

  /** Sends a command; collects untagged lines (with literals inlined as buffers) until its tag. */
  async command(text: string): Promise<{ lines: string[]; literals: Buffer[][] }> {
    if (this.socket === null) throw new Error("IMAP not connected");
    const tag = `Z${++this.tagCounter}`;
    this.socket.write(`${tag} ${text}\r\n`);
    const lines: string[] = [];
    const literals: Buffer[][] = [];
    for (;;) {
      let line = await this.readLine();
      const parts: Buffer[] = [];
      // A line ending in {n} is followed by n bytes, then the rest of the line.
      let literal = /\{(\d+)\}$/.exec(line);
      while (literal !== null) {
        parts.push(await this.readBytes(Number(literal[1])));
        const rest = await this.readLine();
        line = `${line}${rest}`;
        literal = /\{(\d+)\}$/.exec(rest);
      }
      if (line.startsWith(`${tag} `)) {
        const status = line.slice(tag.length + 1);
        if (!/^OK/i.test(status))
          throw new Error(`IMAP ${text.split(" ")[0]} failed: ${status.slice(0, 160)}`);
        return { lines, literals };
      }
      lines.push(line);
      literals.push(parts);
    }
  }

  async login(): Promise<void> {
    await this.command(`LOGIN ${imapQuote(this.options.user)} ${imapQuote(this.options.password)}`);
  }

  async select(mailbox: string): Promise<void> {
    await this.command(`SELECT ${imapQuote(encodeMailboxName(mailbox))}`);
  }

  async searchUnseen(): Promise<number[]> {
    const { lines } = await this.command("UID SEARCH UNSEEN");
    return lines
      .filter((line) => /^\* SEARCH/i.test(line))
      .flatMap((line) =>
        line
          .replace(/^\* SEARCH/i, "")
          .trim()
          .split(/\s+/),
      )
      .map(Number)
      .filter((uid) => Number.isInteger(uid) && uid > 0);
  }

  async fetch(uid: number): Promise<FetchedMessage | null> {
    const { lines, literals } = await this.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    for (const [index, line] of lines.entries()) {
      if (!/FETCH/i.test(line)) continue;
      const body = literals[index]?.[0];
      if (body !== undefined) return { uid, raw: Uint8Array.from(body) };
    }
    return null;
  }

  async markSeen(uid: number): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } catch {
      // closing anyway
    }
    this.close();
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.closed = true;
  }
}

/** One poll: every unseen mail in each folder, marked seen once handed over. */
export async function pollImap(
  options: ImapOptions,
  folders: ReadonlyArray<string>,
  handle: (folder: string, message: FetchedMessage) => Promise<void>,
  maxPerFolder = 25,
): Promise<number> {
  const connection = new ImapConnection(options);
  await connection.connect();
  let count = 0;
  try {
    await connection.login();
    for (const folder of folders) {
      try {
        await connection.select(folder);
      } catch {
        continue; // A label that does not exist yet.
      }
      const uids = (await connection.searchUnseen()).slice(0, maxPerFolder);
      for (const uid of uids) {
        const message = await connection.fetch(uid);
        if (message === null) continue;
        await handle(folder, message);
        await connection.markSeen(uid);
        count += 1;
      }
    }
  } finally {
    await connection.logout();
  }
  return count;
}

export async function testImap(options: ImapOptions): Promise<void> {
  const connection = new ImapConnection(options);
  await connection.connect();
  try {
    await connection.login();
    await connection.select("INBOX");
  } finally {
    await connection.logout();
  }
}
