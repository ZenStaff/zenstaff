// Zen Staff: the phone app is not in the stores yet; upstream's App Store / Google Play links
// pointed at the T3 Code apps, so the row says "coming soon" instead (ZEN.md, "Mobile").
import { useZenText } from "../../zen/i18n/zenI18n";
import { aboutText } from "../../zen/about/about.i18n";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function MobileAppSettingsRow() {
  const t = useZenText(aboutText);
  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      description={t.mobileDescription}
      control={
        <span
          className="rounded-md border px-2 py-1 text-muted-foreground text-xs"
          data-zen-no-translate
        >
          {t.mobileSoon}
        </span>
      }
    />
  );
}
