// Wraps upstream's composer dictation hook and returns its shape: with no destination chosen,
// the mic opens Zen's simple setup instead of Settings → Voice; with browser dictation chosen
// on this device (and no destination), Web Speech records through upstream's controller.
import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import type { SpeechStreamText } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { isElectron } from "~/env";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useClientSettings } from "~/hooks/useSettings";
import {
  useEnvironmentSpeechInput,
  useVoiceTranscriptionDestination,
} from "~/speech/useEnvironmentSpeechInput";
import { createWebSpeechVoiceInput, webSpeechRecognitionConstructor } from "./webSpeechVoiceInput";
import { resolveZenVoiceEngine, webSpeechLocale, zenSetupAvailable } from "./zenVoiceModel";
import { useZenVoiceStore } from "./zenVoiceState";

type SpeechInput = Parameters<typeof useEnvironmentSpeechInput>[0];
const IDLE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/** Web Speech in Electron has no speech service key and always fails, so it is browser-only. */
export function browserDictationConstructor() {
  return isElectron || typeof window === "undefined" ? null : webSpeechRecognitionConstructor();
}

function microphoneCaptureAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioWorkletNode !== "undefined"
  );
}

function useWebSpeechInput(input: SpeechInput, enabled: boolean) {
  const speechLanguage = useClientSettings((settings) => settings.speechLanguage);
  const [state, setState] = useState<VoiceInputState>(IDLE);
  const [preview, setPreview] = useState<SpeechStreamText | null>(null);
  const controllerRef = useRef<VoiceInputController | null>(null);
  const latestRef = useRef({ input, speechLanguage });
  const pendingSubmitRef = useRef<{ submit: (text: string) => void; text?: string } | null>(null);
  // Revisions are compared between two reads of the draft, so the starting text does not matter.
  const revisionRef = useRef({ text: "", revision: 0 });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes committed props to the asynchronous browser recognition controller
  useEffect(() => {
    latestRef.current = { input, speechLanguage };
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the browser recognition controller while browser dictation is the engine
  useEffect(() => {
    const Recognition = enabled ? browserDictationConstructor() : null;
    if (!Recognition) return;
    let disposed = false;
    let controller: VoiceInputController;
    const platform = createWebSpeechVoiceInput({
      Recognition,
      getLocale: () =>
        webSpeechLocale(latestRef.current.speechLanguage, globalThis.navigator?.languages ?? []),
      onText: (text) => {
        if (!disposed) setPreview(text);
      },
      onEnded: () => {
        if (!disposed) void controller.stop();
      },
    });
    controller = new VoiceInputController({
      recorder: platform.recorder,
      getTranscriber: () => platform.transcriber,
      requestPermission: async () => ({ granted: true, canAskAgain: true }),
      configureRecording: async () => undefined,
      releaseRecording: () => platform.cancel(),
      deleteRecording: () => undefined,
      readDraft: () => {
        const current = latestRef.current.input;
        const draft = current.readDraft();
        if (draft.text !== revisionRef.current.text)
          revisionRef.current = { text: draft.text, revision: revisionRef.current.revision + 1 };
        return {
          ownerKey: current.ownerKey,
          text: draft.text,
          selection: draft.selection,
          revision: revisionRef.current.revision,
        };
      },
      commitDraft: (text, selection) => {
        if (latestRef.current.input.disabled) return;
        latestRef.current.input.commitDraft(text, selection);
        if (pendingSubmitRef.current) pendingSubmitRef.current.text = text;
      },
      onStateChange: (value) => {
        if (disposed) return;
        if (value.phase === "error") pendingSubmitRef.current = null;
        setState(value);
        if (value.phase !== "recording" && value.phase !== "transcribing") setPreview(null);
      },
    });
    controllerRef.current = controller;
    return () => {
      disposed = true;
      pendingSubmitRef.current = null;
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      setState(IDLE);
      setPreview(null);
    };
  }, [enabled]);

  const previousOwnerRef = useRef({ key: input.ownerKey, disabled: input.disabled });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- abandons the recording when the draft's owner changes or the composer is disabled
  useEffect(() => {
    const previous = previousOwnerRef.current;
    if (previous.key === input.ownerKey && previous.disabled === input.disabled) return;
    previousOwnerRef.current = { key: input.ownerKey, disabled: input.disabled };
    pendingSubmitRef.current = null;
    controllerRef.current?.ownerChanged();
  }, [input.ownerKey, input.disabled]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends a queued message only after the transcript has been inserted
  useEffect(() => {
    const pending = pendingSubmitRef.current;
    if (state.phase !== "idle" || !pending) return;
    pendingSubmitRef.current = null;
    if (!input.disabled && pending.text !== undefined) pending.submit(pending.text);
  }, [state, input.disabled]);

  return {
    state,
    preview: state.phase === "recording" || state.phase === "transcribing" ? preview : null,
    start: useStableCallback(async () => {
      if (latestRef.current.input.disabled) return;
      await controllerRef.current?.start();
    }),
    stop: useStableCallback(() => controllerRef.current?.stop() ?? Promise.resolve()),
    cancel: useStableCallback(() => {
      pendingSubmitRef.current = null;
      controllerRef.current?.cancel();
    }),
    submitAfterDictation: useStableCallback((submit: (text: string) => void) => {
      const controller = controllerRef.current;
      if (!controller || !voiceInputBlocksSubmission(state)) {
        submit(latestRef.current.input.readDraft().text);
        return;
      }
      if (pendingSubmitRef.current) return;
      pendingSubmitRef.current = { submit };
      if (controller.currentState.phase === "recording") void controller.stop();
    }),
  };
}

export function useZenSpeechInput(input: SpeechInput) {
  const upstream = useEnvironmentSpeechInput(input);
  const destination = useVoiceTranscriptionDestination();
  const preferred = useZenVoiceStore((store) => store.engine);
  const openSetup = useZenVoiceStore((store) => store.openSetup);
  const hasGrant = destination.grantId !== null;
  const engine = resolveZenVoiceEngine({
    preferred,
    hasUpstreamGrant: hasGrant,
    webSpeechAvailable: browserDictationConstructor() !== null,
  });
  const browser = useWebSpeechInput(input, engine === "browser");
  const offerSetup = !hasGrant && destination.offerFirstRunSetup === true;
  // After setup the dialog starts whichever engine this composer uses by then.
  const startAfterSetupRef = useRef<() => Promise<void>>(upstream.start);
  const startWithSetup = useStableCallback(async () => {
    if (input.disabled) return;
    openSetup({
      environmentId: input.environmentId,
      start: () => void startAfterSetupRef.current(),
    });
  });
  const resolveResult = () => {
    if (engine !== "browser") {
      // Zen's setup is a dialog, not a page, so the draft survives it: editors that hide
      // upstream's setup (offerSetup: false; PR comments, preview annotations) offer it too.
      return offerSetup
        ? {
            ...upstream,
            available: zenSetupAvailable(upstream.available, microphoneCaptureAvailable()),
            start: startWithSetup,
          }
        : upstream;
    }
    const blocks = voiceInputBlocksSubmission(browser.state);
    return {
      ...upstream,
      available: true,
      state: browser.state,
      preview: browser.preview,
      level: browser.state.phase === "recording" ? 0.35 : 0,
      preparing: browser.state.phase === "preparing",
      blocksSubmission: blocks,
      freezesEditor: blocks,
      start: browser.start,
      stop: browser.stop,
      cancel: browser.cancel,
      submitAfterDictation: browser.submitAfterDictation,
      skipPostProcessing: () => undefined,
    };
  };
  const result = resolveResult();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the current start action for the setup dialog's deferred start
  useEffect(() => {
    startAfterSetupRef.current = result.start === startWithSetup ? upstream.start : result.start;
  });
  return result;
}
