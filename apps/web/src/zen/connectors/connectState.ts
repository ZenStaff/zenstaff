// Zen Staff connectors: pure helpers for the connect card and the dock (tested without React).
import {
  detectConnectIntent,
  detectMcpUrlIntent,
  type ZenConnectIntent,
  type ZenConnectorEntry,
  type ZenConnectRequestView,
  type ZenConnectorPathKind,
  type ZenText,
  type ZenSteps,
} from "@t3tools/contracts/zenConnectors";

import type { ZenLocale } from "../i18n/zenI18n";

export interface AgentAppView {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  readonly connections: ReadonlyArray<{ readonly name: string; readonly health: string }>;
  readonly bestPath: ZenConnectorPathKind | null;
  readonly paths: ReadonlyArray<{
    readonly kind: ZenConnectorPathKind;
    readonly available: boolean;
    readonly blocked: string | null;
  }>;
  readonly tier: "standard" | "enterprise";
  readonly lock: string | null;
}

export interface CardData {
  readonly request: ZenConnectRequestView;
  readonly apps: ReadonlyArray<AgentAppView>;
}

export const pick = (locale: ZenLocale, text: ZenText): string => text[locale] ?? text.en;
export const pickSteps = (locale: ZenLocale, steps: ZenSteps): ReadonlyArray<string> =>
  steps[locale] ?? steps.en;

/**
 * The connect request in the person's latest message, once per message: null when the message
 * was already looked at, is still streaming, or asks for nothing.
 */
export function intentForMessage(
  message: { readonly id: string; readonly text: string; readonly streaming?: boolean } | null,
  seen: ReadonlySet<string>,
  entries: ReadonlyArray<ZenConnectorEntry>,
): (ZenConnectIntent & { readonly customUrl: string | null }) | null {
  if (message === null || message.streaming === true || seen.has(message.id)) return null;
  if (entries.length === 0) return null;
  const intent = detectConnectIntent(message.text, entries);
  if (intent) return { ...intent, customUrl: null };
  const url = detectMcpUrlIntent(message.text);
  return url ? { appId: null, category: null, candidates: [], phrase: "", customUrl: url } : null;
}

/** The path the card shows: the one the person picked when it is available, else the best. */
export function shownPath(
  app: AgentAppView,
  picked: ZenConnectorPathKind | null,
): ZenConnectorPathKind | null {
  if (picked && app.paths.some((path) => path.kind === picked && path.available)) return picked;
  return app.bestPath;
}

/** A pasted address the card may hand to Claude Code's sign-in (never anything else). */
export function isCallbackAddress(text: string): boolean {
  return /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/callback\?\S*state=/.test(text.trim());
}

/** Text that looks like a credential: the card refuses to send it anywhere. */
export function looksLikeKey(text: string): boolean {
  return (
    /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/.test(text) ||
    /\b(?:ghp|gho|github_pat|xox[abprs]|shpat|ntn|zzk)_?[A-Za-z0-9_-]{12,}/.test(text) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(text) ||
    /(?:parola|password|api key|cheia api)\s*[:=]\s*\S{6,}/i.test(text)
  );
}

export const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};
