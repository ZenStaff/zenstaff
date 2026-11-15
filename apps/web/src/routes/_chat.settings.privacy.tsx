import { createFileRoute } from "@tanstack/react-router";

import { PrivacySettingsPanel } from "../zen/telemetry/PrivacySettingsPanel";

// Zen Staff: Settings > Privacy (anonymous statistics). ZEN.md, "Updates and telemetry".
export const Route = createFileRoute("/_chat/settings/privacy")({
  component: PrivacySettingsPanel,
});
