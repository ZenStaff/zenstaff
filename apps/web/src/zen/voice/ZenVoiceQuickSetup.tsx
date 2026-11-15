// The simple voice setup Office users see the first time they press the composer microphone:
// language, model size, how to talk, then one button that downloads the model and starts
// recording. Everything it writes is upstream state (the audio grant, client settings, the
// environment's speech model), so Settings → Voice shows and changes the same choices.
import {
  cancelEnvironmentSpeechModelDownload,
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getEnvironmentSpeechStatus,
  selectEnvironmentSpeechModel,
} from "@t3tools/client-runtime/voice-input";
import {
  AuthSettingsWriteScope,
  type EnvironmentSpeechModel,
  type EnvironmentSpeechStatus,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { CheckIcon, GlobeIcon, MicIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "~/components/ui/wizard";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn, isMacPlatform } from "~/lib/utils";
import { runEnvironmentSpeech } from "~/speech/runEnvironmentSpeech";
import { chooseAudioDestination } from "~/speech/voiceConsent";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentScope, usePreparedConnection } from "~/state/session";
import { browserDictationConstructor } from "./useZenSpeechInput";
import {
  ZEN_VOICE_LANGUAGES,
  ZEN_VOICE_MODEL_CHOICES,
  downloadPercent,
  isLocalTranscriptionHost,
  recommendZenVoiceSize,
  zenVoiceLanguageFromSetting,
  zenVoiceModeFromSetting,
  zenVoiceModelChoice,
  type ZenVoiceLanguage,
  type ZenVoiceMode,
  type ZenVoiceSize,
} from "./zenVoiceModel";
import { useZenText } from "../i18n/zenI18n";
import { voiceMessages } from "./voice.i18n";
import { useZenVoiceStore } from "./zenVoiceState";

/** Lets the new grant reach the composer's hook before its start runs. */
const START_DELAY_MS = 400;

