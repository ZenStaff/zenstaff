import { createFileRoute } from "@tanstack/react-router";

import {
  ChatIntegrationsPage,
  type ChatIntegrationsSearch,
} from "../zen/chat/ChatIntegrationsPage";
import { isChatTab } from "../zen/chat/chatModel";

export const Route = createFileRoute("/_chat/chat-integrations")({
  validateSearch: (raw: Record<string, unknown>): ChatIntegrationsSearch =>
    isChatTab(raw.tab) ? { tab: raw.tab } : {},
  component: ChatIntegrationsRoute,
});

function ChatIntegrationsRoute() {
  return <ChatIntegrationsPage search={Route.useSearch()} />;
}
