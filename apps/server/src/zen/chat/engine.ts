// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Plain async engine driven by adapters and a timer; ZenChat.ts wraps it.
// Zen Staff chat integrations: the common layer. Every adapter hands its events here; the engine
// routes them to an agent's Zen thread, follows the run (typing, answers, approvals) and posts
// back through the adapter's PlatformClient. It knows no platform payloads and no Effect services:
// the agent side is the `AgentRuntime` interface (ZenChat.ts implements it with the orchestrator),
// which keeps the whole flow testable without a network or a model.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZEN_CHAT_PLATFORM_INFO,
  type ZenChatAgent,
  type ZenChatAuditEntry,
  type ZenChatConnection,
  type ZenChatEmailApprovalView,
  type ZenChatPlatform,
  type ZenEmailFlag,
} from "@t3tools/contracts/zenChat";
import { redactSensitive } from "@t3tools/contracts/zenSecrets";

import type {
  ConversationTarget,
  InboundAction,
  InboundEvent,
  InboundMessage,
  OutboundButton,
  PlatformClient,
} from "./model.ts";
import {
  bindingFor,
  conversationKey,
  identityOf,
  mayPost,
  memberFor,
  parseApprovalValue,
  reportDue,
  routeInbound,
  threadRootFor,
  type ChatConfig,
  type RefusalReply,
  type RouteContext,
} from "./policy.ts";
import {
  authenticationResult,
  automaticMailReason,
  draftFromAnswer,
  emailAgentBrief,
  injectionFlags,
  requireAuthPass,
  routeEmail,
  senderAllowed,
  threadRootOf,
} from "./email/emailPolicy.ts";
import { quoteOriginal, replySubject, splitQuoted } from "./email/mime.ts";
import type {
  ApprovalRecord,
  AuditLog,
  EmailContext,
  EmailDraft,
  FollowRecord,
  RuntimeState,
} from "./store.ts";
import { chatStrings } from "./strings.ts";
import {
  chunkText,
  formatFor,
  mimeFromName,
  parseZenCommand,
  referencedFiles,
  safeFileName,
} from "./text.ts";

// The agent side

export interface AgentReply {
  readonly id: string;
  readonly text: string;
}

export interface AgentApprovalRequest {
  readonly requestId: string;
  readonly kind: string;
  /** What the agent wants to do (command, file, tool), as the provider described it. */
  readonly prompt: string;
}

export interface AgentObservation {
  readonly exists: boolean;
  readonly running: boolean;
  /** Finished assistant messages after the follow's start, oldest first. */
  readonly replies: ReadonlyArray<AgentReply>;
  readonly approvals: ReadonlyArray<AgentApprovalRequest>;
  /** The run ended without success (failed, interrupted). */
  readonly failed: boolean;
}

export interface AgentRuntime {
  start(input: {
    readonly agent: ZenChatAgent;
    readonly title: string;
    readonly text: string;
  }): Promise<{ readonly threadId: string; readonly messageId: string }>;
  send(input: {
    readonly agent: ZenChatAgent;
    readonly threadId: string;
    readonly text: string;
  }): Promise<{ readonly messageId: string }>;
  observe(threadId: string, afterMessageId: string): Promise<AgentObservation>;
  respond(threadId: string, requestId: string, decision: "accept" | "decline"): Promise<void>;
  /** The agent's working folder: the only place outbound files may come from. */
  projectRoot(projectId: string): Promise<string | null>;
}

export interface EngineDeps {
  readonly config: () => ChatConfig;
  readonly runtime: AgentRuntime;
  readonly state: () => RuntimeState;
  readonly setState: (change: (current: RuntimeState) => RuntimeState) => void;
  readonly audit: AuditLog;
  readonly context: () => RouteContext;
  /** Where downloaded attachments go (`<state dir>/zen/chat/inbox`). */
  readonly inboxDir: string;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
  /** Report runs: record the run on the report. */
  readonly onReportRun?: (reportId: string, status: string, at: string) => void;
}

const TYPING_EVERY_MS = 4_000;
const USER_LIMIT_PER_MINUTE = 12;

export class ChatEngine {
  private readonly clients = new Map<string, PlatformClient>();
  private readonly lastTyping = new Map<string, number>();
  private readonly recentByUser = new Map<string, number[]>();
  private readonly busy = new Set<string>();
  /** @mention replies posted in a conversation: mention key -> platform message to update. */
  private readonly mentionMessages = new Map<string, { connectionId: string; messageId: string }>();
  private readonly deps: EngineDeps;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private log(message: string) {
    this.deps.log?.(message);
  }

  registerClient(connectionId: string, client: PlatformClient): void {
    this.clients.set(connectionId, client);
  }

  unregisterClient(connectionId: string): void {
    this.clients.delete(connectionId);
  }

  private connection(connectionId: string): ZenChatConnection | undefined {
    return this.deps.config().connections.find((candidate) => candidate.id === connectionId);
  }

  private strings(connection: ZenChatConnection | undefined) {
    return chatStrings(connection?.settings.language);
  }

  private audit(entry: Omit<ZenChatAuditEntry, "at" | "text"> & { readonly text?: string }) {
    const { text, ...rest } = entry;
    const logContent = this.deps.config().settings.logContent;
    this.deps.audit.write({
      ...rest,
      at: this.now().toISOString(),
      ...(logContent && text !== undefined ? { text: redactSensitive(text).text } : {}),
    });
  }

  // Outbound helpers

  /** Formats, redacts, chunks and posts. Returns the platform id of every piece. */
  async postMarkdown(
    connectionId: string,
    target: ConversationTarget,
    markdown: string,
    options: {
      readonly buttons?: ReadonlyArray<OutboundButton>;
      readonly proactive?: boolean;
      readonly kind: string;
      readonly agentId?: string | null;
      readonly threadId?: string | null;
      readonly userId?: string | null;
    },
  ): Promise<string[]> {
    const client = this.clients.get(connectionId);
    const connection = this.connection(connectionId);
    if (client === undefined || connection === undefined) return [];
    // A mailbox never answers on its own: replies are drafts the manager approves (emailDraft).
    if (connection.platform === "email") return [];
    const redacted = redactSensitive(markdown);
    const info = ZEN_CHAT_PLATFORM_INFO[connection.platform];
    const pieces = chunkText(
      formatFor(connection.platform, redacted.text),
      info.limits.textChars,
      connection.platform,
    );
    const ids: string[] = [];
    for (const [index, piece] of pieces.entries()) {
      const last = index === pieces.length - 1;
      try {
        const posted = await client.post(target, {
          text: piece,
          ...(last && options.buttons
            ? { buttons: options.buttons.slice(0, info.limits.buttons) }
            : {}),
          ...(options.proactive ? { proactive: true } : {}),
        });
        ids.push(posted.messageId);
      } catch (error) {
        this.log(`chat: post failed on ${connection.platform}: ${String(error)}`);
        this.auditOut(connection, target, options, piece, "failed", redacted.kinds);
        return ids;
      }
    }
    this.auditOut(
      connection,
      target,
      options,
      redacted.text,
      `posted ${pieces.length}`,
      redacted.kinds,
    );
    return ids;
  }

  private auditOut(
    connection: ZenChatConnection,
    target: ConversationTarget,
    options: {
      kind: string;
      agentId?: string | null;
      threadId?: string | null;
      userId?: string | null;
    },
    text: string,
    outcome: string,
    redacted: ReadonlyArray<string>,
  ) {
    this.audit({
      direction: "out",
      platform: connection.platform,
      connectionId: connection.id,
      kind: options.kind,
      workspaceId: target.workspaceId,
      channelId: target.channelId,
      userId: options.userId ?? null,
      memberEmail: null,
      agentId: options.agentId ?? null,
      threadId: options.threadId ?? null,
      chars: text.length,
      attachments: 0,
      outcome,
      ...(redacted.length > 0 ? { redacted } : {}),
      text,
    });
  }

