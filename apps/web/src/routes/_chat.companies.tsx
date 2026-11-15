import { createFileRoute } from "@tanstack/react-router";

import { CompaniesPage, type CompaniesSearch } from "../zen/companies/CompaniesPage";

export const Route = createFileRoute("/_chat/companies")({
  validateSearch: (raw: Record<string, unknown>): CompaniesSearch => ({
    ...(typeof raw.company === "string" && /^[a-z0-9-]{1,64}$/.test(raw.company)
      ? { company: raw.company }
      : {}),
    ...(raw.tab === "projects" ||
    raw.tab === "memory" ||
    raw.tab === "files" ||
    raw.tab === "settings"
      ? { tab: raw.tab }
      : {}),
  }),
  component: CompaniesRoute,
});

function CompaniesRoute() {
  return <CompaniesPage search={Route.useSearch()} />;
}
