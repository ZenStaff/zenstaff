// @effect-diagnostics globalTimers:off globalDate:off -- The poll loop runs on a plain timer, outside the Effect runtime.
// Zen Staff e-mail channel: the adapter for the company's own mailbox. It polls the inbox and the
// watched labels / folders (Gmail API, Microsoft Graph or IMAP), parses each unread mail, hands it
// to the engine and marks it read. Sending happens only through `sendMail`, which the engine calls
// after the manager approved a draft. Secrets come from the runner's vault on each use.
import {
  ZEN_EMAIL_PROVIDERS,
  type ZenChatConnection,
  type ZenEmailProvider,
} from "@t3tools/contracts/zenChat";

import type { InboundAttachment, InboundMessage, OutboundFile } from "../model.ts";
import type { AdapterFactory, ConnectionRuntime, ManifestBuilder } from "../adapters/types.ts";
import { gmailMailbox, graphMailbox, type CloudMailbox } from "./cloudMail.ts";
import { pollImap, testImap, type ImapOptions } from "./imapClient.ts";
import { buildMail, parseMail, type ParsedMail } from "./mime.ts";
import { sendSmtp, testSmtp, type SmtpOptions } from "./smtpClient.ts";

export const emailProviderOf = (connection: ZenChatConnection): ZenEmailProvider => {
  const value = (connection.settings.provider ?? "").trim().toLowerCase();
  return (ZEN_EMAIL_PROVIDERS as ReadonlyArray<string>).includes(value)
    ? (value as ZenEmailProvider)
    : "imap";
};

const kindOf = (mimeType: string): InboundAttachment["kind"] =>
  mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("video/")
        ? "video"
        : "file";

const portOf = (value: string | undefined, fallback: number) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
};

function imapOptionsOf(connection: ZenChatConnection, password: string): ImapOptions {
  const settings = connection.settings;
  const security = settings.security ?? "tls";
  const address = settings.address ?? "";
  return {
    host: settings.imapHost || `imap.${address.split("@")[1] ?? ""}`,
    port: portOf(settings.imapPort, security === "plain-local-test" ? 143 : 993),
    secure: security !== "plain-local-test",
    user: settings.username || address,
    password,
  };
}

function smtpOptionsOf(connection: ZenChatConnection, password: string): SmtpOptions {
  const settings = connection.settings;
  const security = settings.security ?? "tls";
  const address = settings.address ?? "";
  const port = portOf(
    settings.smtpPort,
    security === "starttls" ? 587 : security === "tls" ? 465 : 25,
  );
  return {
    host: settings.smtpHost || `smtp.${address.split("@")[1] ?? ""}`,
    port,
    security:
      security === "plain-local-test"
        ? "plain"
        : security === "starttls" || port === 587
          ? "starttls"
          : "tls",
    user: settings.username || address,
    password,
  };
}

/** The message the engine receives for one mail (text = the readable body). */
export function inboundFromMail(input: {
  readonly connection: ZenChatConnection;
  readonly mail: ParsedMail;
  readonly key: string;
  readonly labels: ReadonlyArray<string>;
  readonly providerThreadId: string | null;
}): InboundMessage {
  const { mail } = input;
  const from = mail.from?.address ?? "";
  return {
    type: "message",
    platform: "email",
    workspaceId: from.split("@")[1] ?? "",
    channelId: input.connection.settings.address ?? "",
    channelType: "dm",
    threadId: null,
    messageId: mail.messageId ?? input.key,
    user: { id: from, name: mail.from?.name ?? "", email: from },
    text: mail.text,
    mentioned: true,
    attachments: mail.attachments
      .filter(
        (attachment) =>
          !(
            attachment.inline &&
            attachment.mimeType.startsWith("image/") &&
            attachment.sizeBytes < 20_000
          ),
      )
      .map((attachment) => ({
        id: `${input.key}:${attachment.index}`,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        kind: kindOf(attachment.mimeType),
        ref: `${input.key}:${attachment.index}`,
      })),
    command: null,
    email: {
      mail,
      labels: input.labels,
      providerMessageId: input.key,
      providerThreadId: input.providerThreadId,
    },
  };
}