  private async reply(
    connection: ZenChatConnection,
    event: InboundEvent,
    markdown: string,
    kind: string,
  ): Promise<void> {
    const threaded = ZEN_CHAT_PLATFORM_INFO[connection.platform].features.threads;
    const target: ConversationTarget = {
      workspaceId: event.workspaceId,
      channelId: event.channelId,
      threadId: event.type === "message" ? threadRootFor(event, threaded) : event.threadId,
      replyTo: event.type === "message" ? event.messageId : null,
    };
    await this.postMarkdown(connection.id, target, markdown, { kind, userId: event.user.id });
  }

  // Inbound

  async handleEvent(connectionId: string, event: InboundEvent): Promise<void> {
    const connection = this.connection(connectionId);
    if (connection === undefined || !connection.enabled) return;
    if (event.type === "action") return this.handleAction(connection, event);
    return this.handleMessage(connection, event);
  }

  private rateLimited(userKey: string): boolean {
    const now = this.now().getTime();
    const recent = (this.recentByUser.get(userKey) ?? []).filter((at) => now - at < 60_000);
    recent.push(now);
    this.recentByUser.set(userKey, recent);
    return recent.length > USER_LIMIT_PER_MINUTE;
  }

  private async handleMessage(connection: ZenChatConnection, raw: InboundMessage): Promise<void> {
    if (connection.platform === "email") return this.handleEmail(connection, raw);
    const config = this.deps.config();
    const typed = raw.command ?? parseZenCommand(raw.text);
    let message: InboundMessage =
      typed !== null ? { ...raw, command: typed, text: typed.args, mentioned: true } : raw;
    const t = this.strings(connection);
    const auditBase = {
      direction: "in" as const,
      platform: connection.platform,
      connectionId: connection.id,
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      userId: message.user.id,
      chars: message.text.length,
      attachments: message.attachments.length,
      text: message.text,
    };

    if (message.command !== null && /^(status|help)$/i.test(message.command.args)) {
      const allowed = connection.workspaceAllowlist.includes(message.workspaceId);
      this.audit({
        ...auditBase,
        kind: "command",
        memberEmail: null,
        agentId: null,
        threadId: null,
        outcome: allowed ? message.command.args.toLowerCase() : "ignored: workspace",
      });
      if (!allowed) return;
      const answer = /^help$/i.test(message.command.args)
        ? t.help
        : this.statusText(connection, message);
      if (message.responseRef !== undefined && this.clients.get(connection.id)?.answer) {
        await this.clients.get(connection.id)!.answer!(
          message,
          formatFor(connection.platform, answer),
        );
      } else {
        await this.reply(connection, message, answer, "command-reply");
      }
      return;
    }

    message = await this.withThreadContext(connection, message);
    const decision = routeInbound(config, connection, message, this.deps.context());
    const member =
      decision.kind === "agent"
        ? decision.member
        : memberFor(config.members, connection.platform, message.workspaceId, message.user);
    if (decision.kind === "ignore") {
      this.audit({
        ...auditBase,
        kind: "message",
        memberEmail: member?.email ?? null,
        agentId: null,
        threadId: null,
        outcome: `ignored: ${decision.reason}`,
      });
      return;
    }
    if (decision.kind === "refuse") {
      this.audit({
        ...auditBase,
        kind: "message",
        memberEmail: member?.email ?? null,
        agentId: null,
        threadId: null,
        outcome: `refused: ${decision.reason}`,
      });
      if (decision.reply !== null) {
        const text = this.refusalText(t, decision.reply);
        await this.reply(
          connection,
          message,
          decision.reply === "unknown-person"
            ? `${text} (${platformName(connection.platform)} id: ${message.user.id})`
            : text,
          "refusal",
        );
      }
      return;
    }
    if (this.rateLimited(`${connection.id}:${message.user.id}`)) {
      this.audit({
        ...auditBase,
        kind: "message",
        memberEmail: decision.member.email,
        agentId: decision.agent.id,
        threadId: null,
        outcome: "refused: rate limit",
      });
      await this.reply(connection, message, t.rateLimited, "refusal");
      return;
    }

    const { agent, member: sender } = decision;
    const threaded = ZEN_CHAT_PLATFORM_INFO[connection.platform].features.threads;
    const threadRoot = threadRootFor(message, threaded);
    const key = conversationKey({
      connectionId: connection.id,
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      threadRoot,
      agentId: agent.id,
    });
    const target: ConversationTarget = {
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      threadId: threadRoot,
      replyTo: message.messageId,
    };
    const where = this.describeWhere(connection, message);
    const files = await this.downloadAttachments(connection, message, key, target);
    const existing = this.deps.state().conversations[key];
    const body = this.agentMessage({
      connection,
      message,
      sender,
      where,
      files,
      first: existing === undefined,
      agent,
    });

    const client = this.clients.get(connection.id);
    let placeholderId: string | null = null;
    if (ZEN_CHAT_PLATFORM_INFO[connection.platform].features.typing === "placeholder") {
      placeholderId =
        (
          await this.postMarkdown(connection.id, target, t.working, {
            kind: "working",
            agentId: agent.id,
          })
        )[0] ?? null;
    } else {
      await client?.typing?.(target).catch(() => undefined);
    }

    let threadId: string;
    let afterMessageId: string;
    try {
      if (existing !== undefined) {
        const sent = await this.deps.runtime.send({
          agent,
          threadId: existing.threadId,
          text: body,
        });
        threadId = existing.threadId;
        afterMessageId = sent.messageId;
      } else {
        const started = await this.deps.runtime.start({
          agent,
          title: `${connection.platform === "slack" ? "Slack" : ZEN_CHAT_PLATFORM_INFO[connection.platform].name}: ${message.text.slice(0, 60) || where}`,
          text: body,
        });
        threadId = started.threadId;
        afterMessageId = started.messageId;
      }
    } catch (error) {
      this.log(`chat: could not start the agent: ${String(error)}`);
      this.audit({
        ...auditBase,
        kind: "message",
        memberEmail: sender.email,
        agentId: agent.id,
        threadId: existing?.threadId ?? null,
        outcome: "failed: agent start",
      });
      await this.reply(connection, message, t.runFailed, "error");
      return;
    }
    const nowIso = this.now().toISOString();
    this.audit({
      ...auditBase,
      kind: message.command ? "command" : "message",
      memberEmail: sender.email,
      agentId: agent.id,
      threadId,
      outcome: existing ? "sent to thread" : "started thread",
    });
    this.deps.setState((current) => ({
      ...current,
      conversations: {
        ...current.conversations,
        [key]: {
          key,
          connectionId: connection.id,
          agentId: agent.id,
          threadId,
          target: { ...target, replyTo: null },
          where,
          createdAt: existing?.createdAt ?? nowIso,
          updatedAt: nowIso,
        },
      },
      follows: {
        ...current.follows,
        [threadId]: {
          threadId,
          connectionId: connection.id,
          agentId: agent.id,
          conversationKey: key,
          target,
          where,
          askedBy: sender.name || sender.email,
          afterMessageId,
          postedMessageIds: current.follows[threadId]?.postedMessageIds ?? [],
          approvalRequestIds: current.follows[threadId]?.approvalRequestIds ?? [],
          placeholderId,
          proactive: false,
          reportId: null,
          startedAt: nowIso,
        },
      },
    }));
  }

  /**
   * A reply inside a thread the bot already answers continues that conversation without a new
   * mention. A slash command has no message to thread under, so it gets an anchor message first.
   */
  private async withThreadContext(
    connection: ZenChatConnection,
    message: InboundMessage,
  ): Promise<InboundMessage> {
    const config = this.deps.config();
    const binding = bindingFor(config, connection.id, message.channelId, message.channelType);
    if (binding === null) return message;
    if (!message.mentioned && message.threadId !== null) {
      const key = conversationKey({
        connectionId: connection.id,
        workspaceId: message.workspaceId,
        channelId: message.channelId,
        threadRoot: message.threadId,
        agentId: binding.agentId,
      });
      if (this.deps.state().conversations[key] !== undefined)
        return { ...message, mentioned: true };
    }
    const threaded = ZEN_CHAT_PLATFORM_INFO[connection.platform].features.threads;
    if (
      message.command !== null &&
      message.messageId === "" &&
      threaded &&
      message.channelType !== "dm" &&
      message.text.trim() !== ""
    ) {
      if (!connection.workspaceAllowlist.includes(message.workspaceId)) return message;
      const member = memberFor(
        config.members,
        connection.platform,
        message.workspaceId,
        message.user,
      );
      if (member === null) return message;
      const [anchor] = await this.postMarkdown(
        connection.id,
        { workspaceId: message.workspaceId, channelId: message.channelId, threadId: null },
        `**${member.name || member.email}:** ${message.text}`,
        { kind: "command-anchor", userId: message.user.id },
      );
      if (anchor !== undefined) return { ...message, messageId: anchor };
    }
    return message;
  }

