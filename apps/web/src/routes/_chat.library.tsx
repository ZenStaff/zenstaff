import { createFileRoute } from "@tanstack/react-router";

import { MarketplacePage } from "../zen/office/MarketplacePage";

export interface LibrarySearch {
  /** A community pack to show and install (from a share page: zen://library?install=<slug>). */
  readonly install?: string;
}

export const Route = createFileRoute("/_chat/library")({
  validateSearch: (raw: Record<string, unknown>): LibrarySearch =>
    typeof raw.install === "string" && /^[a-z0-9-]{2,80}$/.test(raw.install)
      ? { install: raw.install }
      : {},
  component: MarketplacePage,
});
