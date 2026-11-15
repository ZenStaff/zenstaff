import { useNavigate } from "@tanstack/react-router";
import { SquareTerminalIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { zenText } from "../i18n/zenI18n";
import { CLI_SESSIONS_SEARCH_TERMS, cliSessionsText } from "./cliSessions.i18n";

export function cliSessionsCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:zen-terminal-sessions",
    searchTerms: CLI_SESSIONS_SEARCH_TERMS,
    title: zenText(cliSessionsText).paletteTitle,
    icon: <SquareTerminalIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/terminal-sessions" });
    },
  };
}