  private refusalText(t: ReturnType<typeof chatStrings>, reply: RefusalReply): string {
    switch (reply) {
      case "unknown-person":
        return t.unknownPerson;
      case "guest":
        return t.guest;
      case "personal-unavailable":
        return t.personalUnavailable;
      case "personal-not-owner":
        return t.personalNotOwner;
      case "needs-runner":
        return t.needsRunner;
      default:
        return t.noAgent;
    }
  }

  private statusText(connection: ZenChatConnection, message: InboundMessage): string {
    const t = this.strings(connection);
    const config = this.deps.config();
    const binding = bindingFor(config, connection.id, message.channelId, message.channelType);
    const agent = config.agents.find((candidate) => candidate.id === binding?.agentId);
    if (binding === null || agent === undefined) return t.statusNone;
    const state = this.deps.state();
    const running = Object.values(state.follows).filter(
      (follow) =>
        follow.connectionId === connection.id && follow.target.channelId === message.channelId,
    ).length;
    const approvals = Object.values(state.approvals).filter(
      (approval) =>
        approval.status === "pending" &&
        approval.connectionId === connection.id &&
        approval.target.channelId === message.channelId,
    ).length;
    return t.status(agent.name, running, approvals);
  }

  private describeWhere(connection: ZenChatConnection, message: InboundMessage): string {
    const platform = ZEN_CHAT_PLATFORM_INFO[connection.platform].name;
    if (message.channelType === "dm") return `${platform} (direct message)`;
    const binding = bindingFor(
      this.deps.config(),
      connection.id,
      message.channelId,
      message.channelType,
    );
    const name = binding?.channelName || message.channelId;
    return `${platform} ${name.startsWith("#") ? name : `#${name}`}`;
  }

  private agentMessage(input: {
    connection: ZenChatConnection;
    message: InboundMessage;
    sender: { name: string; email: string };
    where: string;
    files: ReadonlyArray<string>;
    first: boolean;
    agent: ZenChatAgent;
  }): string {
    const lines: string[] = [];
    if (input.first) {
      lines.push(
        `[You are ${input.agent.name}, a member of the company's AI staff, answering in ${input.where}. ` +
          "Your final answer is posted back to that chat automatically: keep it short, plain and in the language of the message. " +
          "To send a file, save it in your working folder and embed it as `![title](/absolute/path)`. " +
          "Before anything that acts outside this folder (sending e-mails or messages, posting, paying, deleting), run it as a command: your manager approves it in chat first.]",
      );
      if (input.agent.instructions.trim() !== "") lines.push(input.agent.instructions.trim());
      lines.push("");
    }
    lines.push(
      `${input.sender.name || input.sender.email} (${input.sender.email}) in ${input.where}:`,
    );
    lines.push(input.message.text.trim() === "" ? "(no text)" : input.message.text.trim());
    if (input.files.length > 0) {
      lines.push("", "Attached files (read them from these paths):");
      for (const file of input.files) lines.push(`- ${file}`);
    }
    return lines.join("\n");
  }

  private async downloadAttachments(
    connection: ZenChatConnection,
    message: InboundMessage,
    key: string,
    target: ConversationTarget,
  ): Promise<string[]> {
    if (message.attachments.length === 0) return [];
    const client = this.clients.get(connection.id);
    const t = this.strings(connection);
    const info = ZEN_CHAT_PLATFORM_INFO[connection.platform];
    const limitMb = Math.min(
      this.deps.config().settings.maxAttachmentMb,
      info.limits.downloadMb || Infinity,
    );
    const folder = NodePath.join(
      this.deps.inboxDir,
      NodeCrypto.createHash("sha256").update(key).digest("hex").slice(0, 16),
    );
    const saved: string[] = [];
    for (const attachment of message.attachments.slice(0, 10)) {
      if (attachment.sizeBytes !== null && attachment.sizeBytes > limitMb * 1024 * 1024) {
        await this.postMarkdown(connection.id, target, t.fileTooLarge(attachment.name, limitMb), {
          kind: "file-skipped",
        });
        continue;
      }
      try {
        if (client?.download === undefined) throw new Error("no download");
        const bytes = await client.download(attachment);
        if (bytes.byteLength > limitMb * 1024 * 1024) {
          await this.postMarkdown(connection.id, target, t.fileTooLarge(attachment.name, limitMb), {
            kind: "file-skipped",
          });
          continue;
        }
        NodeFS.mkdirSync(folder, { recursive: true, mode: 0o700 });
        const name = `${Date.now().toString(36)}-${safeFileName(attachment.name)}`;
        const path = NodePath.join(folder, name);
        NodeFS.writeFileSync(path, bytes, { mode: 0o600 });
        saved.push(
          `${path} (${attachment.kind}, ${attachment.mimeType}, ${Math.ceil(bytes.byteLength / 1024)} KB)`,
        );
      } catch {
        await this.postMarkdown(connection.id, target, t.fileFailed(attachment.name), {
          kind: "file-failed",
        });
      }
    }
    return saved;
  }

  // E-mail: the company's mailbox as a channel. Inbound mail is untrusted; answers are drafts.

  private ownAddresses(connection: ZenChatConnection): string[] {
    const bound = this.deps
      .config()
      .bindings.filter((binding) => binding.connectionId === connection.id)
      .map((binding) => binding.channelId)
      .filter((channel) => channel.includes("@"));
    return [connection.settings.address ?? "", ...bound].filter((value) => value !== "");
  }