export const createEmailAdapter: AdapterFactory = (runtime: ConnectionRuntime) => {
  const { connection } = runtime;
  const provider = emailProviderOf(connection);
  const address = connection.settings.address ?? "";
  // Parsed mails by key, for attachment downloads (the newest 50).
  const recent = new Map<string, ParsedMail>();
  const remember = (key: string, mail: ParsedMail) => {
    recent.set(key, mail);
    while (recent.size > 50) recent.delete(recent.keys().next().value!);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let polling = false;
  const pollMs = () => {
    const env = Number(process.env.ZEN_CHAT_EMAIL_POLL_MS);
    if (Number.isFinite(env) && env >= 200) return env;
    const seconds = Number(connection.settings.pollSeconds);
    return (Number.isFinite(seconds) && seconds >= 15 ? Math.min(seconds, 3600) : 60) * 1000;
  };

  const cloud = (): CloudMailbox => {
    const credentials = {
      clientId: connection.settings.clientId ?? "",
      clientSecret: runtime.secret("clientSecret") ?? "",
      refreshToken: runtime.secret("refreshToken") ?? "",
      tenantId: connection.settings.tenantId ?? "",
    };
    const deps = { fetch: runtime.fetch, apiBase: runtime.apiBase, now: runtime.now };
    return provider === "gmail" ? gmailMailbox(credentials, deps) : graphMailbox(credentials, deps);
  };
  let mailbox: CloudMailbox | null = null;

  const handle = async (
    key: string,
    raw: Uint8Array,
    labels: ReadonlyArray<string>,
    threadId: string | null,
  ) => {
    const mail = parseMail(raw);
    remember(key, mail);
    await runtime.emit(
      inboundFromMail({ connection, mail, key, labels, providerThreadId: threadId }),
    );
  };

  const pollOnce = async () => {
    const labels = runtime.watchedLabels?.() ?? [];
    if (provider === "imap") {
      const password = runtime.secret("password") ?? "";
      await pollImap(imapOptionsOf(connection, password), ["INBOX", ...labels], (folder, message) =>
        handle(`imap:${folder}:${message.uid}`, message.raw, [folder], null),
      );
      return;
    }
    mailbox ??= cloud();
    for (const message of await mailbox.list(labels, 20)) {
      await handle(`${provider}:${message.id}`, message.raw, message.labels, message.threadId);
      await mailbox.markRead(message.id);
    }
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void loop(), delay);
    timer.unref?.();
  };
  const loop = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      await pollOnce();
      runtime.setStatus("connected", null);
    } catch (error) {
      runtime.setStatus(
        "error",
        error instanceof Error ? error.message.slice(0, 200) : "mailbox error",
      );
      runtime.log(`chat: e-mail poll failed on ${connection.id}: ${String(error)}`);
    } finally {
      polling = false;
      schedule(pollMs());
    }
  };

  return {
    client: {
      platform: "email",
      // Mail never goes out on its own: only `sendMail`, after an approval (or a report to the manager).
      async post() {
        return { messageId: "" };
      },
      async download(attachment) {
        const separator = attachment.ref.lastIndexOf(":");
        const mail = recent.get(attachment.ref.slice(0, separator));
        const index = Number(attachment.ref.slice(separator + 1));
        const found = mail?.attachments.find((item) => item.index === index);
        if (found === undefined) throw new Error("attachment no longer in memory");
        return found.content;
      },
      async upload(_target, _file: OutboundFile) {
        // Files go into the draft as attachments (engine), not as separate posts.
      },
      async sendMail(mail, providerThreadId) {
        const raw = buildMail({
          ...mail,
          extraHeaders: { "X-Zen-Staff": "1", ...mail.extraHeaders },
        });
        if (provider === "imap") {
          const password = runtime.secret("password") ?? "";
          return sendSmtp(
            smtpOptionsOf(connection, password),
            {
              from: mail.from.address,
              to: [...mail.to, ...(mail.cc ?? [])].map((item) => item.address),
            },
            raw,
          );
        }
        mailbox ??= cloud();
        return mailbox.send(raw, providerThreadId);
      },
    },
    start() {
      stopped = false;
      runtime.setStatus("connecting", null);
      schedule(50);
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    async test() {
      try {
        if (provider === "imap") {
          const password = runtime.secret("password") ?? "";
          await testImap(imapOptionsOf(connection, password));
          await testSmtp(smtpOptionsOf(connection, password));
          return { ok: true, detail: `IMAP and SMTP sign-in worked for ${address}.` };
        }
        mailbox ??= cloud();
        const who = await mailbox.test();
        return { ok: true, detail: `Signed in as ${who}.` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

export const emailManifest: ManifestBuilder = ({ connection }) => {
  const provider = connection ? emailProviderOf(connection) : "gmail";
  if (provider === "graph") {
    return {
      kind: "text",
      fileName: null,
      content: [
        "Microsoft Entra app registration (your own tenant)",
        "Supported account types: Accounts in this organizational directory only",
        "Redirect URI (Web): https://localhost (used once to get the refresh token)",
        "API permissions > Microsoft Graph > Delegated: Mail.ReadWrite, Mail.Send, offline_access, then Grant admin consent",
        "Certificates & secrets > New client secret: paste its Value into Zen Staff",
      ].join("\n"),
      openUrl:
        "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    };
  }
  if (provider === "imap") {
    return {
      kind: "text",
      fileName: null,
      content: [
        "IMAP: port 993 (TLS). SMTP: port 465 (TLS) or 587 (STARTTLS).",
        "Create an app password for the mailbox in your mail provider's security settings.",
        "Optional: a folder per AI staff member (e.g. Zen/Ana) with a server-side rule that files mail to ana@ there.",
      ].join("\n"),
      openUrl: null,
    };
  }
  return {
    kind: "text",
    fileName: null,
    content: [
      "Google Cloud project (your own) > APIs & Services",
      "Enable: Gmail API",
      "OAuth consent screen: Internal (Google Workspace)",
      "Scopes: https://www.googleapis.com/auth/gmail.modify, https://www.googleapis.com/auth/gmail.send",
      "Credentials > Create credentials > OAuth client ID > Web application",
      "Authorized redirect URI: https://developers.google.com/oauthplayground",
    ].join("\n"),
    openUrl: "https://console.cloud.google.com/apis/credentials",
  };
};
