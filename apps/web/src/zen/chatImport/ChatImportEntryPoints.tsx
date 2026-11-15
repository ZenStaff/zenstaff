import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { zenText } from "../i18n/zenI18n";
import { CHAT_IMPORT_SEARCH_TERMS, chatImportText } from "./chatImport.i18n";

export function chatImportCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:zen-chat-import",
    searchTerms: CHAT_IMPORT_SEARCH_TERMS,
    title: zenText(chatImportText).paletteTitle,
    icon: <MessagesSquareIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/chat-import" });
    },
  };
}
