// Zen Staff chat integrations: the platform-neutral shapes every adapter translates to and from.
// An adapter turns a platform payload into `InboundEvent`s and implements `PlatformClient` for the
// way back; the engine (engine.ts) never sees a platform payload.
import type { ZenChatPlatform } from "@t3tools/contracts/zenChat";

import type { OutgoingMail, ParsedMail } from "./email/mime.ts";

export interface ChatUser {
  readonly id: string;
  readonly name: string;
  /** Only when the platform vouches for it (Slack users:read.email, Google Chat, Teams UPN). */
  readonly email?: string | null;
  readonly isBot?: boolean;
}

export type AttachmentKind = "image" | "audio" | "video" | "file";

export interface InboundAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly kind: AttachmentKind;
  /** Whatever the adapter needs to download it (URL, file id, media id). Never shown. */
  readonly ref: string;
}

export type ChannelType = "dm" | "channel" | "group";

export interface InboundMessage {
  readonly type: "message";
  readonly platform: ZenChatPlatform;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly channelType: ChannelType;
  /** Root of the platform thread this message belongs to; null = top level. */
  readonly threadId: string | null;
  readonly messageId: string;
  readonly user: ChatUser;
  /** Plain text: the bot mention removed, platform markup decoded. */
  readonly text: string;
  /** The bot was mentioned, replied to, or this is a DM. */
  readonly mentioned: boolean;
  readonly attachments: ReadonlyArray<InboundAttachment>;
  /** `/zen <args>` (slash command or typed). */
  readonly command: { readonly args: string } | null;
  /** Slash commands: where to answer privately (Slack response_url, Discord token). */
  readonly responseRef?: string;
  /** E-mail only: the parsed mail and where the mailbox found it. */
  readonly email?: InboundEmailMeta;
}

export interface InboundEmailMeta {
  readonly mail: ParsedMail;
  /** Labels / folders the mail is in (Gmail labels, Graph folders and categories, IMAP folder). */
  readonly labels: ReadonlyArray<string>;
  readonly providerMessageId: string;
  /** Gmail thread id / Graph conversation id (null for IMAP). */
  readonly providerThreadId: string | null;
}

export interface InboundAction {
  readonly type: "action";
  readonly platform: ZenChatPlatform;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly threadId: string | null;
  /** The message that carried the button. */
  readonly messageId: string;
  readonly user: ChatUser;
  readonly value: string;
  /** Telegram callback id, Discord interaction token, Slack response_url, Teams invoke id. */
  readonly responseRef?: string;
}

export type InboundEvent = InboundMessage | InboundAction;

export interface ConversationTarget {
  readonly workspaceId: string;
  readonly channelId: string;
  /** Thread root to answer in (null = post at top level). */
  readonly threadId: string | null;
  /** Message to reply to on platforms that reply per message (Telegram, Discord, WhatsApp). */
  readonly replyTo?: string | null;
}

export interface OutboundButton {
  readonly label: string;
  readonly value: string;
  readonly style: "primary" | "danger" | "default";
}

export interface OutboundMessage {
  /** Already formatted for the platform (formatting.ts) and within its length limit. */
  readonly text: string;
  readonly buttons?: ReadonlyArray<OutboundButton>;
  /** The agent posts on its own (reports): WhatsApp then needs an approved template. */
  readonly proactive?: boolean;
}

export interface OutboundFile {
  readonly path: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly title: string;
}

/** The way back to one platform connection. Optional methods are features some lack. */
export interface PlatformClient {
  readonly platform: ZenChatPlatform;
  post(target: ConversationTarget, message: OutboundMessage): Promise<{ messageId: string }>;
  update?(target: ConversationTarget, messageId: string, message: OutboundMessage): Promise<void>;
  typing?(target: ConversationTarget): Promise<void>;
  upload?(target: ConversationTarget, file: OutboundFile): Promise<void>;
  /** Opens (or reuses) a direct conversation with a person; null when the platform cannot. */
  directMessage?(
    workspaceId: string,
    userId: string,
    message: OutboundMessage,
  ): Promise<{ channelId: string; messageId: string } | null>;
  download?(attachment: InboundAttachment): Promise<Uint8Array>;
  /** Acknowledges a button press or answers a slash command privately. */
  answer?(event: InboundEvent, text: string): Promise<void>;
  /** Looks a user up (Slack: name and e-mail for member mapping). */
  lookupUser?(workspaceId: string, userId: string): Promise<ChatUser | null>;
  /** E-mail only: sends one built message (after the manager approved it). */
  sendMail?(mail: OutgoingMail, providerThreadId: string | null): Promise<string>;
}

/** HTTP request as the hub relays it (raw body kept for signature checks). */
export interface RelayedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface RelayedResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}
