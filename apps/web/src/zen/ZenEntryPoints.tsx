// Zen Staff: the sidebar navigation and every Zen page's command palette entry, so upstream files
// only render <ZenSidebarNav />, <ZenSidebarItems /> and spread zenCommandPaletteItems(). ZEN.md.
import type { useNavigate } from "@tanstack/react-router";

import type {
  CommandPaletteActionItem,
  CommandPaletteSubmenuItem,
} from "../components/CommandPalette.logic";
import { cliSessionsCommandPaletteItem } from "./cliSessions/CliSessionsEntryPoints";
import { academyCommandPaletteItem } from "./academy/AcademyEntryPoints";
import { AcademyTipsHost } from "./academy/AcademyTipsHost";
import { companiesCommandPaletteItem } from "./companies/CompaniesEntryPoints";
import { connectorsCommandPaletteItem } from "./connectors/ConnectorsEntryPoints";
import { hubCommandPaletteItem } from "./hub/HubEntryPoints";
import { HubSync } from "./hub/HubSync";
import { chatIntegrationsCommandPaletteItem } from "./chat/ChatEntryPoints";
import { staffCommandPaletteItem } from "./staff/StaffEntryPoints";
import { ZenOnboardingGate } from "./onboarding/OnboardingGate";
import { ZenTelemetryGate } from "./telemetry/TelemetryGate";
import { ZenAiConnectDialogHost } from "./aiConnect/AiConnectPanel";
import { chatImportCommandPaletteItem } from "./chatImport/ChatImportEntryPoints";
import { myWorkflowsCommandPaletteItems } from "./navigation/myWorkflowsPalette";
import { ZenMoreMenu } from "./navigation/ZenSidebarNav";
import { ZenAddFolderHost } from "./office/AddFolderDialog";
import { officeCommandPaletteItems } from "./office/OfficeEntryPoints";
import { getZenEdition } from "./office/officeState";
import { scheduledLimitsCommandPaletteItem } from "./scheduledLimits/ScheduledLimitsEntryPoints";

export { ZenSidebarNav } from "./navigation/ZenSidebarNav";

/**
 * Rendered inside the footer's icon row: the "More" menu (the labeled primary pages are
 * <ZenSidebarNav /> above the row), plus the hosts that must stay mounted with the sidebar.
 */
export function ZenSidebarItems() {
  return (
    <>
      <ZenMoreMenu />
      <AcademyTipsHost />
      <HubSync />
      <ZenOnboardingGate />
      <ZenTelemetryGate />
      <ZenAiConnectDialogHost />
      <ZenAddFolderHost />
    </>
  );
}

export function zenCommandPaletteItems(
  navigate: ReturnType<typeof useNavigate>,
): ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem> {
  const office = getZenEdition() === "office";
  return [
    ...myWorkflowsCommandPaletteItems(navigate),
    ...officeCommandPaletteItems(navigate),
    staffCommandPaletteItem(navigate),
    ...(office
      ? []
      : [cliSessionsCommandPaletteItem(navigate), scheduledLimitsCommandPaletteItem(navigate)]),
    companiesCommandPaletteItem(navigate),
    academyCommandPaletteItem(navigate),
    hubCommandPaletteItem(navigate),
    connectorsCommandPaletteItem(navigate),
    chatIntegrationsCommandPaletteItem(navigate),
    chatImportCommandPaletteItem(navigate),
  ];
}
