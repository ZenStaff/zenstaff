import { createFileRoute } from "@tanstack/react-router";

import { parseStaffSearch, StaffPage } from "../zen/staff/StaffPage";

export const Route = createFileRoute("/_chat/staff")({
  validateSearch: parseStaffSearch,
  component: StaffRoute,
});

function StaffRoute() {
  return <StaffPage search={Route.useSearch()} />;
}
