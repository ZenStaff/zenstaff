// Zen Staff sidebar navigation: which pages are primary (labeled rows) and which sit in the "More"
// menu, per edition. Pure, so the layout rules are tested (navModel.test.ts). ZEN.md, "Sidebar".
import type { ZenEdition } from "@t3tools/contracts/zenOffice";

export type ZenNavPage =
  | "office"
  | "staff"
  | "marketplace"
  | "academy"
  | "hub"
  | "connections"
  | "chatIntegrations"
  | "chatImport"
  | "companies"
  | "terminalSessions"
  | "limits";

export const ZEN_NAV_ROUTES: Record<ZenNavPage, string> = {
  office: "/office",
  staff: "/staff",
  // The store is the Library ("Bibliotecă"); /marketplace redirects there.
  marketplace: "/library",
  academy: "/academy",
  hub: "/hub",
  connections: "/connections",
  chatIntegrations: "/chat-integrations",
  chatImport: "/chat-import",
  companies: "/companies",
  terminalSessions: "/terminal-sessions",
  limits: "/limits",
};

/** At most this many labeled rows, so the thread list keeps most of the sidebar. */
export const ZEN_NAV_MAX_PRIMARY = 5;

export interface ZenNavLayout {
  readonly primary: ReadonlyArray<ZenNavPage>;
  readonly more: ReadonlyArray<ZenNavPage>;
}

/**
 * Office: the five places people work from (Birou, AI staff, store, Academy, team); everything
 * else under "More". Code: the same without the Office home, which moves to "More" next to the
 * developer pages (terminal sessions, limits) that Office hides.
 */
export function zenNavLayout(edition: ZenEdition): ZenNavLayout {
  if (edition === "office") {
    return {
      primary: ["office", "staff", "marketplace", "academy", "hub"],
      more: ["connections", "chatIntegrations", "chatImport", "companies"],
    };
  }
  return {
    primary: ["staff", "marketplace", "academy", "hub"],
    more: [
      "office",
      "connections",
      "chatIntegrations",
      "chatImport",
      "companies",
      "terminalSessions",
      "limits",
    ],
  };
}

/** The page a path belongs to (for the active row), or null. */
export function zenNavPageForPath(pathname: string): ZenNavPage | null {
  for (const [page, route] of Object.entries(ZEN_NAV_ROUTES) as Array<[ZenNavPage, string]>) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return page;
  }
  if (pathname === "/workflow-editor") return "office";
  if (pathname === "/marketplace") return "marketplace";
  return null;
}
