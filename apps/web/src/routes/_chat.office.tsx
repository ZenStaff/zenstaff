import { createFileRoute } from "@tanstack/react-router";

import { OfficeHomePage } from "../zen/office/OfficeHomePage";

export const Route = createFileRoute("/_chat/office")({
  component: OfficeHomePage,
});
