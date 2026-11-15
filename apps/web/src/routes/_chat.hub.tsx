import { createFileRoute } from "@tanstack/react-router";

import { HubPage, type HubSearch } from "../zen/hub/HubPage";

export const Route = createFileRoute("/_chat/hub")({
  validateSearch: (raw: Record<string, unknown>): HubSearch => ({
    ...(raw.tab === "account" || raw.tab === "team" || raw.tab === "share" || raw.tab === "shared"
      ? { tab: raw.tab }
      : {}),
    ...(typeof raw.share === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(raw.share)
      ? { share: raw.share }
      : {}),
  }),
  component: HubRoute,
});

function HubRoute() {
  return <HubPage search={Route.useSearch()} />;
}
