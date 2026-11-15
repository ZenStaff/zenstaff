// @effect-diagnostics nodeBuiltinImport:off -- A small socket client, outside the Effect runtime.
// Zen Staff e-mail channel: just enough SMTP submission (RFC 5321 / 6409) to send a reply. EHLO,
// STARTTLS (587) or implicit TLS (465), AUTH PLAIN / LOGIN with an app password, MAIL FROM, RCPT
// TO, DATA with dot-stuffing, QUIT. Plain only for a local test server.
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  /** "tls" = implicit TLS, "starttls" = upgrade after EHLO, "plain" = local tests only. */
  readonly security: "tls" | "starttls" | "plain";
  readonly user: string;
  readonly password: string;
  readonly timeoutMs?: number;
}

class SmtpSession {
  private socket: NodeNet.Socket;
  private buffer = "";
  private waiters: Array<() => void> = [];
  private closed = false;

  constructor(socket: NodeNet.Socket) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: NodeNet.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const waiting = this.waiters;
      this.waiters = [];
      for (const wake of waiting) wake();
    });
    socket.on("close", () => {
      this.closed = true;
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.on("error", () => undefined);
  }

  /** A full reply (multi-line `250-...` until `250 ...`). */
  async reply(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = this.buffer.split("\r\n");
      for (let index = 0; index < lines.length - 1; index += 1) {
        const line = lines[index]!;
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const text = lines.slice(0, index + 1).join("\n");
          this.buffer = lines.slice(index + 1).join("\r\n");
          return { code: Number(line.slice(0, 3)), text };
        }
      }
      if (this.closed) throw new Error("SMTP connection closed");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  async send(line: string, expect: ReadonlyArray<number>): Promise<string> {
    this.socket.write(`${line}\r\n`);
    const answer = await this.reply();
    if (!expect.includes(answer.code)) {
      const shown = /^AUTH|^[A-Za-z0-9+/=]{12,}$/.test(line) ? "(credentials)" : line.split(" ")[0];
      throw new Error(`SMTP ${shown} refused: ${answer.text.slice(0, 200)}`);
    }
    return answer.text;
  }

  async upgrade(host: string): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners("data");
    const secured = await new Promise<NodeTls.TLSSocket>((resolve, reject) => {
      const tls = NodeTls.connect({ socket: plain, servername: host }, () => resolve(tls));
      tls.once("error", reject);
    });
    this.socket = secured;
    this.buffer = "";
    this.attach(secured);
  }

  writeRaw(data: string) {
    this.socket.write(data);
  }

  close() {
    this.socket.destroy();
  }
}

/** Dot-stuffing and CRLF line ends for DATA. */
export function smtpData(message: string): string {
  const normalized = message.replace(/\r?\n/g, "\r\n");
  const stuffed = normalized.replace(/(^|\r\n)\./g, "$1..");
  return `${stuffed.endsWith("\r\n") ? stuffed : `${stuffed}\r\n`}.\r\n`;
}

async function open(options: SmtpOptions): Promise<SmtpSession> {
  const socket = await new Promise<NodeNet.Socket>((resolve, reject) => {
    const created =
      options.security === "tls"
        ? NodeTls.connect(
            { host: options.host, port: options.port, servername: options.host },
            () => resolve(created),
          )
        : NodeNet.connect({ host: options.host, port: options.port }, () => resolve(created));
    created.once("error", reject);
    created.setTimeout(options.timeoutMs ?? 30_000, () =>
      created.destroy(new Error("SMTP timeout")),
    );
  });
  const session = new SmtpSession(socket);
  const greeting = await session.reply();
  if (greeting.code !== 220) throw new Error(`SMTP server refused: ${greeting.text.slice(0, 160)}`);
  let features = await session.send("EHLO zen-staff.local", [250]);
  if (options.security === "starttls") {
    if (!/STARTTLS/i.test(features)) throw new Error("The SMTP server does not offer STARTTLS.");
    await session.send("STARTTLS", [220]);
    await session.upgrade(options.host);
    features = await session.send("EHLO zen-staff.local", [250]);
  }
  if (options.password !== "") {
    if (/AUTH[^\n]*PLAIN/i.test(features) || !/AUTH[^\n]*LOGIN/i.test(features)) {
      const token = Buffer.from(`\0${options.user}\0${options.password}`, "utf8").toString(
        "base64",
      );
      await session.send(`AUTH PLAIN ${token}`, [235]);
    } else {
      await session.send("AUTH LOGIN", [334]);
      await session.send(Buffer.from(options.user).toString("base64"), [334]);
      await session.send(Buffer.from(options.password).toString("base64"), [235]);
    }
  }
  return session;
}

export async function sendSmtp(
  options: SmtpOptions,
  envelope: { readonly from: string; readonly to: ReadonlyArray<string> },
  message: string,
): Promise<string> {
  const session = await open(options);
  try {
    await session.send(`MAIL FROM:<${envelope.from}>`, [250]);
    for (const recipient of envelope.to) await session.send(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.send("DATA", [354]);
    session.writeRaw(smtpData(message));
    const accepted = await session.reply();
    if (accepted.code !== 250)
      throw new Error(`SMTP refused the message: ${accepted.text.slice(0, 200)}`);
    await session.send("QUIT", [221]).catch(() => "");
    return accepted.text.slice(4, 160);
  } finally {
    session.close();
  }
}

export async function testSmtp(options: SmtpOptions): Promise<void> {
  const session = await open(options);
  try {
    await session.send("QUIT", [221]).catch(() => "");
  } finally {
    session.close();
  }
}
