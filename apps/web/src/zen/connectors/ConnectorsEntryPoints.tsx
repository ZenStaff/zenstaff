// Zen Staff connectors: sidebar button and command palette entry for /connections.
import { useNavigate } from "@tanstack/react-router";
import { PlugIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { zenText } from "../i18n/zenI18n";
import { connectorsText } from "./connectors.i18n";

export function connectorsCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  const text = zenText(connectorsText);
  return {
    kind: "action",
    value: "action:zen-connections",
    searchTerms: [
      "connections",
      "connect",
      "conexiuni",
      "conectare",
      "gmail",
      "mcp",
      "integrations",
      "integrari",
      "apps",
    ],
    title: text.palette,
    icon: <PlugIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/connections" });
    },
  };
}
