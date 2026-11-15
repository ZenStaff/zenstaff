import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsPage } from "../zen/connectors/ConnectionsPage";

export const Route = createFileRoute("/_chat/connections")({
  component: ConnectionsPage,
});
