// Zen Staff AI staff: what an @mentioned agent posts back in the chat it was asked in. One message
// per task, updated in place: "lucrează…" while it works, what it waits for (an approval), then
// the result (summary, the 3 lines for the boss, files) and a link to the full work. Pure: the
// engine decides when, ZenStaff.ts writes it into the chat, chat integrations relay it.
import type { StaffLocale, StaffOutboundKind } from "@t3tools/contracts/zenStaff";

export type MentionPhase =
  | { readonly kind: "working"; readonly minutes: number }
  | {
      readonly kind: "waiting-approval";
      readonly action: StaffOutboundKind;
      readonly target: string;
      readonly manager: string | null;
    }
  | { readonly kind: "waiting-request"; readonly prompt: string }
  | {
      readonly kind: "done";
      readonly summary: string;
      readonly explainToBoss: ReadonlyArray<string>;
      readonly fileNames: ReadonlyArray<string>;
    }
  | { readonly kind: "failed" };

/** What goes back: the message text for the app and for chat platforms, and the files. */
export interface MentionPost {
  /** The chat the mention was written in. */
  readonly originThreadId: string;
  /** The agent's own thread ("Deschide lucrul complet"). */
  readonly agentThreadId: string;
  readonly agentThreadTitle: string;
  /** Stable per task: the message is updated, not repeated. */
  readonly key: string;
  readonly agentName: string;
  readonly companyId: string;
  /** Markdown for the app's chat (thread link). */
  readonly markdown: string;
  /** Markdown for Slack, Teams, Telegram...: the app's links do not open there. */
  readonly platformMarkdown: string;
  /** Absolute paths inside the agent's folder, only once the task is done. */
  readonly files: ReadonlyArray<string>;
  readonly final: boolean;
}

const ACTION: Record<StaffLocale, Record<StaffOutboundKind, string>> = {
  en: {
    send: "send",
    publish: "publish",
    pay: "pay",
    delete: "delete",
    other: "an outbound action",
  },
  ro: {
    send: "trimitere",
    publish: "publicare",
    pay: "plată",
    delete: "ștergere",
    other: "o acțiune în afara firmei",
  },
};

export const MENTION_TEXT = {
  en: {
    working: (name: string, minutes: number) =>
      minutes < 1 ? `**${name}** is working…` : `**${name}** is working… (${minutes} min)`,
    waitingApproval: (name: string, action: string, target: string, manager: string | null) =>
      `**${name}** is waiting for ${manager ?? "the manager"} to approve: ${action}${target ? ` to ${target}` : ""}. Approve or reject it in AI staff > Approvals.`,
    waitingRequest: (name: string, prompt: string) =>
      `**${name}** is waiting for an approval in the task's chat: ${prompt}`,
    failed: (name: string) => `**${name}** did not finish this task.`,
    doneEmpty: (name: string) => `**${name}** finished.`,
    files: "Files:",
    openWork: "Open the full work",
    openWorkPlatform: (title: string) => `Open the full work: the chat "${title}" in Zen Staff.`,
    onRunner: (title: string) =>
      `The full work is on the company server: the chat "${title}" (share it to follow it here).`,
  },
  ro: {
    working: (name: string, minutes: number) =>
      minutes < 1 ? `**${name}** lucrează…` : `**${name}** lucrează… (${minutes} min)`,
    waitingApproval: (name: string, action: string, target: string, manager: string | null) =>
      `**${name}** așteaptă aprobarea${manager ? ` lui ${manager}` : " managerului"}: ${action}${target ? ` către ${target}` : ""}. Aprobi sau respingi în Angajați AI > Aprobări.`,
    waitingRequest: (name: string, prompt: string) =>
      `**${name}** așteaptă o aprobare în chatul sarcinii: ${prompt}`,
    failed: (name: string) => `**${name}** nu a terminat sarcina.`,
    doneEmpty: (name: string) => `**${name}** a terminat.`,
    files: "Fișiere:",
    openWork: "Deschide lucrul complet",
    openWorkPlatform: (title: string) => `Deschide lucrul complet: chatul „${title}” în Zen Staff.`,
    onRunner: (title: string) =>
      `Lucrul complet e pe serverul firmei: chatul „${title}” (partajează-l ca să-l urmărești aici).`,
  },
} as const;

/** The in-app link to a thread (the message's own environment stands in). */
export const threadLinkHref = (threadId: string) =>
  `t3-thread://v1/${encodeURIComponent(threadId)}`;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The body (without the link line) for one phase. */
function mentionBody(input: {
  readonly locale: StaffLocale;
  readonly agentName: string;
  readonly role: string;
  readonly phase: MentionPhase;
}): string {
  const t = MENTION_TEXT[input.locale];
  const name = input.agentName;
  const phase = input.phase;
  switch (phase.kind) {
    case "working":
      return t.working(name, phase.minutes);
    case "waiting-approval":
      return t.waitingApproval(
        name,
        ACTION[input.locale][phase.action],
        oneLine(phase.target, 120),
        phase.manager,
      );
    case "waiting-request":
      return t.waitingRequest(name, oneLine(phase.prompt, 300));
    case "failed":
      return t.failed(name);
    case "done": {
      const summary = phase.summary.trim();
      const lines = phase.explainToBoss.map((line) => line.trim()).filter((line) => line !== "");
      if (summary === "" && lines.length === 0) return t.doneEmpty(name);
      const head = `**${name}**${input.role ? ` (${input.role})` : ""}: ${summary === "" ? lines[0]! : summary}`;
      const rest = summary === "" ? lines.slice(1) : lines;
      return [
        head,
        ...(rest.length > 0 ? ["", ...rest.slice(0, 3).map((line) => `- ${line}`)] : []),
        ...(phase.fileNames.length > 0 ? ["", `${t.files} ${phase.fileNames.join(", ")}`] : []),
      ].join("\n");
    }
  }
}

/** The two texts of a post: the app gets a thread link, platforms the chat's title. */
export function mentionTexts(input: {
  readonly locale: StaffLocale;
  readonly agentName: string;
  readonly role: string;
  readonly phase: MentionPhase;
  readonly agentThreadId: string;
  readonly agentThreadTitle: string;
  /** The agent ran on the company runner (hub agent): its thread does not open on this machine. */
  readonly onRunner?: boolean;
}): { readonly markdown: string; readonly platformMarkdown: string } {
  const t = MENTION_TEXT[input.locale];
  const body = mentionBody(input);
  if (input.onRunner === true) {
    const where = t.onRunner(input.agentThreadTitle);
    return { markdown: `${body}\n\n${where}`, platformMarkdown: `${body}\n\n${where}` };
  }
  return {
    markdown: `${body}\n\n[${t.openWork}](${threadLinkHref(input.agentThreadId)})`,
    // The platforms upload the files themselves (relayMention); the body names them.
    platformMarkdown: `${body}\n\n${t.openWorkPlatform(input.agentThreadTitle)}`,
  };
}

// Chat integrations (Slack, Teams, ...) register here to relay the posts of a mention made in one
// of their conversations back into that conversation.
type MentionRelay = (post: MentionPost) => Promise<void>;
const relays = new Map<string, MentionRelay>();

export function setZenMentionRelay(name: string, relay: MentionRelay | null): void {
  if (relay === null) relays.delete(name);
  else relays.set(name, relay);
}

export async function relayMention(post: MentionPost): Promise<void> {
  await Promise.all([...relays.values()].map((relay) => relay(post).catch(() => undefined)));
}
