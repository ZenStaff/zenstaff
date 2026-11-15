// Zen Staff: Settings > General > Tools. The toolchains installed for workflows on this computer:
// size, which workflows use them, verify, remove, clean up unused ones, how long unused tools are
// kept, and whether this computer is the company's always-on server.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  formatBytes,
  type ZenInstalledToolchain,
  type ZenToolchainOverview,
} from "@t3tools/contracts/zenToolchains";
import { AsyncResult } from "effect/reactivity";
import {
  CheckIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { ZenEnterpriseAccessSection } from "./EnterpriseAccessSection";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { callToolchains, toolchainOverview } from "./toolchainsState";
import { toolsSettingsText } from "./toolsSettings.i18n";

const KEEP_DAYS: ReadonlyArray<number> = [30, 60, 90, 180, 0];

function useDate() {
  const locale = useZenLocale();
  const t = useZenText(toolsSettingsText);
  return (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-US") : t.never;
}

export function ZenToolsSettingsSection() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return (
    <>
      <ToolsSection environmentId={environmentId} />
      <ZenEnterpriseAccessSection environmentId={environmentId} />
    </>
  );
}

function ToolsSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(toolsSettingsText);
  const date = useDate();
  const atom = toolchainOverview({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => appAtomRegistry.refresh(atom);
  const act = async (key: string, run: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const outcome = await run();
    setBusy(null);
    if (!outcome.ok) setError(outcome.error ?? t.somethingWrong);
    refresh();
  };

  if (!AsyncResult.isSuccess(result)) {
    return (
      <SettingsSection id="zen-tools" title={t.section}>
        <SettingsRow title={t.rowTitle} description={t.loading} />
      </SettingsSection>
    );
  }
  const overview = result.value;
  const settings = overview.settings;
  const keepLabel = (days: number) => (days === 0 ? t.forever : t.days(days));

  return (
    <SettingsSection id="zen-tools" title={t.section}>
      <SettingsRow
        title={t.rowTitle}
        description={t.summary(
          overview.root,
          overview.installed.length,
          formatBytes(overview.totalBytes),
        )}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || overview.unusedCount === 0}
            onClick={() => void act("cleanup", () => callToolchains("cleanup", environmentId, {}))}
          >
            <Trash2Icon />
            {t.cleanUp(overview.unusedCount)}
          </Button>
        }
      />
      {overview.installed.length === 0 ? (
        <SettingsRow title={t.nothingTitle} description={t.nothingDescription} />
      ) : (
        overview.installed.map((tool) => (
          <ToolRow
            key={`${tool.toolId}@${tool.version}`}
            tool={tool}
            busy={busy}
            onVerify={() =>
              void act(`verify:${tool.toolId}`, () =>
                callToolchains("verify", environmentId, {
                  toolId: tool.toolId,
                  version: tool.version,
                }),
              )
            }
            onRemove={() =>
              void act(`remove:${tool.toolId}`, () =>
                callToolchains("remove", environmentId, {
                  toolId: tool.toolId,
                  version: tool.version,
                }),
              )
            }
          />
        ))
      )}
      {error ? (
        <p role="alert" className="px-4 py-2 text-destructive-foreground text-sm">
          {error}
        </p>
      ) : null}
      <SettingsRow
        title={t.keepTitle}
        description={t.keepDescription}
        control={
          <Select
            value={String(settings.autoRemoveDays)}
            onValueChange={(value) =>
              void act("settings", () =>
                callToolchains("setSettings", environmentId, {
                  ...settings,
                  autoRemoveDays: Number(value),
                }),
              )
            }
          >
            <SelectTrigger aria-label={t.keepTitle} className="w-36">
              <SelectValue>{keepLabel(settings.autoRemoveDays)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {KEEP_DAYS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {keepLabel(days)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={t.runnerTitle}
        description={t.runnerDescription}
        control={
          <Switch
            checked={settings.companyRunner}
            aria-label={t.runnerTitle}
            onCheckedChange={(checked) =>
              void act("settings", () =>
                callToolchains("setSettings", environmentId, {
                  ...settings,
                  companyRunner: Boolean(checked),
                }),
              )
            }
          />
        }
      />
      <SettingsRow
        title={t.systemTitle}
        description={t.systemDescription}
        control={
          <Switch
            checked={settings.useSystemTools !== false}
            aria-label={t.systemTitle}
            onCheckedChange={(checked) =>
              void act("settings", () =>
                callToolchains("setSettings", environmentId, {
                  ...settings,
                  useSystemTools: Boolean(checked),
                }),
              )
            }
          />
        }
      />
      {settings.useSystemTools !== false ? (
        <SystemToolsList
          found={overview.systemTools ?? []}
          pinned={settings.pinnedTools ?? []}
          onUnpin={(toolId) =>
            void act("settings", () =>
              callToolchains("setSettings", environmentId, {
                ...settings,
                pinnedTools: (settings.pinnedTools ?? []).filter((id) => id !== toolId),
              }),
            )
          }
        />
      ) : null}
      <SettingsRow
        title={t.companyPinnedTitle}
        description={t.companyPinnedDescription}
        control={
          <Switch
            checked={settings.companyPinned === true}
            aria-label={t.companyPinnedTitle}
            onCheckedChange={(checked) =>
              void act("settings", () =>
                callToolchains("setSettings", environmentId, {
                  ...settings,
                  companyPinned: Boolean(checked),
                }),
              )
            }
          />
        }
      />
      <MirrorRow
        value={settings.toolsMirror ?? "default"}
        onChange={(toolsMirror) =>
          void act("settings", () =>
            callToolchains("setSettings", environmentId, { ...settings, toolsMirror }),
          )
        }
      />
      <SettingsRow
        title={t.safety}
        description={`${t.sandbox[overview.sandbox] ?? ""} ${t.advisories(
          overview.advisories.source,
          overview.advisories.generatedAt ? date(overview.advisories.generatedAt) : null,
          overview.advisories.blockedCount,
        )}`}
      />
    </SettingsSection>
  );
}

function SystemToolsList(props: {
  readonly found: NonNullable<ZenToolchainOverview["systemTools"]>;
  readonly pinned: ReadonlyArray<string>;
  readonly onUnpin: (toolId: string) => void;
}) {
  const t = useZenText(toolsSettingsText);
  if (props.found.length === 0) {
    return <SettingsRow title={t.systemFound} description={t.systemNone} />;
  }
  return (
    <SettingsRow
      title={t.systemFound}
      status={
        <ul className="mt-1 flex flex-col gap-1">
          {props.found.map((tool) => {
            const pinned = props.pinned.includes(tool.toolId);
            return (
              <li key={`${tool.toolId}:${tool.path}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {tool.name}
                  {tool.version ? ` ${tool.version}` : ""}
                </span>
                <span className="break-all font-mono text-xs">{tool.path}</span>
                <span className="text-xs">
                  {pinned
                    ? t.systemPinned
                    : tool.usable
                      ? t.systemUsable
                      : t.systemNotUsed(tool.reason ?? "")}
                </span>
                {pinned ? (
                  <Button size="micro" variant="ghost" onClick={() => props.onUnpin(tool.toolId)}>
                    {t.systemUnpin}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}

function MirrorRow(props: { readonly value: string; readonly onChange: (value: string) => void }) {
  const t = useZenText(toolsSettingsText);
  const mode =
    props.value === "default" || props.value === ""
      ? "default"
      : props.value === "off"
        ? "off"
        : "custom";
  const [custom, setCustom] = useState(mode === "custom" ? props.value : "");
  const [editing, setEditing] = useState(mode === "custom");
  const shown = editing ? "custom" : mode;
  const label = { default: t.mirrorDefault, off: t.mirrorOff, custom: t.mirrorCustom }[shown];
  return (
    <SettingsRow
      title={t.mirrorTitle}
      description={t.mirrorDescription}
      status={
        <>
          {shown === "custom" ? (
            <span className="mt-1 flex gap-2">
              <Input
                value={custom}
                placeholder={t.mirrorPlaceholder}
                aria-label={t.mirrorCustom}
                onChange={(event) => setCustom(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!custom.startsWith("https://")}
                onClick={() => props.onChange(custom.trim())}
              >
                {t.save}
              </Button>
            </span>
          ) : null}
        </>
      }
      control={
        <Select
          value={shown}
          onValueChange={(value) => {
            if (value === "custom") setEditing(true);
            else {
              setEditing(false);
              props.onChange(String(value));
            }
          }}
        >
          <SelectTrigger aria-label={t.mirrorTitle} className="w-56">
            <SelectValue>{label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="default">{t.mirrorDefault}</SelectItem>
            <SelectItem value="off">{t.mirrorOff}</SelectItem>
            <SelectItem value="custom">{t.mirrorCustom}</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ToolRow(props: {
  readonly tool: ZenInstalledToolchain;
  readonly busy: string | null;
  readonly onVerify: () => void;
  readonly onRemove: () => void;
}) {
  const { tool } = props;
  const t = useZenText(toolsSettingsText);
  const date = useDate();
  const used =
    tool.usedBy.length === 0
      ? t.notUsed
      : t.usedBy(tool.usedBy.slice(0, 3).join(", "), Math.max(0, tool.usedBy.length - 3));
  return (
    <SettingsRow
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          <WrenchIcon className="size-3.5 text-muted-foreground" />
          {tool.name}
          <span className="font-normal text-muted-foreground">{tool.version}</span>
          {tool.blocked ? (
            <Badge variant="error" size="sm">
              <ShieldAlertIcon />
              {t.blocked}
            </Badge>
          ) : null}
          {tool.license.commercialUse === "paid" ? (
            <Badge variant="warning" size="sm">
              {t.license}
            </Badge>
          ) : null}
          {tool.lastVerify ? (
            <Badge variant={tool.lastVerify.ok ? "success" : "error"} size="sm">
              {tool.lastVerify.ok ? <CheckIcon /> : <XIcon />}
              {tool.lastVerify.ok ? t.works : t.broken}
            </Badge>
          ) : null}
        </span>
      }
      description={`${formatBytes(tool.sizeBytes)} · ${used} · ${t.lastUsed(date(tool.lastUsedAt))}${tool.blocked ? ` · ${tool.blocked}` : ""}`}
      control={
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={props.busy !== null} onClick={props.onVerify}>
            <RefreshCwIcon />
            {t.verify}
          </Button>
          <Button size="sm" variant="ghost" disabled={props.busy !== null} onClick={props.onRemove}>
            <Trash2Icon />
            {t.remove}
          </Button>
        </div>
      }
    />
  );
}
