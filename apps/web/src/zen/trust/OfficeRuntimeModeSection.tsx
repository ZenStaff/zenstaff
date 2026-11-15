// Zen Staff: the Office mode picker inside the composer's permissions menu. Two plain choices with
// one line each ("Automat", "Întreabă-mă la fiecare pas"); the other modes sit under "Avansat",
// full access last and with a warning. Hooked into ComposerFooterControls.tsx
// (ComposerPermissionsSection) when the edition is Office; Code keeps upstream's icon row.
import type { RuntimeMode } from "@t3tools/contracts";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { useZenText } from "../i18n/zenI18n";
import { trustText } from "./trust.i18n";
import { OFFICE_ADVANCED_RUNTIME_MODES, OFFICE_PLAIN_RUNTIME_MODES } from "./trustModel";

export interface OfficeRuntimeModeOption {
  readonly mode: RuntimeMode;
  readonly disabledReason?: string;
}

export function OfficeRuntimeModeSection(props: {
  readonly runtimeMode: RuntimeMode;
  readonly runtimeModeOptions: ReadonlyArray<OfficeRuntimeModeOption>;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const t = useZenText(trustText);
  const available = new Map(props.runtimeModeOptions.map((option) => [option.mode, option]));
  const plain = OFFICE_PLAIN_RUNTIME_MODES.filter((mode) => available.has(mode));
  const advanced = OFFICE_ADVANCED_RUNTIME_MODES.filter((mode) => available.has(mode));
  const [showAdvanced, setShowAdvanced] = useState(
    OFFICE_ADVANCED_RUNTIME_MODES.includes(props.runtimeMode),
  );
  const text: Record<RuntimeMode, { label: string; help: string }> = {
    auto: { label: t.autoLabel, help: t.autoHelp },
    "approval-required": { label: t.askLabel, help: t.askHelp },
    "auto-accept-edits": { label: t.editsLabel, help: t.editsHelp },
    "full-access": { label: t.fullLabel, help: t.fullHelp },
  };
  const onValueChange = (value: RuntimeMode) => {
    if (value !== props.runtimeMode) props.onRuntimeModeChange(value);
  };
  const item = (mode: RuntimeMode) => {
    const option = available.get(mode);
    const danger = mode === "full-access";
    return (
      <MenuPrimitive.RadioItem
        key={mode}
        value={mode}
        disabled={option?.disabledReason !== undefined}
        label={text[mode].label}
        closeOnClick
        data-zen-runtime-mode={mode}
        className="grid cursor-pointer grid-cols-[1rem_1fr] items-start gap-x-2 rounded-md px-2 py-1.5 text-start outline-none data-disabled:cursor-not-allowed data-disabled:opacity-40 data-checked:bg-input/72 data-highlighted:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span
          aria-hidden
          className="mt-1 size-2.5 rounded-full border border-muted-foreground/60 in-data-checked:border-foreground in-data-checked:bg-foreground"
        />
        <span className="grid gap-0.5">
          <span className={danger ? "text-destructive text-sm" : "text-foreground text-sm"}>
            {text[mode].label}
          </span>
          {!danger || option?.disabledReason !== undefined ? (
            <span className="text-muted-foreground text-xs leading-4">
              {option?.disabledReason ?? text[mode].help}
            </span>
          ) : null}
          {danger && option?.disabledReason === undefined ? (
            <span className="inline-flex items-center gap-1 text-destructive text-xs">
              <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />
              {t.fullHelp}
            </span>
          ) : null}
        </span>
      </MenuPrimitive.RadioItem>
    );
  };
  return (
    <div data-composer-permissions data-zen-no-translate className="grid w-80 gap-1 px-1 py-1.5">
      <div className="px-2 font-medium text-muted-foreground text-xs">{t.pickerTitle}</div>
      <MenuPrimitive.RadioGroup
        aria-label={t.pickerTitle}
        value={props.runtimeMode}
        onValueChange={onValueChange}
        className="grid gap-0.5"
      >
        {plain.map(item)}
      </MenuPrimitive.RadioGroup>
      {advanced.length > 0 ? (
        <MenuPrimitive.Item
          closeOnClick={false}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((value) => !value)}
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs outline-none data-highlighted:bg-accent data-highlighted:text-foreground"
        >
          <ChevronRightIcon
            aria-hidden
            className={showAdvanced ? "size-3 rotate-90 transition-transform" : "size-3"}
          />
          {t.advanced}
        </MenuPrimitive.Item>
      ) : null}
      {showAdvanced && advanced.length > 0 ? (
        <MenuPrimitive.RadioGroup
          aria-label={t.advanced}
          value={props.runtimeMode}
          onValueChange={onValueChange}
          className="grid gap-0.5"
        >
          {advanced.map(item)}
        </MenuPrimitive.RadioGroup>
      ) : null}
      <p className="border-t px-2 pt-1.5 text-muted-foreground text-xs leading-4">{t.rule}</p>
    </div>
  );
}
