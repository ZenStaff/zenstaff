import { createFileRoute } from "@tanstack/react-router";

import { CliSessionsPage } from "../zen/cliSessions/CliSessionsPage";

export const Route = createFileRoute("/_chat/terminal-sessions")({
  component: CliSessionsPage,
});