function Choice(props: {
  selected: boolean;
  onSelect(): void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      disabled={props.disabled}
      onClick={props.onSelect}
      className={cn(
        "rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60",
        props.selected
          ? "border-primary bg-primary/8 ring-1 ring-primary"
          : "border-border/70 bg-card/60 hover:bg-accent/50",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function ZenVoiceQuickSetup() {
  const request = useZenVoiceStore((store) => store.setup);
  return request ? <QuickSetupDialog key={request.id} request={request} /> : null;
}

function QuickSetupDialog({
  request,
}: {
  request: NonNullable<ReturnType<typeof useZenVoiceStore.getState>["setup"]>;
}) {
  const t = useZenText(voiceMessages);
  const closeSetup = useZenVoiceStore((store) => store.closeSetup);
  const setEngine = useZenVoiceStore((store) => store.setEngine);
  const navigate = useNavigate();
  const environmentId = request.environmentId;
  const environment = useEnvironment(environmentId);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const prepared = Option.getOrNull(usePreparedConnection(environmentId));
  const canManage = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const languageSetting = useClientSettings((settings) => settings.speechLanguage);
  const modeSetting = useClientSettings((settings) => settings.voiceShortcutMode);

  // The dialog edits its own copy of the settings and writes them when the person starts.
  const [initialLanguage] = useState(() => zenVoiceLanguageFromSetting(languageSetting));
  const [language, setLanguage] = useState<ZenVoiceLanguage>(initialLanguage);
  const [mode, setMode] = useState<ZenVoiceMode>(() => zenVoiceModeFromSetting(modeSetting));
  const [size, setSize] = useState<ZenVoiceSize>("best");
  const [status, setStatus] = useState<EnvironmentSpeechStatus | null>(null);
  const [models, setModels] = useState<ReadonlyArray<EnvironmentSpeechModel>>([]);
  const [busy, setBusy] = useState<"download" | null>(null);
  const [error, setError] = useState<"errorUnreachable" | "errorDownload" | "errorSwitch" | null>(
    null,
  );
  const loadRequest = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the environment's speech status and installed models each time the dialog opens
  useEffect(() => {
    if (!prepared) return;
    const current = ++loadRequest.current;
    void Promise.all([
      runEnvironmentSpeech(getEnvironmentSpeechStatus(prepared)),
      runEnvironmentSpeech(getEnvironmentSpeechModels(prepared)).catch(() => ({ models: [] })),
    ])
      .then(([nextStatus, catalog]) => {
        if (current !== loadRequest.current) return;
        setStatus(nextStatus);
        setModels(catalog.models);
        setSize(
          recommendZenVoiceSize({
            language: initialLanguage,
            installedModelIds: catalog.models
              .filter((model) => model.state === "installed")
              .map((model) => model.id),
            selectedModelId: nextStatus.supported ? nextStatus.modelId : null,
          }),
        );
      })
      .catch(() => {
        if (current === loadRequest.current) setError("errorUnreachable");
      });
  }, [prepared, initialLanguage]);

  const choice = zenVoiceModelChoice(size);
  const model = models.find((candidate) => candidate.id === choice.modelId) ?? null;
  const installed = model?.state === "installed";
  const supported = status?.supported === true;
  const local = isLocalTranscriptionHost(httpBaseUrl);
  const webSpeech = browserDictationConstructor() !== null;
  const percent = model ? downloadPercent(model) : null;
  const shortcut = isMacPlatform(globalThis.navigator?.platform ?? "") ? "⌘⇧D" : "Ctrl+Shift+D";

  const close = () => {
    loadRequest.current += 1;
    closeSetup();
  };

  const finish = (startRecording: () => void) => {
    closeSetup();
    window.setTimeout(startRecording, START_DELAY_MS);
  };

  const pollProgress = useStableCallback(() => {
    if (!prepared) return () => undefined;
    const timer = window.setInterval(() => {
      void runEnvironmentSpeech(getEnvironmentSpeechModels(prepared))
        .then((catalog) => setModels(catalog.models))
        .catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  });

  const startLocal = useStableCallback(async () => {
    if (!prepared || !supported) return;
    const current = loadRequest.current;
    setError(null);
    await updateClientSettings({ speechLanguage: language, voiceShortcutMode: mode });
    if (!installed) {
      setBusy("download");
      const stop = pollProgress();
      let landed = false;
      try {
        const catalog = await runEnvironmentSpeech(
          downloadEnvironmentSpeechModel(prepared, choice.modelId),
        );
        setModels(catalog.models);
        landed = catalog.models.some(
          ({ id, state }) => id === choice.modelId && state === "installed",
        );
      } catch {
        landed = false;
      }
      if (!landed) {
        if (current === loadRequest.current) {
          setBusy(null);
          setError("errorDownload");
        }
        stop();
        return;
      }
      stop();
    }
    if (current !== loadRequest.current) return;
    try {
      if (status?.supported && status.modelId !== choice.modelId)
        await runEnvironmentSpeech(selectEnvironmentSpeechModel(prepared, choice.modelId));
    } catch {
      setBusy(null);
      setError("errorSwitch");
      return;
    }
    chooseAudioDestination({ kind: "environment", environmentId });
    setEngine("local");
    setBusy(null);
    finish(request.start);
  });

  const startBrowser = useStableCallback(async () => {
    await updateClientSettings({ speechLanguage: language, voiceShortcutMode: mode });
    setEngine("browser");
    finish(request.start);
  });

  const cancelDownload = useStableCallback(async () => {
    loadRequest.current += 1;
    setBusy(null);
    if (prepared)
      await runEnvironmentSpeech(
        cancelEnvironmentSpeechModelDownload(prepared, choice.modelId),
      ).catch(() => undefined);
  });

  const where = local ? t.whereLocal : t.whereRemote(environment?.label ?? t.yourComputer);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <WizardPopup>
        <WizardHeader title={t.title} description={t.description} />
        <WizardPanel>
          <div className="space-y-5 text-sm">
            <section className="space-y-2" aria-label={t.languageLabel}>
              <h3 className="font-medium">{t.languageHeading}</h3>
              <div
                role="radiogroup"
                aria-label={t.languageLabel}
                className="grid grid-cols-3 gap-2"
              >
                {ZEN_VOICE_LANGUAGES.map((option) => (
                  <Choice
                    key={option.id}
                    selected={language === option.id}
                    disabled={busy !== null}
                    className="text-center"
                    onSelect={() => {
                      setLanguage(option.id);
                      setSize(
                        recommendZenVoiceSize({
                          language: option.id,
                          installedModelIds: models
                            .filter((candidate) => candidate.state === "installed")
                            .map((candidate) => candidate.id),
                        }),
                      );
                    }}
                  >
                    {t.languages[option.id]}
                  </Choice>
                ))}
              </div>
            </section>

            {supported ? (
              <section className="space-y-2" aria-label={t.qualityLabel}>
                <h3 className="font-medium">{t.qualityLabel}</h3>
                <div
                  role="radiogroup"
                  aria-label={t.qualityLabel}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {ZEN_VOICE_MODEL_CHOICES.map((option) => {
                    const entry = models.find((candidate) => candidate.id === option.modelId);
                    const recommended =
                      option.size === recommendZenVoiceSize({ language, installedModelIds: [] });
                    return (
                      <Choice
                        key={option.size}
                        selected={size === option.size}
                        disabled={busy !== null}
                        onSelect={() => setSize(option.size)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{t.sizes[option.size].label}</span>
                          <span className="text-xs text-muted-foreground">
                            {entry?.state === "installed" ? (
                              <span className="inline-flex items-center gap-1 text-primary">
                                <CheckIcon className="size-3" /> {t.installed}
                              </span>
                            ) : (
                              t.megabytes(option.megabytes)
                            )}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t.sizes[option.size].detail}
                        </span>
                        {recommended ? (
                          <span className="mt-1 block text-xs font-medium text-primary">
                            {t.recommended}
                          </span>
                        ) : null}
                      </Choice>
                    );
                  })}
                </div>
              </section>
            ) : status && !status.supported ? (
              <p role="alert" className="rounded-lg border border-border/70 p-3">
                {t.unsupported(status.reason)}
                {webSpeech ? t.unsupportedBrowserHint : ""}
              </p>
            ) : null}

            <section className="space-y-2" aria-label={t.howToTalk}>
              <h3 className="font-medium">{t.howToTalk}</h3>
              <div role="radiogroup" aria-label={t.howToTalk} className="grid gap-2 sm:grid-cols-2">
                <Choice
                  selected={mode === "toggle"}
                  disabled={busy !== null}
                  onSelect={() => setMode("toggle")}
                >
                  <span className="font-medium">{t.toggleTitle}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t.toggleDetail(shortcut)}
                  </span>
                </Choice>
                <Choice
                  selected={mode === "hold"}
                  disabled={busy !== null}
                  onSelect={() => setMode("hold")}
                >
                  <span className="font-medium">{t.holdTitle}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t.holdDetail(shortcut)}
                  </span>
                </Choice>
              </div>
            </section>

            {supported ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {where} {t.cloudOff}
                </span>
              </p>
            ) : null}

            {busy === "download" ? (
              <div role="status" className="space-y-1 text-muted-foreground">
                <div
                  role="progressbar"
                  aria-label={t.progressLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${percent ?? 0}%` }}
                  />
                </div>
                <p className="text-xs">
                  {model?.state === "verifying"
                    ? t.verifying
                    : percent === null
                      ? t.startingDownload(choice.megabytes)
                      : t.downloading(t.sizes[choice.size].label, percent)}
                </p>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-destructive">
                {t[error]}
              </p>
            ) : null}

            {webSpeech && busy === null ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <GlobeIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => void startBrowser()}
                  >
                    {t.useBrowser}
                  </button>
                  {t.useBrowserNote}
                </span>
              </p>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter
          leading={
            <Button
              variant="ghost-muted"
              onClick={() => {
                close();
                void navigate({ to: "/settings/voice" });
              }}
            >
              {t.moreOptions}
            </Button>
          }
        >
          {busy === "download" ? (
            <Button variant="outline" onClick={() => void cancelDownload()}>
              {t.cancelDownload}
            </Button>
          ) : (
            <Button variant="outline" onClick={close}>
              {t.notNow}
            </Button>
          )}
          <Button
            disabled={!supported || busy !== null || (!installed && !canManage)}
            onClick={() => void startLocal()}
          >
            <MicIcon />
            {busy === "download"
              ? t.downloadingButton
              : installed
                ? t.startDictating
                : canManage
                  ? t.downloadAndStart(choice.megabytes)
                  : t.askAdmin}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
