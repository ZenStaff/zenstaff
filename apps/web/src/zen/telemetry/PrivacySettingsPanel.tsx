// Zen Staff: Settings > Privacy ("Confidențialitate"): the anonymous statistics choice, which can
// be changed anytime, and what the update check tells our update server. ZEN.md, "Updates and
// telemetry".
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useZenText } from "../i18n/zenI18n";
import { telemetryText } from "./telemetry.i18n";
import { TelemetryChoice } from "./TelemetryChoice";

export function PrivacySettingsPanel() {
  const t = useZenText(telemetryText);
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SettingsPageContainer>
      <SettingsSection id="zen-telemetry" title={t.privacy}>
        <SettingsRow
          title={t.statusTitle}
          description={t.privacyDescription}
          data-zen-privacy-telemetry
        >
          <TelemetryChoice environmentId={environmentId} className="pt-2" />
        </SettingsRow>
        <SettingsRow title={t.updatesTitle} description={t.updatesBody} />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
