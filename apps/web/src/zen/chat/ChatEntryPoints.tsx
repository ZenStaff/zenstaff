// Zen Staff chat integrations: sidebar button and command palette entry (both editions).
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { zenText } from "../i18n/zenI18n";
import { chatText } from "./chat.i18n";

export function chatIntegrationsCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  const t = zenText(chatText);
  return {
    kind: "action",
    value: "action:zen-chat-integrations",
    searchTerms: [
      "chat",
      "slack",
      "teams",
      "discord",
      "telegram",
      "whatsapp",
      "google chat",
      "bot",
      "integrari",
      "integrări",
      "approvals",
      "reports",
    ],
    title: t.paletteTitle,
    icon: <MessagesSquareIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/chat-integrations", search: {} });
    },
  };
}
