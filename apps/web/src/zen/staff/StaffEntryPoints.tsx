// Zen Staff AI staff: sidebar button and command palette entry.
import { useNavigate } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { zenText } from "../i18n/zenI18n";
import { STAFF_SEARCH_TERMS, staffText } from "./staff.i18n";

export function staffCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:zen-staff",
    searchTerms: STAFF_SEARCH_TERMS,
    title: zenText(staffText).paletteTitle,
    icon: <BotIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/staff", search: {} });
    },
  };
}
