// Zen Staff chat integrations: Slack, Teams, Discord, Telegram, Google Chat, WhatsApp talk to the
// company's AI staff. Bot tokens stay in the runner's vault. One RPC carries every operation as
// `{ op, input }` (like the hub); the server validates each op's input. See ZEN.md.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "./auth.ts";

export const ZEN_CHAT_WS_METHODS = {
  call: "zen.chat.call",
} as const;

const ZEN_CHAT_OPS = [
  "status",
  "connection.save",
  "connection.remove",
  "connection.setSecret",
  "connection.removeSecret",
  "connection.test",
  "connection.restart",
  "agent.save",
  "agent.remove",
  "binding.save",
  "binding.remove",
  "member.save",
  "member.remove",
  "report.save",
  "report.remove",
  "report.runNow",
  "settings.save",
  "access.grant",
  "access.revoke",
  "manifest",
  "audit.list",
  "approval.list",
  "approval.decide",
] as const;
export type ZenChatOp = (typeof ZEN_CHAT_OPS)[number];

export const ZenChatCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_CHAT_OPS),
  input: Schema.Unknown,
});
export type ZenChatCallInput = typeof ZenChatCallInput.Type;

export class ZenChatError extends Schema.TaggedError<ZenChatError>()("ZenChatError", {
  reason: Schema.Literals([
    "invalid-input",
    "forbidden",
    "not-found",
    "unreachable",
    "unavailable",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const ZenChatCallRpc = Rpc.make(ZEN_CHAT_WS_METHODS.call, {
  payload: ZenChatCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenChatError, EnvironmentAuthorizationError]),
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_CHAT_RPCS = [ZenChatCallRpc] as const;

export const ZEN_CHAT_RPC_SCOPES = {
  [ZEN_CHAT_WS_METHODS.call]: AuthOrchestrationOperateScope,
} as const;

export const ZEN_CHAT_RPC_AGGREGATES = {
  [ZEN_CHAT_WS_METHODS.call]: "zen",
} as const;

// Platforms

export const ZEN_CHAT_PLATFORMS = [
  "slack",
  "teams",
  "discord",
  "telegram",
  "googlechat",
  "whatsapp",
  "email",
] as const;
export type ZenChatPlatform = (typeof ZEN_CHAT_PLATFORMS)[number];

export interface ZenChatPlatformInfo {
  readonly id: ZenChatPlatform;
  readonly name: string;
  /** How events reach the runner: it dials out, or the hub relays a webhook. */
  readonly transport: "outbound" | "hub-relay";
  readonly transportName: string;
  /** Secrets kept in the runner's vault (ids and labels; values never leave the runner). */
  readonly secrets: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly hint: string;
  }>;
  /** Non-secret settings the admin types in. */
  readonly settings: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly required: boolean;
    /** A fixed choice (rendered as a select); the first one is the default. */
    readonly options?: ReadonlyArray<string>;
  }>;
  /** Minimal bot permissions, as the platform names them. */
  readonly scopes: ReadonlyArray<string>;
  readonly limits: {
    readonly textChars: number;
    readonly uploadMb: number;
    readonly downloadMb: number;
    readonly buttons: number;
  };
  readonly features: {
    readonly threads: boolean;
    readonly typing: "native" | "placeholder";
    readonly slashCommands: boolean;
    readonly buttons: boolean;
    readonly directMessages: boolean;
    readonly channels: boolean;
  };
  /** Where the admin creates the app (opened by the setup guide). */
  readonly createUrl: string;
  readonly docsUrl: string;
}

// E-mail as a channel: the company's OWN mailbox, read on the company runner. Gmail through the
// Gmail API and Microsoft 365 through Microsoft Graph, both with OAuth in the customer's own Google
// Cloud project / Entra tenant (refresh token + client secret in the runner's vault), or any
// mailbox over IMAP/SMTP with an app password (in the vault too). See docs/zen-chat-integrations.md.
export const ZEN_EMAIL_PROVIDERS = ["imap", "gmail", "graph"] as const;
export type ZenEmailProvider = (typeof ZEN_EMAIL_PROVIDERS)[number];

/** The vault secrets each provider needs (the others stay empty). */
export const ZEN_EMAIL_PROVIDER_SECRETS: Readonly<Record<ZenEmailProvider, ReadonlyArray<string>>> =
  {
    imap: ["password"],
    gmail: ["clientSecret", "refreshToken"],
    graph: ["clientSecret", "refreshToken"],
  };

const EMAIL_PLATFORM_INFO: ZenChatPlatformInfo = {
  id: "email",
  name: "E-mail",
  transport: "outbound",
  transportName: "Gmail API, Microsoft Graph or IMAP/SMTP (the runner polls the mailbox)",
  secrets: [
    {
      id: "password",
      label: "App password (IMAP/SMTP only)",
      hint: "an app password, not the account password",
    },
    {
      id: "clientSecret",
      label: "OAuth client secret (Gmail / Microsoft 365 only)",
      hint: "from your own Google Cloud OAuth client or Entra app registration",
    },
    {
      id: "refreshToken",
      label: "OAuth refresh token (Gmail / Microsoft 365 only)",
      hint: "1//... (Google) or the refresh token from your tenant's consent",
    },
  ],
  settings: [
    { id: "provider", label: "Mailbox type", required: true, options: ZEN_EMAIL_PROVIDERS },
    { id: "address", label: "Mailbox address (the company's own)", required: true },
    { id: "displayName", label: "Name on outgoing mail", required: false },
    { id: "clientId", label: "OAuth client ID (Gmail / Microsoft 365)", required: false },
    { id: "tenantId", label: "Microsoft tenant ID (Microsoft 365)", required: false },
    { id: "username", label: "IMAP/SMTP user name (default: the address)", required: false },
    { id: "imapHost", label: "IMAP server (e.g. imap.firma.ro)", required: false },
    { id: "imapPort", label: "IMAP port (993)", required: false },
    { id: "smtpHost", label: "SMTP server (e.g. smtp.firma.ro)", required: false },
    { id: "smtpPort", label: "SMTP port (465 or 587)", required: false },
    {
      id: "security",
      label: "Connection security",
      required: false,
      options: ["tls", "starttls", "plain-local-test"],
    },
    { id: "pollSeconds", label: "Check every N seconds (60)", required: false },
    {
      id: "requireAuthPass",
      label: "Refuse mail that fails SPF/DKIM/DMARC",
      required: false,
      options: ["yes", "no"],
    },
  ],
  scopes: [
    "Gmail: https://www.googleapis.com/auth/gmail.modify, https://www.googleapis.com/auth/gmail.send",
    "Microsoft 365 (delegated): Mail.ReadWrite, Mail.Send, offline_access",
    "IMAP/SMTP: an app password for the mailbox",
  ],
  limits: { textChars: 100_000, uploadMb: 20, downloadMb: 25, buttons: 0 },
  features: {
    threads: true,
    typing: "native",
    slashCommands: false,
    buttons: false,
    directMessages: false,
    channels: true,
  },
  createUrl: "https://console.cloud.google.com/apis/credentials",
  docsUrl: "https://developers.google.com/gmail/api/guides",
};

export const ZEN_CHAT_PLATFORM_INFO: Readonly<Record<ZenChatPlatform, ZenChatPlatformInfo>> = {
  slack: {
    id: "slack",
    name: "Slack",
    transport: "outbound",
    transportName: "Socket Mode",
    secrets: [
      { id: "botToken", label: "Bot token", hint: "xoxb-..." },
      { id: "appToken", label: "App-level token (connections:write)", hint: "xapp-..." },
      { id: "signingSecret", label: "Signing secret (optional, for relayed events)", hint: "" },
    ],
    settings: [{ id: "teamId", label: "Workspace ID (T...)", required: true }],
    scopes: [
      "app_mentions:read",
      "chat:write",
      "im:history",
      "channels:history",
      "groups:history",
      "files:read",
      "files:write",
      "users:read",
      "users:read.email",
      "commands",
    ],
    limits: { textChars: 3500, uploadMb: 25, downloadMb: 25, buttons: 5 },
    features: {
      threads: true,
      typing: "placeholder",
      slashCommands: true,
      buttons: true,
      directMessages: true,
      channels: true,
    },
    createUrl: "https://api.slack.com/apps?new_app=1",
    docsUrl: "https://api.slack.com/apis/socket-mode",
  },
  teams: {
    id: "teams",
    name: "Microsoft Teams",
    transport: "hub-relay",
    transportName: "Bot Framework (webhook through the Zen hub)",
    secrets: [
      { id: "clientSecret", label: "Client secret of the bot's app registration", hint: "" },
    ],
    settings: [
      { id: "appId", label: "Microsoft App ID (bot id)", required: true },
      { id: "tenantId", label: "Directory (tenant) ID", required: true },
    ],
    scopes: ["bots: personal, team, groupChat (manifest)", "supportsFiles: true"],
    limits: { textChars: 7000, uploadMb: 25, downloadMb: 25, buttons: 6 },
    features: {
      threads: true,
      typing: "native",
      slashCommands: false,
      buttons: true,
      directMessages: true,
      channels: true,
    },
    createUrl: "https://dev.botframework.com/bots/new",
    docsUrl: "https://learn.microsoft.com/microsoftteams/platform/bots/what-are-bots",
  },
  discord: {
    id: "discord",
    name: "Discord",
    transport: "outbound",
    transportName: "Gateway (WebSocket)",
    secrets: [{ id: "botToken", label: "Bot token", hint: "" }],
    settings: [
      { id: "applicationId", label: "Application ID", required: true },
      { id: "guildId", label: "Server (guild) ID", required: true },
    ],
    scopes: [
      "bot",
      "applications.commands",
      "View Channels",
      "Send Messages",
      "Send Messages in Threads",
      "Read Message History",
      "Attach Files",
    ],
    limits: { textChars: 2000, uploadMb: 10, downloadMb: 25, buttons: 5 },
    features: {
      threads: true,
      typing: "native",
      slashCommands: true,
      buttons: true,
      directMessages: true,
      channels: true,
    },
    createUrl: "https://discord.com/developers/applications",
    docsUrl: "https://discord.com/developers/docs/events/gateway",
  },
  telegram: {
    id: "telegram",
    name: "Telegram",
    transport: "outbound",
    transportName: "Bot API long polling",
    secrets: [{ id: "botToken", label: "Bot token from @BotFather", hint: "123456:ABC..." }],
    settings: [{ id: "botUsername", label: "Bot username (without @)", required: true }],
    scopes: ["Group privacy: on (the bot sees only commands, mentions and replies)"],
    limits: { textChars: 4000, uploadMb: 50, downloadMb: 20, buttons: 8 },
    features: {
      threads: true,
      typing: "native",
      slashCommands: true,
      buttons: true,
      directMessages: true,
      channels: true,
    },
    createUrl: "https://t.me/BotFather",
    docsUrl: "https://core.telegram.org/bots/api",
  },
  googlechat: {
    id: "googlechat",
    name: "Google Chat",
    transport: "hub-relay",
    transportName: "HTTP endpoint (through the Zen hub)",
    secrets: [
      {
        id: "serviceAccountKey",
        label: "Service account key (JSON) of the Chat app",
        hint: '{"type":"service_account",...}',
      },
    ],
    settings: [{ id: "projectNumber", label: "Google Cloud project number", required: true }],
    scopes: ["https://www.googleapis.com/auth/chat.bot"],
    limits: { textChars: 4000, uploadMb: 0, downloadMb: 0, buttons: 5 },
    features: {
      threads: true,
      typing: "placeholder",
      slashCommands: true,
      buttons: true,
      directMessages: true,
      channels: true,
    },
    createUrl: "https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat",
    docsUrl: "https://developers.google.com/workspace/chat/quickstart/gcf-app",
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp Business",
    transport: "hub-relay",
    transportName: "Cloud API webhook (through the Zen hub)",
    secrets: [
      { id: "accessToken", label: "System user access token", hint: "EAA..." },
      { id: "appSecret", label: "App secret (webhook signatures)", hint: "" },
      { id: "verifyToken", label: "Webhook verify token (you choose it)", hint: "" },
    ],
    settings: [
      { id: "phoneNumberId", label: "Phone number ID", required: true },
      {
        id: "reportTemplate",
        label: "Approved template for reports (name:language)",
        required: false,
      },
    ],
    scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
    limits: { textChars: 4000, uploadMb: 100, downloadMb: 100, buttons: 3 },
    features: {
      threads: false,
      typing: "native",
      slashCommands: false,
      buttons: true,
      directMessages: true,
      channels: false,
    },
    createUrl: "https://developers.facebook.com/apps/create/",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
  },
  email: EMAIL_PLATFORM_INFO,
};

// Configuration (what the setup page edits). Kept by the runner in `<state dir>/zen/chat/chat.json`.

export type ZenChatConnectionScope = "company" | "personal";
export type ZenChatConnectionState =
  | "stopped"
  | "connecting"
  | "connected"
  | "waiting-relay"
  | "error"
  | "locked";

export interface ZenChatConnection {
  readonly id: string;
  readonly platform: ZenChatPlatform;
  readonly name: string;
  /** Company connections run only on the company runner; personal ones only for their owner. */
  readonly scope: ZenChatConnectionScope;
  readonly enabled: boolean;
  /** Platform workspace / tenant / guild ids that may talk to this bot. Empty = refuse all. */
  readonly workspaceAllowlist: ReadonlyArray<string>;
  /** Extra channels allowed without a binding (DM-only setups leave it empty). */
  readonly channelAllowlist: ReadonlyArray<string>;
  readonly settings: Readonly<Record<string, string>>;
}

export interface ZenChatConnectionView extends ZenChatConnection {
  readonly secretsStored: Readonly<Record<string, boolean>>;
  readonly state: ZenChatConnectionState;
  readonly detail: string | null;
  readonly lastEventAt: string | null;
  /** For hub-relay platforms: the address the platform must call (through the hub). */
  readonly webhookUrl: string | null;
}

export type ZenChatAgentKind = "company" | "personal";

/**
 * An AI staff member reachable from chat. Seam: `zen/staff` will provide these (with roles and
 * managers); until then the setup page defines them here.
 */
export interface ZenChatAgent {
  readonly id: string;
  readonly name: string;
  readonly kind: ZenChatAgentKind;
  /** The person who approves its outbound actions (company member e-mail). */
  readonly managerEmail: string;
  /** Personal agents: the person whose own machine and account run it. */
  readonly ownerEmail: string | null;
  readonly projectId: string;
  readonly model: string;
  readonly runtimeMode: "approval-required" | "auto-accept-edits" | "auto";
  readonly instructions: string;
}

export interface ZenChatBinding {
  readonly id: string;
  readonly connectionId: string;
  /** Platform channel / conversation id; `dm` = direct messages to the bot. */
  readonly channelId: string;
  readonly channelName: string;
  /** The agent that answers here. */
  readonly agentId: string;
  /** `mention`: only when the bot is mentioned or replied to; `all`: every message. */
  readonly respondTo: "mention" | "all";
  /** Agents allowed to post reports and messages here (the answering agent always may). */
  readonly posters: ReadonlyArray<string>;
}

export interface ZenChatIdentity {
  readonly platform: ZenChatPlatform;
  readonly workspaceId: string;
  readonly userId: string;
}

export interface ZenChatMember {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: "owner" | "admin" | "member" | "guest";
  readonly identities: ReadonlyArray<ZenChatIdentity>;
}

export interface ZenChatReport {
  readonly id: string;
  readonly name: string;
  readonly agentId: string;
  readonly bindingId: string;
  readonly prompt: string;
  /** 0 = Sunday ... 6 = Saturday. */
  readonly days: ReadonlyArray<number>;
  /** "HH:MM", server local time. */
  readonly time: string;
  readonly enabled: boolean;
  readonly lastRunAt: string | null;
  readonly lastStatus: string | null;
}

export interface ZenChatSettings {
  readonly quietHours: {
    readonly enabled: boolean;
    /** "HH:MM", server local time; may wrap past midnight. */
    readonly start: string;
    readonly end: string;
  };
  /** Log message text too (default: metadata only). */
  readonly logContent: boolean;
  /** Cap for files in and out, below each platform's own limit. */
  readonly maxAttachmentMb: number;
}

export const ZEN_CHAT_DEFAULT_SETTINGS: ZenChatSettings = {
  quietHours: { enabled: false, start: "20:00", end: "08:00" },
  logContent: false,
  maxAttachmentMb: 20,
};

export const ZEN_CHAT_DEFAULT_MODEL = "claude-haiku-5-5";

export interface ZenChatAccess {
  readonly isRunner: boolean;
  readonly runnerSource: "hub" | "local" | "none";
  readonly hubUser: string | null;
  /** The signed-in person may change integrations here (admin grant, or the runner's owner). */
  readonly canManage: boolean;
  readonly grants: ReadonlyArray<{
    readonly user: string;
    readonly grantedBy: string;
    readonly at: string;
  }>;
  readonly lock: string | null;
}

export interface ZenChatStatus {
  readonly access: ZenChatAccess;
  readonly vaultKeyStore: "keychain" | "file";
  readonly connections: ReadonlyArray<ZenChatConnectionView>;
  readonly agents: ReadonlyArray<ZenChatAgent>;
  readonly bindings: ReadonlyArray<ZenChatBinding>;
  readonly members: ReadonlyArray<ZenChatMember>;
  readonly reports: ReadonlyArray<ZenChatReport>;
  readonly settings: ZenChatSettings;
  readonly pendingApprovals: number;
  readonly conversations: number;
}

export interface ZenChatAuditEntry {
  readonly at: string;
  readonly direction: "in" | "out" | "system";
  readonly platform: ZenChatPlatform;
  readonly connectionId: string;
  readonly kind: string;
  readonly workspaceId: string | null;
  readonly channelId: string | null;
  readonly userId: string | null;
  readonly memberEmail: string | null;
  readonly agentId: string | null;
  readonly threadId: string | null;
  readonly chars: number;
  readonly attachments: number;
  readonly outcome: string;
  readonly redacted?: ReadonlyArray<string>;
  readonly text?: string;
}

/** Why an inbound mail was flagged as a possible prompt injection (see chat/email/injection.ts). */
export type ZenEmailFlagKind =
  | "credentials"
  | "payment"
  | "exfiltration"
  | "instructions"
  | "hidden-text"
  | "impersonation"
  | "link-mismatch"
  | "auth-failed"
  /** The agent itself refused something in the mail ("FLAG:" line in its answer). */
  | "agent-note";

export interface ZenEmailFlag {
  readonly kind: ZenEmailFlagKind;
  /** A short quote of what triggered it (redacted). */
  readonly evidence: string;
}

/** A drafted e-mail waiting for (or decided by) the agent's manager. */
export interface ZenChatEmailApprovalView {
  readonly id: string;
  readonly connectionId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly managerEmail: string;
  readonly threadId: string;
  readonly status: "pending" | "accepted" | "declined" | "expired";
  readonly kind: "email-reply" | "tool";
  readonly to: ReadonlyArray<string>;
  readonly cc: ReadonlyArray<string>;
  readonly subject: string;
  /** The reply text (already redacted); the manager may edit it before sending. */
  readonly body: string;
  readonly attachments: ReadonlyArray<{ readonly name: string; readonly sizeBytes: number }>;
  /** The mail it answers: sender, subject and the start of its text. */
  readonly original: {
    readonly from: string;
    readonly subject: string;
    readonly excerpt: string;
    readonly at: string | null;
  } | null;
  readonly flags: ReadonlyArray<ZenEmailFlag>;
  readonly createdAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly sendResult: string | null;
}