  private async handleEmail(connection: ZenChatConnection, message: InboundMessage): Promise<void> {
    const meta = message.email;
    if (meta === undefined) return;
    const config = this.deps.config();
    const mail = meta.mail;
    const from = mail.from?.address ?? "";
    const auditIn = (outcome: string, extra: { agentId?: string; threadId?: string } = {}) =>
      this.audit({
        direction: "in",
        platform: "email",
        connectionId: connection.id,
        kind: "email",
        workspaceId: message.workspaceId,
        channelId: null,
        userId: from,
        memberEmail: null,
        agentId: extra.agentId ?? null,
        threadId: extra.threadId ?? null,
        chars: mail.text.length,
        attachments: mail.attachments.length,
        outcome,
        text: `${mail.subject}\n${mail.text}`,
      });
    const automatic = automaticMailReason(mail, this.ownAddresses(connection));
    if (automatic !== null) return auditIn(`ignored: ${automatic}`);
    if (!senderAllowed(connection.workspaceAllowlist, from))
      return auditIn("ignored: sender not on the allow-list");
    const auth = authenticationResult(mail);
    if (auth === "fail" && requireAuthPass(connection))
      return auditIn("refused: SPF/DKIM/DMARC failed");
    const route = routeEmail(config.bindings, connection.id, mail, meta.labels);
    if (route === null) return auditIn("ignored: no alias or label for an agent");
    const agent = config.agents.find((candidate) => candidate.id === route.binding.agentId);
    if (agent === undefined) return auditIn("ignored: agent missing");
    const context = this.deps.context();
    if (agent.kind === "company" && (connection.scope !== "company" || !context.isRunner))
      return auditIn("refused: company agent off the runner", { agentId: agent.id });
    if (agent.kind === "personal" && !context.personalAgentAvailable(agent))
      return auditIn("refused: personal agent unavailable", { agentId: agent.id });
    if (this.rateLimited(`${connection.id}:${from}`))
      return auditIn("refused: rate limit", { agentId: agent.id });

    const flags = injectionFlags({ mail, members: config.members, auth });
    const root = threadRootOf(mail, meta.providerThreadId);
    const key = conversationKey({
      connectionId: connection.id,
      workspaceId: "email",
      channelId: route.via.toLowerCase(),
      threadRoot: root,
      agentId: agent.id,
    });
    const target: ConversationTarget = {
      workspaceId: message.workspaceId,
      channelId: route.via,
      threadId: root,
      replyTo: mail.messageId,
    };
    const files = await this.downloadAttachments(connection, message, key, target);
    const { latest, quoted } = splitQuoted(mail.text);
    const existing = this.deps.state().conversations[key];
    const fromLabel = mail.from?.name ? `${mail.from.name} <${from}>` : from;
    const body = emailAgentBrief({
      agentName: agent.name,
      mailbox: connection.settings.address ?? "",
      via: route.via,
      first: existing === undefined,
      instructions: agent.instructions,
      from: fromLabel,
      subject: mail.subject,
      date: mail.date,
      latest,
      quoted,
      files,
      flags,
    });
    let threadId: string;
    let afterMessageId: string;
    try {
      if (existing !== undefined) {
        const sent = await this.deps.runtime.send({
          agent,
          threadId: existing.threadId,
          text: body,
        });
        threadId = existing.threadId;
        afterMessageId = sent.messageId;
      } else {
        const started = await this.deps.runtime.start({
          agent,
          title: `E-mail: ${mail.subject.slice(0, 60) || from}`,
          text: body,
        });
        threadId = started.threadId;
        afterMessageId = started.messageId;
      }
    } catch (error) {
      this.log(`chat: could not start the agent for an e-mail: ${String(error)}`);
      return auditIn("failed: agent start", { agentId: agent.id });
    }
    auditIn(
      `${existing ? "sent to thread" : "started thread"}${flags.length > 0 ? `; flagged: ${[...new Set(flags.map((flag) => flag.kind))].join(",")}` : ""}`,
      { agentId: agent.id, threadId },
    );
    const allow = connection.workspaceAllowlist;
    const own = new Set(this.ownAddresses(connection).map((value) => value.toLowerCase()));
    // Replies go back to the sender only (Reply-To only when it is allow-listed too), and to
    // allow-listed people in Cc: the mail cannot point the agent at other addresses.
    const replyTo =
      mail.replyTo.find((item) => senderAllowed(allow, item.address))?.address ?? from;
    const emailContext: EmailContext = {
      mailbox: connection.settings.address ?? "",
      displayName: connection.settings.displayName || agent.name,
      replyTo,
      cc: [...mail.to, ...mail.cc]
        .map((item) => item.address)
        .filter(
          (address) => !own.has(address) && address !== replyTo && senderAllowed(allow, address),
        )
        .slice(0, 10),
      subject: mail.subject,
      messageId: mail.messageId,
      references: [...mail.references],
      providerThreadId: meta.providerThreadId,
      from: fromLabel,
      at: mail.date,
      text: mail.text.slice(0, 20_000),
      flags,
      locale: connection.settings.language === "en" ? "en" : "ro",
    };
    const nowIso = this.now().toISOString();
    this.deps.setState((current) => ({
      ...current,
      conversations: {
        ...current.conversations,
        [key]: {
          key,
          connectionId: connection.id,
          agentId: agent.id,
          threadId,
          target: { ...target, replyTo: null },
          where: `e-mail ${route.via}`,
          createdAt: existing?.createdAt ?? nowIso,
          updatedAt: nowIso,
        },
      },
      follows: {
        ...current.follows,
        [threadId]: {
          threadId,
          connectionId: connection.id,
          agentId: agent.id,
          conversationKey: key,
          target,
          where: `e-mail ${route.via}`,
          askedBy: fromLabel,
          afterMessageId,
          postedMessageIds: [],
          approvalRequestIds: current.follows[threadId]?.approvalRequestIds ?? [],
          placeholderId: null,
          proactive: false,
          reportId: null,
          startedAt: nowIso,
          email: emailContext,
        },
      },
    }));
  }

  /** The run that answers a mail ended: its final answer becomes a draft for the manager. */
  private async followEmail(
    connection: ZenChatConnection,
    follow: FollowRecord,
    observation: AgentObservation,
  ): Promise<void> {
    const fresh = observation.replies.filter(
      (reply) => !follow.postedMessageIds.includes(reply.id),
    );
    const last = fresh.at(-1);
    this.dropFollow(follow.threadId);
    const agent = this.deps.config().agents.find((candidate) => candidate.id === follow.agentId);
    if (agent === undefined) return;
    if (follow.reportId !== null) {
      await this.sendEmailReport(connection, follow, agent, last?.text ?? "", observation.failed);
      return;
    }
    if (last === undefined || follow.email === undefined) {
      this.audit({
        direction: "system",
        platform: "email",
        connectionId: connection.id,
        kind: "draft",
        workspaceId: follow.target.workspaceId,
        channelId: follow.target.channelId,
        userId: null,
        memberEmail: null,
        agentId: agent.id,
        threadId: follow.threadId,
        chars: 0,
        attachments: 0,
        outcome: observation.failed ? "failed: run" : "no answer",
      });
      return;
    }
    await this.createEmailDraft(connection, follow, agent, follow.email, last.text);
  }

