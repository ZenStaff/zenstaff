import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { zenText } from "../i18n/zenI18n";
import { SCHEDULED_LIMITS_SEARCH_TERMS, scheduledLimitsText } from "./scheduledLimits.i18n";

export function scheduledLimitsCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:zen-limits",
    searchTerms: SCHEDULED_LIMITS_SEARCH_TERMS,
    title: zenText(scheduledLimitsText).paletteTitle,
    icon: <GaugeIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/limits" });
    },
  };
}
