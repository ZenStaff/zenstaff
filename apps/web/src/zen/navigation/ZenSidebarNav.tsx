// Zen Staff sidebar navigation. The primary pages are labeled rows above the footer; the rest sit
// in one "More" menu in the footer's icon row, so the row never grows past the sidebar at any
// width. SidebarChrome renders <ZenSidebarNav /> above the footer row and <ZenSidebarItems />
// (which renders <ZenMoreMenu />) inside it. ZEN.md, "Sidebar navigation".
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  Building2Icon,
  EllipsisIcon,
  GaugeIcon,
  GraduationCapIcon,
  HistoryIcon,
  LayoutGridIcon,
  MessagesSquareIcon,
  PlugIcon,
  SquareTerminalIcon,
  LibraryBigIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useAcademyStrings } from "../academy/academy.i18n";
import { chatText } from "../chat/chat.i18n";
import { chatImportText } from "../chatImport/chatImport.i18n";
import { cliSessionsText } from "../cliSessions/cliSessions.i18n";
import { connectorsText } from "../connectors/connectors.i18n";
import { hubText } from "../hub/hub.i18n";
import { useZenText } from "../i18n/zenI18n";
import { officeText } from "../office/office.i18n";
import { useZenEdition } from "../office/useZenEdition";
import { scheduledLimitsText } from "../scheduledLimits/scheduledLimits.i18n";
import { staffText } from "../staff/staff.i18n";
import { navText } from "./nav.i18n";
import { ZenMyWorkflows } from "./ZenMyWorkflows";
import { ZEN_NAV_ROUTES, type ZenNavPage, zenNavLayout, zenNavPageForPath } from "./navModel";

const NAV_ICONS: Record<ZenNavPage, LucideIcon> = {
  office: LayoutGridIcon,
  staff: BotIcon,
  marketplace: LibraryBigIcon,
  academy: GraduationCapIcon,
  hub: UsersRoundIcon,
  connections: PlugIcon,
  chatIntegrations: MessagesSquareIcon,
  chatImport: HistoryIcon,
  companies: Building2Icon,
  terminalSessions: SquareTerminalIcon,
  limits: GaugeIcon,
};

function useNavLabels(): Record<ZenNavPage, string> {
  const office = useZenText(officeText);
  const staff = useZenText(staffText);
  const academy = useAcademyStrings();
  const hub = useZenText(hubText);
  const connectors = useZenText(connectorsText);
  const chat = useZenText(chatText);
  const chatImport = useZenText(chatImportText);
  const cliSessions = useZenText(cliSessionsText);
  const limits = useZenText(scheduledLimitsText);
  const nav = useZenText(navText);
  return {
    office: office.officeHome,
    staff: staff.navLabel,
    marketplace: office.marketplace,
    academy: academy.sidebarLabel,
    hub: hub.team,
    connections: connectors.sidebar,
    chatIntegrations: chat.title,
    chatImport: chatImport.navLabel,
    companies: nav.companies,
    terminalSessions: cliSessions.navLabel,
    limits: limits.navLabel,
  };
}

function useOpenNavPage() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return (page: ZenNavPage) => {
    if (isMobile) setOpenMobile(false);
    // Every Zen route accepts an empty search (their validateSearch fields are optional).
    void navigate({ to: ZEN_NAV_ROUTES[page], search: {} } as Parameters<typeof navigate>[0]);
  };
}

/**
 * "My workflows" (pinned and most used, ZenMyWorkflows.tsx), then the primary pages as labeled
 * rows, above the footer's icon row (both editions).
 */
export function ZenSidebarNav() {
  const edition = useZenEdition();
  const labels = useNavLabels();
  const nav = useZenText(navText);
  const open = useOpenNavPage();
  const active = useLocation({ select: (location) => zenNavPageForPath(location.pathname) });
  const { primary } = zenNavLayout(edition);
  return (
    <>
      <ZenMyWorkflows />
      <nav aria-label={nav.sectionLabel} data-zen-sidebar-nav>
        <SidebarMenu>
          {primary.map((page) => {
            const Icon = NAV_ICONS[page];
            return (
              <SidebarMenuItem key={page}>
                <SidebarMenuButton
                  isActive={active === page}
                  aria-current={active === page ? "page" : undefined}
                  onClick={() => open(page)}
                  data-zen-nav={page}
                  {...(page === "staff" ? { "data-zen-staff-nav": true } : {})}
                >
                  <Icon />
                  <span>{labels[page]}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </nav>
    </>
  );
}

/** One icon button in the footer row that lists the secondary pages. */
export function ZenMoreMenu() {
  const edition = useZenEdition();
  const labels = useNavLabels();
  const nav = useZenText(navText);
  const open = useOpenNavPage();
  const active = useLocation({ select: (location) => zenNavPageForPath(location.pathname) });
  const { more } = zenNavLayout(edition);
  return (
    <SidebarMenuItem className="shrink-0">
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <SidebarMenuButton
                    aria-label={nav.more}
                    size="icon"
                    isActive={active !== null && more.includes(active)}
                    data-zen-more
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
            }
          />
          <TooltipPopup side="top">{nav.moreTooltip}</TooltipPopup>
        </Tooltip>
        <MenuPopup side="top" align="start" className="min-w-52">
          {more.map((page) => {
            const Icon = NAV_ICONS[page];
            return (
              <MenuItem key={page} onClick={() => open(page)} data-zen-nav={page}>
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {labels[page]}
              </MenuItem>
            );
          })}
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}