  private async createEmailDraft(
    connection: ZenChatConnection,
    follow: FollowRecord,
    agent: ZenChatAgent,
    context: EmailContext,
    answer: string,
  ): Promise<ApprovalRecord> {
    const files = await this.outboundFiles(connection, agent, answer);
    const { body, agentFlags } = draftFromAnswer(
      answer.replace(/!\[([^\]]*)\]\((\/[^)\s]+)\)/g, (_m, title: string, path: string) =>
        files.some((file) => file.path === path || path.endsWith(file.name))
          ? `[${title || NodePath.basename(path)}]`
          : `[${title || "file"}]`,
      ),
    );
    const redacted = redactSensitive(body);
    const flags: ZenEmailFlag[] = [
      ...context.flags,
      ...agentFlags.map((note) => ({ kind: "agent-note" as const, evidence: note.slice(0, 200) })),
    ];
    const draft: EmailDraft = {
      context,
      to: [context.replyTo],
      cc: [...context.cc],
      subject: replySubject(context.subject),
      body: redacted.text,
      attachments: files.map((file) => ({
        path: file.path,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      })),
      flags,
      sendResult: null,
    };
    const id = NodeCrypto.randomBytes(8).toString("hex");
    const record: ApprovalRecord = {
      id,
      connectionId: connection.id,
      agentId: agent.id,
      threadId: follow.threadId,
      requestId: id,
      kind: "email-reply",
      prompt: this.emailCardText(draft),
      where: follow.where,
      askedBy: follow.askedBy,
      target: { ...follow.target, replyTo: null },
      cards: [],
      status: "pending",
      decidedBy: null,
      createdAt: this.now().toISOString(),
      decidedAt: null,
      email: draft,
    };
    this.deps.setState((current) => ({
      ...current,
      approvals: { ...current.approvals, [id]: record },
    }));
    this.audit({
      direction: "system",
      platform: "email",
      connectionId: connection.id,
      kind: "draft",
      workspaceId: follow.target.workspaceId,
      channelId: follow.target.channelId,
      userId: null,
      memberEmail: agent.managerEmail,
      agentId: agent.id,
      threadId: follow.threadId,
      chars: draft.body.length,
      attachments: draft.attachments.length,
      outcome: `waiting for approval${flags.length > 0 ? `; flagged: ${[...new Set(flags.map((flag) => flag.kind))].join(",")}` : ""}`,
      ...(redacted.kinds.length > 0 ? { redacted: redacted.kinds } : {}),
      text: draft.body,
    });
    await this.sendManagerCards(record, agent);
    return record;
  }

  private emailCardText(draft: EmailDraft): string {
    return [
      `To: ${draft.to.join(", ")}${draft.cc.length > 0 ? ` (cc ${draft.cc.join(", ")})` : ""}`,
      `Subject: ${draft.subject}`,
      ...(draft.flags.length > 0
        ? [`Flags: ${draft.flags.map((flag) => `${flag.kind} (${flag.evidence})`).join("; ")}`]
        : []),
      ...(draft.attachments.length > 0
        ? [`Files: ${draft.attachments.map((file) => file.name).join(", ")}`]
        : []),
      "",
      draft.body.slice(0, 1200),
    ].join("\n");
  }

  /**
   * Cards for an approval whose own connection cannot carry buttons (a mailbox): a DM to the
   * manager on every running chat connection where the manager is linked. The page lists it too.
   */
  private async sendManagerCards(record: ApprovalRecord, agent: ZenChatAgent): Promise<void> {
    const config = this.deps.config();
    const manager = config.members.find(
      (member) => member.email.toLowerCase() === agent.managerEmail.toLowerCase(),
    );
    if (manager === undefined) return;
    const cards: ApprovalRecord["cards"][number][] = [];
    for (const other of config.connections) {
      if (other.platform === "email" || !other.enabled) continue;
      const client = this.clients.get(other.id);
      if (client?.directMessage === undefined) continue;
      const workspaceId = other.workspaceAllowlist[0] ?? "";
      const userId = identityOf(manager, other.platform, workspaceId);
      if (userId === null) continue;
      const t = this.strings(other);
      // A notice only: approvals happen in the app ("De aprobat"), never from a messaging app.
      const text = formatFor(
        other.platform,
        `${this.approvalCardMarkdown(t, agent, record)}\n${t.approveInApp}`,
      );
      const sent = await client.directMessage(workspaceId, userId, { text }).catch(() => null);
      if (sent === null) continue;
      cards.push({
        target: { workspaceId, channelId: sent.channelId, threadId: null },
        messageId: sent.messageId,
        connectionId: other.id,
      });
      this.auditOut(
        other,
        { workspaceId, channelId: sent.channelId, threadId: null },
        { kind: "approval-request", agentId: agent.id, threadId: record.threadId, userId },
        record.prompt,
        "sent to manager",
        [],
      );
    }
    if (cards.length === 0) return;
    this.setApproval(record.id, {
      cards: [...(this.deps.state().approvals[record.id]?.cards ?? []), ...cards],
    });
  }

  /** Sends an approved draft from the mailbox, as a reply in the original thread. */
  private async sendEmailDraft(
    approval: ApprovalRecord,
    editedBody: string | null,
  ): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
    const draft = approval.email;
    const client = this.clients.get(approval.connectionId);
    const connection = this.connection(approval.connectionId);
    if (draft === undefined || client?.sendMail === undefined || connection === undefined)
      return { ok: false, detail: "The mailbox is not connected." };
    const body = redactSensitive(editedBody ?? draft.body).text;
    const context = draft.context;
    const attachments = [];
    for (const file of draft.attachments) {
      try {
        attachments.push({
          name: file.name,
          mimeType: file.mimeType,
          content: Uint8Array.from(NodeFS.readFileSync(file.path)),
        });
      } catch {
        // A file that is gone is left out; the text still names it.
      }
    }
    const references = [
      ...context.references,
      ...(context.messageId !== null && !context.references.includes(context.messageId)
        ? [context.messageId]
        : []),
    ];
    const text = `${body}\n\n${quoteOriginal({ from: context.from, at: context.at, text: context.text }, context.locale)}\n`;
    try {
      const result = await client.sendMail(
        {
          from: { name: context.displayName, address: context.mailbox },
          to: draft.to.map((address) => ({ name: "", address })),
          cc: draft.cc.map((address) => ({ name: "", address })),
          subject: draft.subject,
          text,
          inReplyTo: context.messageId,
          references,
          attachments,
        },
        context.providerThreadId,
      );
      this.audit({
        direction: "out",
        platform: "email",
        connectionId: connection.id,
        kind: "email-reply",
        workspaceId: approval.target.workspaceId,
        channelId: approval.target.channelId,
        userId: draft.to[0] ?? null,
        memberEmail: null,
        agentId: approval.agentId,
        threadId: approval.threadId,
        chars: body.length,
        attachments: attachments.length,
        outcome: "sent",
        text: body,
      });
      return { ok: true, detail: result || "sent" };
    } catch (error) {
      this.log(`chat: e-mail send failed: ${String(error)}`);
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** A scheduled report on an e-mail binding goes to the agent's manager (inside the company). */
  private async sendEmailReport(
    connection: ZenChatConnection,
    follow: FollowRecord,
    agent: ZenChatAgent,
    answer: string,
    failed: boolean,
  ): Promise<void> {
    const client = this.clients.get(connection.id);
    const report = this.deps.config().reports.find((candidate) => candidate.id === follow.reportId);
    let status = failed ? "failed" : "posted";
    if (!failed && answer.trim() !== "" && client?.sendMail !== undefined) {
      const files = await this.outboundFiles(connection, agent, answer);
      const body = redactSensitive(answer.replace(/!\[([^\]]*)\]\((\/[^)\s]+)\)/g, "[$1]")).text;
      try {
        await client.sendMail(
          {
            from: {
              name: connection.settings.displayName || agent.name,
              address: connection.settings.address ?? "",
            },
            to: [{ name: "", address: agent.managerEmail }],
            subject: `${report?.name ?? "Report"} (${this.now().toISOString().slice(0, 10)})`,
            text: body,
            attachments: files.map((file) => ({
              name: file.name,
              mimeType: file.mimeType,
              content: Uint8Array.from(NodeFS.readFileSync(file.path)),
            })),
            extraHeaders: { "Auto-Submitted": "auto-generated" },
          },
          null,
        );
        this.auditOut(
          connection,
          follow.target,
          {
            kind: "report",
            agentId: agent.id,
            threadId: follow.threadId,
            userId: agent.managerEmail,
          },
          body,
          "sent to manager",
          [],
        );
      } catch (error) {
        this.log(`chat: e-mail report failed: ${String(error)}`);
        status = "failed: send";
      }
    } else if (!failed) {
      status = "no answer";
    }
    if (follow.reportId !== null)
      this.deps.onReportRun?.(follow.reportId, status, this.now().toISOString());
  }

  /** Approvals of e-mail connections (drafts and tool requests), newest first, for the page. */
  emailApprovals(limit = 50): ZenChatEmailApprovalView[] {
    const config = this.deps.config();
    const mailboxes = new Set(
      config.connections.filter((item) => item.platform === "email").map((item) => item.id),
    );
    return Object.values(this.deps.state().approvals)
      .filter((approval) => mailboxes.has(approval.connectionId))
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((approval) => {
        const agent = config.agents.find((candidate) => candidate.id === approval.agentId);
        const draft = approval.email;
        return {
          id: approval.id,
          connectionId: approval.connectionId,
          agentId: approval.agentId,
          agentName: agent?.name ?? approval.agentId,
          managerEmail: agent?.managerEmail ?? "",
          threadId: approval.threadId,
          status: approval.status,
          kind: draft ? ("email-reply" as const) : ("tool" as const),
          to: draft?.to ?? [],
          cc: draft?.cc ?? [],
          subject: draft?.subject ?? approval.kind,
          body: draft?.body ?? redactSensitive(approval.prompt).text,
          attachments: (draft?.attachments ?? []).map((file) => ({
            name: file.name,
            sizeBytes: file.sizeBytes,
          })),
          original: draft
            ? {
                from: draft.context.from,
                subject: draft.context.subject,
                excerpt: redactSensitive(splitQuoted(draft.context.text).latest).text.slice(
                  0,
                  1500,
                ),
                at: draft.context.at,
              }
            : null,
          flags: draft?.flags ?? [],
          createdAt: approval.createdAt,
          decidedBy: approval.decidedBy,
          decidedAt: approval.decidedAt,
          sendResult: draft?.sendResult ?? null,
        };
      });
  }

  /**
   * A decision from the setup page (the manager signed in there). `by` must be the agent's
   * manager; the caller (ZenChat.ts) checks who is signed in.
   */
  async decideFromPage(input: {
    readonly approvalId: string;
    readonly decision: "accept" | "decline";
    readonly by: string;
    readonly body: string | null;
  }): Promise<{ readonly ok: boolean; readonly detail: string }> {
    const approval = this.deps.state().approvals[input.approvalId];
    if (approval === undefined || approval.status !== "pending")
      return { ok: false, detail: "This approval is no longer waiting." };
    const agent = this.deps.config().agents.find((candidate) => candidate.id === approval.agentId);
    if (agent === undefined) return { ok: false, detail: "This agent no longer exists." };
    if (agent.managerEmail.toLowerCase() !== input.by.toLowerCase())
      return { ok: false, detail: `Only ${agent.managerEmail} can approve this.` };
    return this.applyDecision(approval, agent, input.decision, input.by, input.body);
  }

  /** Carries out a manager's decision: answers the agent's request, or sends the drafted mail. */
  private async applyDecision(
    approval: ApprovalRecord,
    agent: ZenChatAgent,
    decision: "accept" | "decline",
    by: string,
    editedBody: string | null,
  ): Promise<{ readonly ok: boolean; readonly detail: string }> {
    const decidedAt = this.now().toISOString();
    let detail: string = decision === "accept" ? "approved" : "declined";
    if (approval.email !== undefined) {
      if (decision === "accept") {
        const sent = await this.sendEmailDraft(approval, editedBody);
        if (!sent.ok) {
          this.setApproval(approval.id, {
            email: { ...approval.email, sendResult: `failed: ${sent.detail}` },
          });
          return sent;
        }
        detail = `sent (${sent.detail})`;
      }
      this.setApproval(approval.id, {
        status: decision === "accept" ? "accepted" : "declined",
        decidedBy: by,
        decidedAt,
        email: {
          ...approval.email,
          ...(editedBody !== null && decision === "accept"
            ? { body: redactSensitive(editedBody).text }
            : {}),
          sendResult: decision === "accept" ? detail : null,
        },
      });
    } else {
      try {
        await this.deps.runtime.respond(approval.threadId, approval.requestId, decision);
      } catch (error) {
        this.log(`chat: approval answer failed: ${String(error)}`);
        this.setApproval(approval.id, { status: "expired", decidedAt });
        return { ok: false, detail: "The agent is no longer waiting for this." };
      }
      this.setApproval(approval.id, {
        status: decision === "accept" ? "accepted" : "declined",
        decidedBy: by,
        decidedAt,
      });
    }
    this.audit({
      direction: "system",
      platform: this.connection(approval.connectionId)?.platform ?? "email",
      connectionId: approval.connectionId,
      kind: "approval",
      workspaceId: approval.target.workspaceId,
      channelId: approval.target.channelId,
      userId: null,
      memberEmail: by,
      agentId: agent.id,
      threadId: approval.threadId,
      chars: 0,
      attachments: 0,
      outcome: detail,
    });
    // Cards on chat platforms show the outcome.
    for (const card of approval.cards) {
      const cardConnection = this.connection(card.connectionId ?? approval.connectionId);
      const client = this.clients.get(card.connectionId ?? approval.connectionId);
      if (cardConnection === undefined || client?.update === undefined) continue;
      const t = this.strings(cardConnection);
      const outcome = decision === "accept" ? t.approved(by) : t.declined(by);
      await client
        .update(card.target, card.messageId, {
          text: formatFor(
            cardConnection.platform,
            `${this.approvalCardMarkdown(t, agent, approval)}\n\n${outcome}`,
          ),
        })
        .catch(() => undefined);
    }
    return { ok: true, detail };
  }

  // Approvals

  private async handleAction(connection: ZenChatConnection, action: InboundAction): Promise<void> {
    const client = this.clients.get(connection.id);
    const t = this.strings(connection);
    const parsed = parseApprovalValue(action.value);
    const auditBase = {
      direction: "in" as const,
      platform: connection.platform,
      connectionId: connection.id,
      kind: "approval",
      workspaceId: action.workspaceId,
      channelId: action.channelId,
      userId: action.user.id,
      chars: 0,
      attachments: 0,
    };
    if (parsed === null || !connection.workspaceAllowlist.includes(action.workspaceId)) {
      this.audit({
        ...auditBase,
        memberEmail: null,
        agentId: null,
        threadId: null,
        outcome: "ignored",
      });
      await client?.answer?.(action, "").catch(() => undefined);
      return;
    }
    // 0.2.4: approvals are decided only in the app ("De aprobat") or the hub dashboard, never
    // from a messaging app; a button on an older card says where to go and decides nothing.
    const approval = this.deps.state().approvals[parsed.approvalId];
    this.audit({
      ...auditBase,
      memberEmail: null,
      agentId: approval?.agentId ?? null,
      threadId: approval?.threadId ?? null,
      outcome: "refused: approvals only in the app",
    });
    await client?.answer?.(action, t.approveInApp).catch(() => undefined);
  }

  private setApproval(id: string, change: Partial<ApprovalRecord>) {
    this.deps.setState((current) => {
      const record = current.approvals[id];
      return record === undefined
        ? current
        : { ...current, approvals: { ...current.approvals, [id]: { ...record, ...change } } };
    });
  }

  private approvalCardMarkdown(
    t: ReturnType<typeof chatStrings>,
    agent: ZenChatAgent,
    approval: ApprovalRecord,
  ): string {
    const prompt = redactSensitive(approval.prompt).text.slice(0, 1500);
    return [
      t.approvalTitle(agent.name),
      "```",
      prompt === "" ? approval.kind : prompt,
      "```",
      t.approvalAsked(approval.askedBy, approval.where),
    ].join("\n");
  }

  /** Sends the approve/decline card to the agent's manager (DM when possible, else the thread). */
  private async requestApproval(
    follow: FollowRecord,
    request: { requestId: string; kind: string; prompt: string },
  ): Promise<void> {
    const connection = this.connection(follow.connectionId);
    const config = this.deps.config();
    const agent = config.agents.find((candidate) => candidate.id === follow.agentId);
    const client = this.clients.get(follow.connectionId);
    if (connection === undefined || agent === undefined || client === undefined) return;
    const t = this.strings(connection);
    const id = NodeCrypto.randomBytes(8).toString("hex");
    if (connection.platform === "email") {
      // Never in the mail thread: the page lists it, and the manager gets chat cards if linked.
      const record: ApprovalRecord = {
        id,
        connectionId: connection.id,
        agentId: agent.id,
        threadId: follow.threadId,
        requestId: request.requestId,
        kind: request.kind,
        prompt: request.prompt,
        where: follow.where,
        askedBy: follow.askedBy,
        target: { ...follow.target, replyTo: null },
        cards: [],
        status: "pending",
        decidedBy: null,
        createdAt: this.now().toISOString(),
        decidedAt: null,
      };
      this.deps.setState((current) => ({
        ...current,
        approvals: { ...current.approvals, [id]: record },
      }));
      await this.sendManagerCards(record, agent);
      return;
    }
    const record: ApprovalRecord = {
      id,
      connectionId: connection.id,
      agentId: agent.id,
      threadId: follow.threadId,
      requestId: request.requestId,
      kind: request.kind,
      prompt: request.prompt,
      where: follow.where,
      askedBy: follow.askedBy,
      target: { ...follow.target, replyTo: null },
      cards: [],
      status: "pending",
      decidedBy: null,
      createdAt: this.now().toISOString(),
      decidedAt: null,
    };
    const manager = config.members.find(
      (member) => member.email.toLowerCase() === agent.managerEmail.toLowerCase(),
    );
    const managerName = manager?.name || agent.managerEmail;
    // A notice only: approvals happen in the app ("De aprobat"), never from a messaging app.
    const card = `${this.approvalCardMarkdown(t, agent, record)}\n${t.approveInApp}`;
    const cards: ApprovalRecord["cards"][number][] = [];
    const managerUserId = manager
      ? identityOf(manager, connection.platform, follow.target.workspaceId)
      : null;
    if (managerUserId !== null && client.directMessage !== undefined) {
      const text = formatFor(connection.platform, card);
      const sent = await client
        .directMessage(follow.target.workspaceId, managerUserId, { text })
        .catch(() => null);
      if (sent !== null) {
        cards.push({
          target: {
            workspaceId: follow.target.workspaceId,
            channelId: sent.channelId,
            threadId: null,
          },
          messageId: sent.messageId,
        });
        this.auditOut(
          connection,
          { workspaceId: follow.target.workspaceId, channelId: sent.channelId, threadId: null },
          {
            kind: "approval-request",
            agentId: agent.id,
            threadId: follow.threadId,
            userId: managerUserId,
          },
          card,
          "sent to manager",
          [],
        );
      }
    }
    if (cards.length > 0) {
      await this.postMarkdown(connection.id, follow.target, t.approvalWaiting(managerName), {
        kind: "approval-waiting",
        agentId: agent.id,
        threadId: follow.threadId,
      });
    } else {
      // No DM possible: the notice goes in the thread, without buttons.
      const ids = await this.postMarkdown(
        connection.id,
        follow.target,
        `${card}\n${t.approvalOnlyManager(managerName)}`,
        { kind: "approval-request", agentId: agent.id, threadId: follow.threadId },
      );
      const last = ids.at(-1);
      if (last !== undefined)
        cards.push({ target: { ...follow.target, replyTo: null }, messageId: last });
    }
    this.deps.setState((current) => ({
      ...current,
      approvals: { ...current.approvals, [id]: { ...record, cards } },
    }));
  }

  // Following runs

  /** One pass: typing indicators, new answers, approval cards, finished runs; then reports. */
  async tick(): Promise<void> {
    for (const follow of Object.values(this.deps.state().follows)) {
      if (this.busy.has(follow.threadId)) continue;
      this.busy.add(follow.threadId);
      try {
        await this.followOnce(follow);
      } catch (error) {
        this.log(`chat: follow failed: ${String(error)}`);
      } finally {
        this.busy.delete(follow.threadId);
      }
    }
    await this.runDueReports();
  }

  private async followOnce(follow: FollowRecord): Promise<void> {
    const connection = this.connection(follow.connectionId);
    const client = this.clients.get(follow.connectionId);
    if (connection === undefined || client === undefined) return;
    const observation = await this.deps.runtime.observe(follow.threadId, follow.afterMessageId);
    if (!observation.exists) {
      this.dropFollow(follow.threadId);
      return;
    }
    const t = this.strings(connection);
    for (const request of observation.approvals) {
      if (follow.approvalRequestIds.includes(request.requestId)) continue;
      this.updateFollow(follow.threadId, {
        approvalRequestIds: [...follow.approvalRequestIds, request.requestId],
      });
      await this.requestApproval(follow, request);
    }
    if (connection.platform === "email") {
      if (!observation.running) await this.followEmail(connection, follow, observation);
      return;
    }
    // Answers: post each finished message once; the last one waits until the run ends so a
    // message the agent is still extending is not posted twice.
    const fresh = observation.replies.filter(
      (reply) => !follow.postedMessageIds.includes(reply.id),
    );
    const ready =
      observation.running && observation.approvals.length === 0 ? fresh.slice(0, -1) : fresh;
    const posted = [...follow.postedMessageIds];
    let placeholderId = follow.placeholderId;
    for (const reply of ready) {
      posted.push(reply.id);
      this.updateFollow(follow.threadId, { postedMessageIds: [...posted] });
      await this.postAnswer(connection, follow, reply.text, placeholderId);
      placeholderId = null;
      this.updateFollow(follow.threadId, { placeholderId: null });
    }
    if (observation.running) {
      if (
        ZEN_CHAT_PLATFORM_INFO[connection.platform].features.typing === "native" &&
        observation.approvals.length === 0
      ) {
        const last = this.lastTyping.get(follow.threadId) ?? 0;
        if (this.now().getTime() - last >= TYPING_EVERY_MS) {
          this.lastTyping.set(follow.threadId, this.now().getTime());
          await client.typing?.(follow.target).catch(() => undefined);
        }
      }
      return;
    }
    if (
      posted.length === follow.postedMessageIds.length &&
      ready.length === 0 &&
      observation.failed
    ) {
      await this.postAnswer(connection, follow, t.runFailed, placeholderId);
    } else if (placeholderId !== null) {
      await client
        .update?.(follow.target, placeholderId, { text: formatFor(connection.platform, "_Done._") })
        .catch(() => undefined);
    }
    if (follow.reportId !== null) {
      this.deps.onReportRun?.(
        follow.reportId,
        observation.failed ? "failed" : "posted",
        this.now().toISOString(),
      );
    }
    this.lastTyping.delete(follow.threadId);
    this.dropFollow(follow.threadId);
  }

  private async postAnswer(
    connection: ZenChatConnection,
    follow: FollowRecord,
    markdown: string,
    placeholderId: string | null,
  ): Promise<void> {
    const client = this.clients.get(connection.id)!;
    const agent = this.deps.config().agents.find((candidate) => candidate.id === follow.agentId);
    const files = agent ? await this.outboundFiles(connection, agent, markdown) : [];
    const redacted = redactSensitive(markdown);
    const formatted = formatFor(connection.platform, redacted.text);
    const pieces = chunkText(
      formatted,
      ZEN_CHAT_PLATFORM_INFO[connection.platform].limits.textChars,
      connection.platform,
    );
    let ids: string[] = [];
    if (placeholderId !== null && client.update !== undefined && pieces[0] !== undefined) {
      try {
        await client.update(follow.target, placeholderId, { text: pieces[0] });
        ids.push(placeholderId);
        for (const piece of pieces.slice(1)) {
          ids.push(
            (
              await client.post(follow.target, {
                text: piece,
                ...(follow.proactive ? { proactive: true } : {}),
              })
            ).messageId,
          );
        }
        this.auditOut(
          connection,
          follow.target,
          { kind: "answer", agentId: follow.agentId, threadId: follow.threadId },
          redacted.text,
          `posted ${pieces.length}`,
          redacted.kinds,
        );
      } catch {
        ids = await this.postMarkdown(connection.id, follow.target, markdown, {
          kind: "answer",
          agentId: follow.agentId,
          threadId: follow.threadId,
          proactive: follow.proactive,
        });
      }
    } else {
      ids = await this.postMarkdown(connection.id, follow.target, markdown, {
        kind: "answer",
        agentId: follow.agentId,
        threadId: follow.threadId,
        proactive: follow.proactive,
      });
    }
    for (const file of files) {
      try {
        await client.upload?.(follow.target, file);
        this.audit({
          direction: "out",
          platform: connection.platform,
          connectionId: connection.id,
          kind: "file",
          workspaceId: follow.target.workspaceId,
          channelId: follow.target.channelId,
          userId: null,
          memberEmail: null,
          agentId: follow.agentId,
          threadId: follow.threadId,
          chars: 0,
          attachments: 1,
          outcome: `uploaded ${file.mimeType} ${file.sizeBytes} bytes`,
        });
      } catch (error) {
        this.log(`chat: upload failed: ${String(error)}`);
      }
    }
    // A report's first message becomes a conversation: replies in its thread continue the same chat.
    if (follow.reportId !== null && follow.conversationKey === null && ids[0] !== undefined) {
      const threaded = ZEN_CHAT_PLATFORM_INFO[connection.platform].features.threads;
      const root = threaded && connection.platform !== "whatsapp" ? ids[0] : null;
      const key = conversationKey({
        connectionId: connection.id,
        workspaceId: follow.target.workspaceId,
        channelId: follow.target.channelId,
        threadRoot: root,
        agentId: follow.agentId,
      });
      const nowIso = this.now().toISOString();
      const target = { ...follow.target, threadId: root, replyTo: null };
      this.deps.setState((current) => ({
        ...current,
        conversations: {
          ...current.conversations,
          [key]: {
            key,
            connectionId: connection.id,
            agentId: follow.agentId,
            threadId: follow.threadId,
            target,
            where: follow.where,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        },
      }));
      this.updateFollow(follow.threadId, { conversationKey: key, target, proactive: false });
    }
  }

  /** Files the answer embeds, only from the agent's own folder or the chat inbox, within limits. */
  private async outboundFiles(
    connection: ZenChatConnection,
    agent: ZenChatAgent,
    markdown: string,
  ): Promise<
    Array<{ path: string; name: string; mimeType: string; sizeBytes: number; title: string }>
  > {
    const referenced = referencedFiles(markdown);
    if (referenced.length === 0 || this.clients.get(connection.id)?.upload === undefined) return [];
    const root = await this.deps.runtime.projectRoot(agent.projectId);
    const roots = [root, this.deps.inboxDir]
      .filter((value): value is string => value !== null)
      .map((value) => {
        try {
          return NodeFS.realpathSync(value);
        } catch {
          return NodePath.resolve(value);
        }
      });
    const info = ZEN_CHAT_PLATFORM_INFO[connection.platform];
    const limit =
      Math.min(this.deps.config().settings.maxAttachmentMb, info.limits.uploadMb) * 1024 * 1024;
    const files = [];
    for (const file of referenced.slice(0, 10)) {
      try {
        const real = NodeFS.realpathSync(file.path);
        const inside = roots.some(
          (allowed) => real === allowed || real.startsWith(`${allowed}${NodePath.sep}`),
        );
        const stat = NodeFS.statSync(real);
        if (!inside || !stat.isFile() || stat.size > limit || stat.size === 0) continue;
        const name = NodePath.basename(real);
        files.push({
          path: real,
          name,
          mimeType: mimeFromName(name),
          sizeBytes: stat.size,
          title: file.title || name,
        });
      } catch {
        // Missing file: the text still says what it was.
      }
    }
    return files;
  }

  /**
   * An AI staff agent @mentioned in one of our conversations reports back there (status, then
   * the result): one platform message per task, edited where the platform can, the files of the
   * finished task uploaded. Conversations of other threads are left alone.
   */
  async relayMention(post: {
    readonly originThreadId: string;
    readonly key: string;
    readonly agentName: string;
    readonly platformMarkdown: string;
    readonly files: ReadonlyArray<string>;
    readonly final: boolean;
  }): Promise<void> {
    const conversations = Object.values(this.deps.state().conversations).filter(
      (record) => record.threadId === post.originThreadId,
    );
    for (const record of conversations) {
      const connection = this.connection(record.connectionId);
      const client = this.clients.get(record.connectionId);
      if (connection === undefined || client === undefined || !connection.enabled) continue;
      if (connection.platform === "email") continue;
      const mapKey = `${post.key}:${record.key}`;
      const previous = this.mentionMessages.get(mapKey);
      const redacted = redactSensitive(post.platformMarkdown);
      const pieces = chunkText(
        formatFor(connection.platform, redacted.text),
        ZEN_CHAT_PLATFORM_INFO[connection.platform].limits.textChars,
        connection.platform,
      );
      const options = { kind: "mention", agentId: record.agentId, threadId: record.threadId };
      let updated = false;
      if (previous !== undefined && client.update !== undefined && pieces.length === 1) {
        try {
          await client.update(record.target, previous.messageId, { text: pieces[0]! });
          this.auditOut(
            connection,
            record.target,
            options,
            redacted.text,
            "updated",
            redacted.kinds,
          );
          updated = true;
        } catch (error) {
          this.log(`chat: mention update failed on ${connection.platform}: ${String(error)}`);
        }
      }
      if (!updated) {
        // Platforms without edits get only the result, not every status change.
        if (previous !== undefined && client.update === undefined && !post.final) continue;
        const ids = await this.postMarkdown(
          record.connectionId,
          record.target,
          post.platformMarkdown,
          options,
        );
        if (ids[0] !== undefined) {
          this.mentionMessages.set(mapKey, {
            connectionId: record.connectionId,
            messageId: ids[0],
          });
        }
      }
      if (!post.final || post.files.length === 0 || client.upload === undefined) continue;
      const agent = this.deps.config().agents.find((candidate) => candidate.id === record.agentId);
      if (agent === undefined) continue;
      const links = post.files.map((file) => `[${NodePath.basename(file)}](${file})`).join(" ");
      for (const file of await this.outboundFiles(connection, agent, links)) {
        try {
          await client.upload(record.target, file);
          this.audit({
            direction: "out",
            platform: connection.platform,
            connectionId: connection.id,
            kind: "file",
            workspaceId: record.target.workspaceId,
            channelId: record.target.channelId,
            userId: null,
            memberEmail: null,
            agentId: record.agentId,
            threadId: record.threadId,
            chars: 0,
            attachments: 1,
            outcome: `uploaded ${file.mimeType} ${file.sizeBytes} bytes`,
          });
        } catch (error) {
          this.log(`chat: mention upload failed: ${String(error)}`);
        }
      }
    }
    if (post.final) {
      for (const key of this.mentionMessages.keys()) {
        if (key.startsWith(`${post.key}:`)) this.mentionMessages.delete(key);
      }
    }
  }

  private updateFollow(threadId: string, change: Partial<FollowRecord>) {
    this.deps.setState((current) => {
      const record = current.follows[threadId];
      return record === undefined
        ? current
        : { ...current, follows: { ...current.follows, [threadId]: { ...record, ...change } } };
    });
  }

  private dropFollow(threadId: string) {
    this.deps.setState((current) => {
      const { [threadId]: _dropped, ...follows } = current.follows;
      return { ...current, follows };
    });
  }

  // Reports

  private async runDueReports(): Promise<void> {
    const config = this.deps.config();
    const now = this.now();
    for (const report of config.reports) {
      if (!reportDue(report, config.settings, now)) continue;
      await this.runReport(report.id);
    }
  }

  /** Starts a report run now; the answer is posted to the bound channel when it is done. */
  async runReport(reportId: string): Promise<string> {
    const config = this.deps.config();
    const report = config.reports.find((candidate) => candidate.id === reportId);
    const at = this.now().toISOString();
    if (report === undefined) return "missing";
    const binding = config.bindings.find((candidate) => candidate.id === report.bindingId);
    const agent = config.agents.find((candidate) => candidate.id === report.agentId);
    const connection = binding ? this.connection(binding.connectionId) : undefined;
    const fail = (status: string) => {
      this.deps.onReportRun?.(report.id, status, at);
      return status;
    };
    if (binding === undefined || agent === undefined || connection === undefined)
      return fail("not configured");
    if (!mayPost(binding, agent.id)) return fail("agent may not post in this channel");
    if (agent.kind !== "company" || !this.deps.context().isRunner)
      return fail("reports need a company agent on the runner");
    if (!this.clients.has(connection.id)) return fail("connection offline");
    if (connection.platform === "email" && agent.managerEmail === "")
      return fail("the agent has no manager to mail the report to");
    this.deps.onReportRun?.(report.id, "running", at);
    const where = `${ZEN_CHAT_PLATFORM_INFO[connection.platform].name} ${binding.channelName || binding.channelId}`;
    const text = [
      `[You are ${agent.name}. This is the scheduled report "${report.name}" for ${where}. ` +
        "Your final answer is posted there as the report: write only the report, short and clear. " +
        "To attach a file, embed it as `![title](/absolute/path)`.]",
      agent.instructions.trim(),
      "",
      report.prompt,
    ]
      .filter((line, index) => index !== 1 || line !== "")
      .join("\n");
    try {
      const started = await this.deps.runtime.start({
        agent,
        title: `Report: ${report.name}`,
        text,
      });
      const target: ConversationTarget = {
        workspaceId: connection.workspaceAllowlist[0] ?? "",
        channelId: binding.channelId,
        threadId: null,
        replyTo: null,
      };
      this.deps.setState((current) => ({
        ...current,
        follows: {
          ...current.follows,
          [started.threadId]: {
            threadId: started.threadId,
            connectionId: connection.id,
            agentId: agent.id,
            conversationKey: null,
            target,
            where,
            askedBy: `report "${report.name}"`,
            afterMessageId: started.messageId,
            postedMessageIds: [],
            approvalRequestIds: [],
            placeholderId: null,
            proactive: true,
            reportId: report.id,
            startedAt: at,
          },
        },
      }));
      return "running";
    } catch (error) {
      this.log(`chat: report failed to start: ${String(error)}`);
      return fail("failed to start");
    }
  }

  pendingApprovals(): number {
    return Object.values(this.deps.state().approvals).filter(
      (approval) => approval.status === "pending",
    ).length;
  }
}

const platformName = (platform: ZenChatPlatform) => ZEN_CHAT_PLATFORM_INFO[platform].name;
