// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off -- Dev/test harness: plain sockets, outside the Effect runtime.
// Zen Staff e-mail channel: a local fake mailbox for tests and live demos. A tiny IMAP server
// (LOGIN, SELECT, UID SEARCH UNSEEN, UID FETCH BODY.PEEK[], UID STORE \Seen) and SMTP server
// (EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA) on 127.0.0.1, sharing one in-memory mailbox.
// Run: `node apps/server/src/zen/chat/dev/fakeMail.ts <imapPort> <smtpPort> <controlPort> <user> <password>`;
// the control port takes `POST /deliver?folder=INBOX` (raw mail body) and `GET /sent` (JSON).
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

export interface FakeMailServer {
  readonly imapPort: number;
  readonly smtpPort: number;
  readonly sent: Array<{ from: string; to: string[]; data: string; at: string }>;
  deliver(raw: string, folder?: string): number;
  close(): Promise<void>;
}

interface StoredMail {
  readonly uid: number;
  readonly raw: Buffer;
  seen: boolean;
}

function parseArgs(text: string): string[] {
  const out: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (const match of text.matchAll(pattern)) {
    out.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2]!);
  }
  return out;
}

export async function startFakeMailServer(options: {
  readonly user: string;
  readonly password: string;
  readonly imapPort?: number;
  readonly smtpPort?: number;
}): Promise<FakeMailServer> {
  const folders = new Map<string, StoredMail[]>();
  let nextUid = 1;
  const sent: FakeMailServer["sent"] = [];
  const sockets = new Set<NodeNet.Socket>();

  const imap = NodeNet.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let authed = false;
    let selected: StoredMail[] | null = null;
    let buffer = "";
    socket.write("* OK fake IMAP ready\r\n");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let end = buffer.indexOf("\r\n");
      while (end !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\r\n");
        const [tag = "*", rawCommand = "", ...rest] = line.split(" ");
        const command = rawCommand.toUpperCase();
        const args = rest.join(" ");
        const ok = (text = "done") => socket.write(`${tag} OK ${text}\r\n`);
        const no = (text: string) => socket.write(`${tag} NO ${text}\r\n`);
        if (command === "CAPABILITY") {
          socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n");
          ok();
        } else if (command === "NOOP") ok();
        else if (command === "LOGIN") {
          const [user, password] = parseArgs(args);
          if (user === options.user && password === options.password) {
            authed = true;
            ok("logged in");
          } else no("[AUTHENTICATIONFAILED] invalid credentials");
        } else if (command === "LOGOUT") {
          socket.write("* BYE\r\n");
          ok();
          socket.end();
        } else if (!authed) no("log in first");
        else if (command === "SELECT") {
          const [name = ""] = parseArgs(args);
          const folder = folders.get(name.toUpperCase() === "INBOX" ? "INBOX" : name);
          if (folder === undefined) {
            no("no such mailbox");
            continue;
          }
          selected = folder;
          socket.write(`* ${folder.length} EXISTS\r\n* FLAGS (\\Seen)\r\n`);
          ok("[READ-WRITE] selected");
        } else if (command === "UID" && selected !== null) {
          const [sub = "", set = "", ...more] = parseArgs(args);
          if (sub.toUpperCase() === "SEARCH") {
            const uids = selected.filter((mail) => !mail.seen).map((mail) => mail.uid);
            socket.write(`* SEARCH${uids.length > 0 ? ` ${uids.join(" ")}` : ""}\r\n`);
            ok();
          } else if (sub.toUpperCase() === "FETCH") {
            const index = selected.findIndex((mail) => mail.uid === Number(set));
            const mail = selected[index];
            if (mail !== undefined) {
              socket.write(`* ${index + 1} FETCH (UID ${mail.uid} BODY[] {${mail.raw.length}}\r\n`);
              socket.write(mail.raw);
              socket.write(")\r\n");
            }
            ok();
          } else if (sub.toUpperCase() === "STORE") {
            const mail = selected.find((item) => item.uid === Number(set));
            if (mail !== undefined && /\\Seen/i.test(more.join(" "))) mail.seen = true;
            ok();
          } else no("unknown UID command");
        } else no("unknown command");
      }
    });
  });

  const smtp = NodeNet.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let authed = false;
    let from = "";
    let to: string[] = [];
    let inData = false;
    let data = "";
    let loginStep: "user" | "password" | null = null;
    let loginUser = "";
    let buffer = "";
    socket.write("220 fake SMTP ready\r\n");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          const atStart = buffer.startsWith(".\r\n");
          if (end === -1 && !atStart) return;
          const body = atStart ? "" : buffer.slice(0, end);
          buffer = atStart ? buffer.slice(3) : buffer.slice(end + 5);
          data = `${data}${body}`.replace(/(^|\r\n)\.\./g, "$1.");
          sent.push({ from, to, data, at: new Date().toISOString() });
          inData = false;
          data = "";
          socket.write("250 2.0.0 queued as fake\r\n");
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (loginStep !== null) {
          const value = Buffer.from(line, "base64").toString("utf8");
          if (loginStep === "user") {
            loginUser = value;
            loginStep = "password";
            socket.write("334 UGFzc3dvcmQ6\r\n");
          } else {
            loginStep = null;
            authed = loginUser === options.user && value === options.password;
            socket.write(authed ? "235 2.7.0 ok\r\n" : "535 5.7.8 bad credentials\r\n");
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write("250-fake.local\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        } else if (upper.startsWith("AUTH PLAIN")) {
          const decoded = Buffer.from(line.slice(11).trim(), "base64").toString("utf8").split("\0");
          authed = decoded[1] === options.user && decoded[2] === options.password;
          socket.write(authed ? "235 2.7.0 ok\r\n" : "535 5.7.8 bad credentials\r\n");
        } else if (upper.startsWith("AUTH LOGIN")) {
          loginStep = "user";
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (upper.startsWith("MAIL FROM:")) {
          if (!authed) {
            socket.write("530 5.7.0 authentication required\r\n");
            continue;
          }
          from = /<([^>]*)>/.exec(line)?.[1] ?? "";
          to = [];
          socket.write("250 ok\r\n");
        } else if (upper.startsWith("RCPT TO:")) {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          socket.write("250 ok\r\n");
        } else if (upper === "DATA") {
          inData = true;
          socket.write("354 end with .\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else if (upper === "RSET" || upper === "NOOP") socket.write("250 ok\r\n");
        else socket.write("502 not implemented\r\n");
      }
    });
  });

  const listen = (server: NodeNet.Server, port: number) =>
    new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () =>
        resolve((server.address() as NodeNet.AddressInfo).port),
      );
    });
  const imapPort = await listen(imap, options.imapPort ?? 0);
  const smtpPort = await listen(smtp, options.smtpPort ?? 0);
  folders.set("INBOX", []);

  return {
    imapPort,
    smtpPort,
    sent,
    deliver(raw, folder = "INBOX") {
      const list = folders.get(folder) ?? [];
      folders.set(folder, list);
      const uid = nextUid++;
      list.push({ uid, raw: Buffer.from(raw.replace(/\r?\n/g, "\r\n"), "utf8"), seen: false });
      return uid;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [imap, smtp].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
    },
  };
}

if (import.meta.main) {
  const [imapPort, smtpPort, controlPort, user = "office@example.com", password = "app-pass"] =
    process.argv.slice(2);
  const server = await startFakeMailServer({
    user,
    password,
    imapPort: Number(imapPort ?? 3991),
    smtpPort: Number(smtpPort ?? 3992),
  });
  NodeHttp.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/deliver") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const uid = server.deliver(
          Buffer.concat(chunks).toString("utf8"),
          url.searchParams.get("folder") ?? "INBOX",
        );
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ uid }));
      });
      return;
    }
    if (url.pathname === "/sent") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(server.sent, null, 2));
      return;
    }
    response.writeHead(404).end();
  }).listen(Number(controlPort ?? 3993), "127.0.0.1");
  console.log(
    `fake mail: IMAP 127.0.0.1:${server.imapPort}, SMTP 127.0.0.1:${server.smtpPort}, control http://127.0.0.1:${controlPort ?? 3993} (user ${user})`,
  );
}
