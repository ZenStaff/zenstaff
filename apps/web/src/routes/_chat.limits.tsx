import { createFileRoute } from "@tanstack/react-router";

import { ScheduledLimitsPage } from "../zen/scheduledLimits/ScheduledLimitsPage";

export const Route = createFileRoute("/_chat/limits")({
  component: ScheduledLimitsPage,
});
