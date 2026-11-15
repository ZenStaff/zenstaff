import type { useNavigate } from "@tanstack/react-router";
import {
  BriefcaseIcon,
  CodeIcon,
  LanguagesIcon,
  LayoutGridIcon,
  PlusIcon,
  LibraryBigIcon,
} from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useSyncExternalStore } from "react";

import { Button } from "../../components/ui/button";
import {
  ZEN_LOCALES,
  ZEN_LOCALE_NAMES,
  detectSystemZenLocale,
  setZenLocalePreference,
  useZenLocalePreference,
  useZenText,
  zenText,
  type ZenLocalePreference,
} from "../i18n/zenI18n";
import { getDeviceEdition, getServerEdition, subscribeZenEdition } from "./editionStore";
import { officeText } from "./office.i18n";
import { getZenEdition, setServerDefaultEdition, switchZenEdition } from "./officeState";
import { useZenEdition } from "./useZenEdition";
import { ZenAiAccountSettingsSection } from "../aiAccount/AiAccountPanel";

export function officeCommandPaletteItems(
  navigate: ReturnType<typeof useNavigate>,
): ReadonlyArray<CommandPaletteActionItem> {
  const t = zenText(officeText);
  const office = getZenEdition() === "office";
  return [
    {
      kind: "action",
      value: "action:zen-office-home",
      searchTerms: ["office", "home", "workflows", "tasks", "today", "birou", "sarcini", "azi"],
      title: t.openOfficeHome,
      icon: <LayoutGridIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/office" });
      },
    },
    {
      kind: "action",
      value: "action:zen-marketplace",
      searchTerms: [
        "marketplace",
        "workflows",
        "install",
        "packs",
        "store",
        "magazin",
        "instalează",
        "library",
        "bibliotecă",
        "biblioteca",
        "community",
        "comunitate",
        "publică",
      ],
      title: t.openMarketplace,
      icon: <LibraryBigIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/library" });
      },
    },
    {
      kind: "action",
      value: "action:zen-workflow-new",
      searchTerms: ["workflow", "create", "new", "template", "prompt", "creează", "sarcină nouă"],
      title: t.createWorkflow,
      icon: <PlusIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/workflow-editor" });
      },
    },
    {
      kind: "action",
      value: "action:zen-switch-edition",
      searchTerms: ["edition", "office", "code", "developer", "switch", "mode", "ediție", "birou"],
      title: office ? t.switchToCode : t.switchToOffice,
      icon: office ? (
        <CodeIcon className={ITEM_ICON_CLASS} />
      ) : (
        <BriefcaseIcon className={ITEM_ICON_CLASS} />
      ),
      run: async () => {
        const next = office ? "code" : "office";
        switchZenEdition(next);
        if (next === "office") await navigate({ to: "/office" });
      },
    },
  ];
}

/** Edition (per device, server default) and language, at the top of Settings > General. */
export function ZenEditionSettingsSection() {
  const t = useZenText(officeText);
  const edition = useZenEdition();
  const device = useSyncExternalStore(subscribeZenEdition, getDeviceEdition, getDeviceEdition);
  const server = useSyncExternalStore(subscribeZenEdition, getServerEdition, getServerEdition);
  const environmentId = usePrimaryEnvironmentId();
  const editionName = (value: "office" | "code") =>
    value === "office" ? t.editionOffice : t.editionCode;
  const preference = useZenLocalePreference();
  const detected = detectSystemZenLocale();
  const localeLabel = (value: ZenLocalePreference) =>
    value === "auto" ? t.languageAuto(ZEN_LOCALE_NAMES[detected]) : ZEN_LOCALE_NAMES[value];
  return (
    <>
      <SettingsSection id="zen-edition" title={t.edition}>
        <SettingsRow
          title={t.edition}
          description={
            <>
              {t.editionDescription}{" "}
              {device === null
                ? t.editionFollowsDefault
                : t.editionDefault(editionName(server ?? "code"))}
            </>
          }
          control={
            <div className="flex flex-col items-end gap-1.5" data-zen-no-translate="">
              <ToggleGroup
                value={[edition]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "office" || next === "code") switchZenEdition(next);
                }}
                aria-label={t.edition}
              >
                <ToggleGroupItem value="office">
                  <BriefcaseIcon />
                  {t.editionOffice}
                </ToggleGroupItem>
                <ToggleGroupItem value="code">
                  <CodeIcon />
                  {t.editionCode}
                </ToggleGroupItem>
              </ToggleGroup>
              {device !== null && device !== server ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void setServerDefaultEdition(environmentId, device)}
                >
                  {t.editionMakeDefault}
                </Button>
              ) : null}
            </div>
          }
        />
        <SettingsRow
          title={t.language}
          description={t.languageDescription}
          control={
            <Select
              value={preference}
              onValueChange={(value) => {
                if (value === "auto" || value === "en" || value === "ro")
                  setZenLocalePreference(value);
              }}
            >
              <SelectTrigger className="w-48" aria-label={t.language}>
                <LanguagesIcon aria-hidden className="size-4 text-muted-foreground" />
                <SelectValue>{localeLabel(preference)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(["auto", ...ZEN_LOCALES] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {localeLabel(value)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
      <ZenAiAccountSettingsSection />
    </>
  );
}
