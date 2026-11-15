// Zen Staff command palette (Ctrl/Cmd+K): "Start a workflow..." lists the person's own workflows
// (pinned, then most used) and then every other one; each starts the same way as the sidebar's
// "My workflows" and the Office home card. Workflows also match from the root search. The list is
// the one the sidebar loaded (myWorkflowsState.ts), so the palette makes no query of its own.
import type { useNavigate } from "@tanstack/react-router";
import { PlayIcon } from "lucide-react";

import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "../../components/CommandPalette.logic";
import { getZenLocale, zenText } from "../i18n/zenI18n";
import { openWorkflowChat } from "../intake/openWorkflowChat";
import { WorkflowIcon } from "../office/workflowIcons";
import { myWorkflowsText } from "./myWorkflows.i18n";
import { type MyWorkflowSource, paletteWorkflowGroups } from "./myWorkflowsModel";
import { useMyWorkflowsStore } from "./myWorkflowsState";

export function myWorkflowsCommandPaletteItems(
  navigate: ReturnType<typeof useNavigate>,
): ReadonlyArray<CommandPaletteSubmenuItem> {
  const t = zenText(myWorkflowsText);
  const { catalog, pins, runs, togglePin } = useMyWorkflowsStore.getState();
  if (catalog.length === 0) return [];
  const { mine, rest } = paletteWorkflowGroups({
    workflows: catalog,
    pins,
    runs,
    locale: getZenLocale(),
  });
  const item = (workflow: MyWorkflowSource): CommandPaletteActionItem => ({
    kind: "action",
    value: `zen-workflow:${workflow.id}`,
    title: workflow.name,
    searchTerms: [workflow.name, workflow.id],
    icon: <WorkflowIcon name={workflow.icon} className={ITEM_ICON_CLASS} />,
    pin: {
      name: workflow.name,
      pinned: pins.includes(workflow.id),
      toggle: () => togglePin(workflow.id),
    },
    run: async () => {
      await openWorkflowChat(navigate, workflow.id);
    },
  });
  const groups: CommandPaletteGroup[] = [];
  if (mine.length > 0) {
    groups.push({ value: "zen-workflows-mine", label: t.paletteMine, items: mine.map(item) });
  }
  if (rest.length > 0) {
    groups.push({ value: "zen-workflows-all", label: t.paletteAll, items: rest.map(item) });
  }
  return [
    {
      kind: "submenu",
      value: "action:zen-workflow-start",
      searchTerms: ["workflow", "start", "run", "flux", "pornește", "sarcină"],
      title: t.paletteTitle,
      icon: <PlayIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <PlayIcon className={ADDON_ICON_CLASS} />,
      groups,
    },
  ];
}
