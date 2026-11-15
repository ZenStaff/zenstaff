// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Small synchronous files, owner-only, written outside the Effect runtime.
// Zen Staff chat integrations: what the runner keeps on disk.
// - `chat.json`: the configuration the setup page edits (no secrets: those are in the vault).
// - `runtime.json`: platform conversation -> Zen thread, the approvals waiting for a manager, and
//   the answers still being followed, so a restart loses nothing.
// - `audit.log`: one JSON line per inbound/outbound message (metadata only unless enabled).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZEN_CHAT_DEFAULT_SETTINGS,
  type ZenChatAuditEntry,
  type ZenChatSettings,
  type ZenEmailFlag,
} from "@t3tools/contracts/zenChat";

import type { ConversationTarget } from "./model.ts";
import type { ChatConfig } from "./policy.ts";

function writePrivate(file: string, text: string) {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, text, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
  NodeFS.chmodSync(file, 0o600);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const EMPTY_CONFIG: ChatConfig = {
  connections: [],
  agents: [],
  bindings: [],
  members: [],
  reports: [],
  settings: ZEN_CHAT_DEFAULT_SETTINGS,
};

export function loadConfig(file: string): ChatConfig {
  const raw = readJson(file) as Partial<Record<keyof ChatConfig, unknown>> | null;
  if (raw === null || typeof raw !== "object") return EMPTY_CONFIG;
  const settings = (raw.settings ?? {}) as Partial<ZenChatSettings>;
  return {
    connections: array(raw.connections),
    agents: array(raw.agents),
    bindings: array(raw.bindings),
    members: array(raw.members),
    reports: array(raw.reports),
    settings: {
      ...ZEN_CHAT_DEFAULT_SETTINGS,
      ...settings,
      quietHours: { ...ZEN_CHAT_DEFAULT_SETTINGS.quietHours, ...settings.quietHours },
    },
  };
}

export function saveConfig(file: string, config: ChatConfig): void {
  writePrivate(file, JSON.stringify(config, null, 2));
}

// Runtime state

export interface ConversationRecord {
  readonly key: string;
  readonly connectionId: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly target: ConversationTarget;
  readonly where: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An answer being followed: the run started by a chat message, until it ends. */
export interface FollowRecord {
  readonly threadId: string;
  readonly connectionId: string;
  readonly agentId: string;
  readonly conversationKey: string | null;
  readonly target: ConversationTarget;
  readonly where: string;
  readonly askedBy: string;
  /** Replies after this message belong to this run. */
  readonly afterMessageId: string;
  readonly postedMessageIds: ReadonlyArray<string>;
  readonly approvalRequestIds: ReadonlyArray<string>;
  readonly placeholderId: string | null;
  readonly proactive: boolean;
  /** Report runs: remember the conversation once the first answer is posted. */
  readonly reportId: string | null;
  readonly startedAt: string;
  /** E-mail runs: what the draft answers (the answer becomes a draft, never a post). */
  readonly email?: EmailContext;
}

/** The mail an e-mail run answers. */
export interface EmailContext {
  readonly mailbox: string;
  readonly displayName: string;
  readonly replyTo: string;
  readonly cc: ReadonlyArray<string>;
  readonly subject: string;
  readonly messageId: string | null;
  readonly references: ReadonlyArray<string>;
  readonly providerThreadId: string | null;
  readonly from: string;
  readonly at: string | null;
  /** The mail's readable text (capped), quoted under the reply. */
  readonly text: string;
  readonly flags: ReadonlyArray<ZenEmailFlag>;
  readonly locale: "en" | "ro";
}

/** A drafted reply (or a report) waiting for the manager. */
export interface EmailDraft {
  readonly context: EmailContext;
  readonly to: ReadonlyArray<string>;
  readonly cc: ReadonlyArray<string>;
  readonly subject: string;
  readonly body: string;
  readonly attachments: ReadonlyArray<{
    readonly path: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }>;
  /** Flags from the checks plus the agent's own "FLAG:" lines. */
  readonly flags: ReadonlyArray<ZenEmailFlag>;
  readonly sendResult: string | null;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly connectionId: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly kind: string;
  readonly prompt: string;
  readonly where: string;
  readonly askedBy: string;
  readonly target: ConversationTarget;
  /** Every message that carries the buttons (manager DM and/or thread), updated on decision. */
  readonly cards: ReadonlyArray<{
    readonly target: ConversationTarget;
    readonly messageId: string;
    /** Set when the card is on another connection than the approval's (e-mail approvals). */
    readonly connectionId?: string;
  }>;
  readonly status: "pending" | "accepted" | "declined" | "expired";
  readonly decidedBy: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  /** E-mail: the draft to send once approved (requestId is then the approval's own id). */
  readonly email?: EmailDraft;
}

export interface RuntimeState {
  readonly conversations: Readonly<Record<string, ConversationRecord>>;
  readonly follows: Readonly<Record<string, FollowRecord>>;
  readonly approvals: Readonly<Record<string, ApprovalRecord>>;
}

export const EMPTY_RUNTIME: RuntimeState = { conversations: {}, follows: {}, approvals: {} };

export function loadRuntime(file: string): RuntimeState {
  const raw = readJson(file) as Partial<RuntimeState> | null;
  if (raw === null || typeof raw !== "object") return EMPTY_RUNTIME;
  return {
    conversations: raw.conversations ?? {},
    follows: raw.follows ?? {},
    approvals: raw.approvals ?? {},
  };
}

/** Drops decided approvals after 30 days and conversations idle for 90 days. */
export function pruneRuntime(state: RuntimeState, now: Date): RuntimeState {
  const cutoff = (days: number) => now.getTime() - days * 24 * 60 * 60 * 1000;
  return {
    conversations: Object.fromEntries(
      Object.entries(state.conversations).filter(
        ([, record]) => Date.parse(record.updatedAt) >= cutoff(90),
      ),
    ),
    follows: state.follows,
    approvals: Object.fromEntries(
      Object.entries(state.approvals).filter(
        ([, record]) => record.status === "pending" || Date.parse(record.createdAt) >= cutoff(30),
      ),
    ),
  };
}

export function saveRuntime(file: string, state: RuntimeState): void {
  writePrivate(file, JSON.stringify(state));
}

// Audit log

const AUDIT_MAX_BYTES = 5 * 1024 * 1024;

export class AuditLog {
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  /** Appends one entry. Text is kept only when `logContent` is on, and always redacted first. */
  write(entry: ZenChatAuditEntry): void {
    try {
      NodeFS.mkdirSync(NodePath.dirname(this.file), { recursive: true, mode: 0o700 });
      try {
        if (NodeFS.statSync(this.file).size > AUDIT_MAX_BYTES) {
          NodeFS.renameSync(this.file, `${this.file}.1`);
        }
      } catch {
        // No log yet.
      }
      NodeFS.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // Logging must never break a conversation.
    }
  }

  /** The latest entries, newest first. */
  read(limit: number): ReadonlyArray<ZenChatAuditEntry> {
    try {
      const lines = NodeFS.readFileSync(this.file, "utf8").trim().split("\n");
      return lines
        .slice(-limit)
        .reverse()
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as ZenChatAuditEntry];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }
}
