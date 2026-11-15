// Zen Staff hub: sidebar button, command palette entry and the Settings section.
import { useNavigate } from "@tanstack/react-router";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import { UsersRoundIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import { useZenText, zenText } from "../i18n/zenI18n";
import { hubText } from "./hub.i18n";
import { useHubQuery } from "./hubClient";
import { usePrimaryEnvironmentId } from "../../state/environments";
import type { EnvironmentId } from "@t3tools/contracts";

export function hubCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  const t = zenText(hubText);
  return {
    kind: "action",
    value: "action:zen-hub",
    searchTerms: [
      "team",
      "hub",
      "share",
      "invite",
      "members",
      "colleague",
      "runner",
      "company",
      "echipa",
      "echipă",
      "membri",
      "coleg",
      "partajare",
      "invitatie",
      "invitație",
      "companie",
    ],
    title: t.paletteTitle,
    icon: <UsersRoundIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/hub", search: {} });
    },
  };
}

function describe(
  t: (typeof hubText)["en"],
  status: ZenHubStatus | null,
  error: string | null,
): string {
  if (error !== null) return error;
  if (status === null) return t.loading;
  if (!status.signedIn || status.user === null) {
    return status.hubUrl === null ? t.notSignedIn : t.notSignedInAt(status.hubUrl);
  }
  return `${status.hubUrl} · ${status.user.name} (${status.user.email})`;
}

/** Settings > General: which hub this machine uses and as whom. */
export function ZenHubSettingsSection() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : <HubSettingsRow environmentId={environmentId} />;
}

function HubSettingsRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const t = useZenText(hubText);
  const { data: status, error } = useHubQuery<ZenHubStatus>(environmentId, "status");
  return (
    <SettingsSection id="zen-hub" title={t.hubLabel}>
      <SettingsRow
        title={t.hubAndAccount}
        description={describe(t, status, error)}
        control={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: "/hub", search: { tab: "account" } })}
          >
            {status?.signedIn ? t.manage : t.signIn}
          </Button>
        }
      />
    </SettingsSection>
  );
}
