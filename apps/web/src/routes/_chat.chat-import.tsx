import { createFileRoute } from "@tanstack/react-router";

import { ChatImportPage } from "../zen/chatImport/ChatImportPage";

export const Route = createFileRoute("/_chat/chat-import")({
  component: ChatImportPage,
});
