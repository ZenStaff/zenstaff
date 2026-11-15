// Zen Staff: the connect cards of a thread, shown right above the composer. A card appears when
// the person's message asks to connect an app (detected here, no model needed) or when the agent
// calls `start_connection` (the "Conectare" skill). Rendered by ChatView (1 import + 1 line).
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenConnectorEntry } from "@t3tools/contracts/zenConnectors";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect, useRef } from "react";

import { ZenCustomizeChatCard, type CustomizeChatMessage } from "../office/CustomizeChatCard";
import { ConnectCard } from "./ConnectCard";
import { connectorsCatalogAtom, connectorsCardsAtom, useConnectorsCall } from "./connectorsClient";
import { intentForMessage, type CardData } from "./connectState";
import { ZenIntakeDock } from "../intake/IntakeDock";
import { ZenApprovalDock } from "../approvals/ApprovalDock";
import { isIntakeThread } from "../intake/intakeState";

export interface ZenConnectDockProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly latestUserMessage: CustomizeChatMessage | null;
}

export function ZenConnectDock(props: ZenConnectDockProps) {
  const registry = useContext(RegistryContext);
  const { call } = useConnectorsCall();
  const catalogAtom = connectorsCatalogAtom(props.environmentId);
  const cardsAtom = connectorsCardsAtom(props.environmentId, props.threadId);
  const catalog = AsyncResult.getOrElse(useAtomValue(catalogAtom), () => null) as {
    readonly entries: ReadonlyArray<ZenConnectorEntry>;
  } | null;
  const cards = (AsyncResult.getOrElse(useAtomValue(cardsAtom), () => null) ??
    []) as ReadonlyArray<CardData>;
  const seen = useRef(new Set<string>());
  const entries = catalog?.entries ?? [];
  const message = props.latestUserMessage;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the server-side card for a new chat message (once per message id)
  useEffect(() => {
    if (message === null || entries.length === 0) return;
    const intent = intentForMessage(message, seen.current, entries);
    if (!message.streaming) seen.current.add(message.id);
    if (intent === null) return;
    void call("requests.create", {
      threadId: props.threadId,
      appId: intent.appId,
      category: intent.category,
      candidates: intent.candidates,
      customUrl: intent.customUrl,
      source: "chat",
      messageId: message.id,
    })
      .then(() => registry.refresh(cardsAtom))
      .catch(() => undefined);
  }, [call, cardsAtom, entries, message, props.threadId, registry]);

  const open = cards.filter(
    (card) => card.request.state === "open" || card.request.state === "connected",
  );
  // Zen customized packs: "Keep this change in the pack?" (CustomizeChatCard.tsx).
  const customize = (
    <>
      {isIntakeThread(message?.firstText) ? (
        <ZenIntakeDock
          environmentId={props.environmentId}
          threadId={props.threadId}
          latestUserMessageAtMs={message?.createdAtMs ?? null}
        />
      ) : null}
      <ZenCustomizeChatCard environmentId={props.environmentId} message={message} />
      <ZenApprovalDock environmentId={props.environmentId} threadId={props.threadId} />
    </>
  );
  if (open.length === 0 || entries.length === 0) {
    return (
      <div className="mx-auto mb-2 w-full max-w-3xl space-y-2 px-1 empty:hidden">{customize}</div>
    );
  }
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl space-y-2 px-1" data-zen-connect-dock>
      {customize}
      {open.slice(-3).map((card) => (
        <ConnectCard
          key={card.request.id}
          environmentId={props.environmentId}
          data={card}
          entries={entries}
          call={call}
          onChanged={() => registry.refresh(cardsAtom)}
        />
      ))}
    </div>
  );
}

/** The person's latest message of a thread projection (what ChatView passes in). */
export function zenLatestUserMessage(
  projection: {
    readonly messages: ReadonlyArray<{
      readonly id: string;
      readonly role: string;
      readonly text: string;
      readonly streaming: boolean;
      readonly createdAt?: unknown;
    }>;
  } | null,
): ZenConnectDockProps["latestUserMessage"] {
  const users = projection?.messages.filter((candidate) => candidate.role === "user") ?? [];
  const message = users.at(-1);
  return message
    ? {
        id: message.id,
        text: message.text,
        streaming: message.streaming,
        firstText: users[0]?.text ?? null,
        isFirst: users.length === 1,
        // The intake's own first message does not count as an answer to its buttons.
        createdAtMs: users.length === 1 ? null : epochMillis(message.createdAt),
      }
    : null;
}

function epochMillis(value: unknown): number | null {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
