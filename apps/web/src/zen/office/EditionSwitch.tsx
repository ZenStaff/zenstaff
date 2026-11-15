// Zen Staff: the Office/Code switch at the top of the sidebar, next to the company switcher (it
// stays in Settings > General and the command palette too). Per device, like the Settings row.
// Icons only while the sidebar is narrow (the parent is an @container).
import { BriefcaseIcon, CodeIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { useZenText } from "../i18n/zenI18n";
import { navText } from "../navigation/nav.i18n";
import { switchZenEdition } from "./officeState";
import { useZenEdition } from "./useZenEdition";

export function ZenEditionSwitch() {
  const edition = useZenEdition();
  const t = useZenText(navText);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleGroup
            value={[edition]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "office" || next === "code") switchZenEdition(next);
            }}
            aria-label={t.editionSwitch}
            data-zen-edition-switch
            // "Code" is also an upstream word the Office rewriter translates; these are names.
            data-zen-no-translate
          >
            <ToggleGroupItem value="office" aria-label={t.editionOfficeHint}>
              <BriefcaseIcon aria-hidden />
              <span className="hidden @[22rem]:inline">{t.editionOffice}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="code" aria-label={t.editionCodeHint}>
              <CodeIcon aria-hidden />
              <span className="hidden @[22rem]:inline">{t.editionCode}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <TooltipPopup side="bottom">{t.editionSwitchHint}</TooltipPopup>
    </Tooltip>
  );
}
