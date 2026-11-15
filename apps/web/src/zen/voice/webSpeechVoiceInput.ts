// Browser fallback: the Web Speech API as a recorder + transcriber for upstream's
// VoiceInputController, so insertion, stale-draft checks and the composer pill are upstream's.
import {
  VoiceTranscriptionError,
  type VoiceRecorder,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import type { SpeechStreamText } from "@t3tools/contracts";

/** The subset of `SpeechRecognition` used here (Chrome/Edge ship it as `webkitSpeechRecognition`). */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly 0: { readonly transcript: string };
  }>;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

export function webSpeechRecognitionConstructor(
  scope: unknown = globalThis,
): RecognitionConstructor | null {
  const candidate = scope as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/** Joins final and interim results the way they read on screen. */
export function joinRecognitionResults(event: SpeechRecognitionEventLike): SpeechStreamText {
  const committed: string[] = [];
  const tentative: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index]!;
    const text = result[0].transcript.trim();
    if (!text) continue;
    (result.isFinal ? committed : tentative).push(text);
  }
  return { committed: committed.join(" "), tentative: tentative.join(" ") };
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the browser and try again.",
  "service-not-allowed": "This browser does not allow speech recognition here.",
  "audio-capture": "No microphone was found.",
  network: "The browser's speech service could not be reached. Check the connection.",
  "language-not-supported": "The browser cannot recognize this language.",
};

export function webSpeechErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Browser speech recognition failed.";
}

/**
 * One recording at a time. `prepare` binds the locale; `record` starts recognition; `stop` ends
 * it and the streaming `finish` resolves with every final result (plus a last interim one, which
 * Chrome sometimes never finalizes when stopped mid-phrase).
 */
export function createWebSpeechVoiceInput(input: {
  readonly Recognition: RecognitionConstructor;
  readonly getLocale: () => string;
  readonly onText?: (text: SpeechStreamText) => void;
  /** Recognition stopped by itself (long silence, service limit): the caller finishes the recording. */
  readonly onEnded?: () => void;
}) {
  let recognition: SpeechRecognitionLike | null = null;
  let latest: SpeechStreamText = { committed: "", tentative: "" };
  let failure: string | null = null;
  let ended: Promise<void> = Promise.resolve();

  const recorder: VoiceRecorder = {
    uri: null,
    async prepareToRecordAsync() {
      recognition?.abort();
      latest = { committed: "", tentative: "" };
      failure = null;
      const current = new input.Recognition();
      current.lang = input.getLocale();
      current.continuous = true;
      current.interimResults = true;
      current.onresult = (event) => {
        latest = joinRecognitionResults(event);
        input.onText?.(latest);
      };
      current.onerror = (event) => {
        // "no-speech" and "aborted" just mean an empty transcript.
        if (event.error !== "no-speech" && event.error !== "aborted") failure = event.error;
      };
      ended = new Promise((resolve) => {
        current.onend = () => {
          resolve();
          if (recognition === current) input.onEnded?.();
        };
      });
      recognition = current;
    },
    record() {
      recognition?.start();
    },
    async stop() {
      recognition?.stop();
      await ended;
    },
  };

  const transcriber: VoiceTranscriber = {
    prepare: async () => ({
      locale: input.getLocale(),
      transcribe: async () => {
        throw new VoiceTranscriptionError({
          code: "transcription-failed",
          message: "Browser speech recognition has no recording to retry.",
        });
      },
      streaming: {
        finish: async ({ signal }) => {
          await ended;
          if (signal.aborted)
            throw new VoiceTranscriptionError({ code: "cancelled", message: "Cancelled." });
          const text = [latest.committed, latest.tentative].filter(Boolean).join(" ");
          if (failure && !text)
            throw new VoiceTranscriptionError({
              code: "transcription-failed",
              message: webSpeechErrorMessage(failure),
            });
          return text;
        },
      },
    }),
  };

  return {
    recorder,
    transcriber,
    cancel: async () => {
      recognition?.abort();
      await ended;
    },
  };
}
