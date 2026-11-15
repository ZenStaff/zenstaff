// Drives the Web Speech fallback through upstream's VoiceInputController with a fake
// recognition, checking that the transcript lands in the draft the way the composer gets it.
import { VoiceInputController, type VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { describe, expect, it } from "vite-plus/test";

import {
  createWebSpeechVoiceInput,
  joinRecognitionResults,
  webSpeechErrorMessage,
  webSpeechRecognitionConstructor,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from "./webSpeechVoiceInput";

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    queueMicrotask(() => this.onend?.());
  }
  say(results: ReadonlyArray<{ text: string; final: boolean }>) {
    this.onresult?.({
      resultIndex: 0,
      results: results.map((result) => ({ isFinal: result.final, 0: { transcript: result.text } })),
    });
  }
}

function harness(initial: { text: string; caret: number }, locale = "ro-RO") {
  let draft = { text: initial.text, selection: { start: initial.caret, end: initial.caret } };
  const states: VoiceInputState["phase"][] = [];
  const previews: string[] = [];
  const waiters: Array<{ phase: VoiceInputState["phase"]; resolve: () => void }> = [];
  /** Resolves on the next transition into `phase`. */
  const next = (phase: VoiceInputState["phase"]) =>
    new Promise<void>((resolve) => waiters.push({ phase, resolve }));
  let controller!: VoiceInputController;
  const platform = createWebSpeechVoiceInput({
    Recognition: FakeRecognition,
    getLocale: () => locale,
    onText: (text) => previews.push(`${text.committed}|${text.tentative}`),
    onEnded: () => void controller.stop(),
  });
  controller = new VoiceInputController({
    recorder: platform.recorder,
    getTranscriber: () => platform.transcriber,
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    configureRecording: async () => undefined,
    releaseRecording: () => platform.cancel(),
    deleteRecording: () => undefined,
    readDraft: () => ({ ownerKey: "draft-1", ...draft, revision: 0 }),
    commitDraft: (text, selection) => {
      draft = { text, selection };
    },
    onStateChange: (state) => {
      states.push(state.phase);
      for (const waiter of waiters.splice(0))
        if (waiter.phase === state.phase) waiter.resolve();
        else waiters.push(waiter);
    },
  });
  return { controller, states, previews, next, draft: () => draft };
}

describe("Web Speech fallback", () => {
  it("records, then inserts the final transcript at the caret with word boundaries", async () => {
    const run = harness({ text: "Salut, te rog,", caret: 14 });
    await run.controller.start();
    const recognition = FakeRecognition.last!;
    expect(recognition.started).toBe(true);
    expect(recognition.lang).toBe("ro-RO");
    expect(recognition.continuous).toBe(true);
    expect(run.controller.currentState.phase).toBe("recording");

    recognition.say([
      { text: "pregătește oferta", final: true },
      { text: "pentru Cluj", final: false },
    ]);
    expect(run.previews.at(-1)).toBe("pregătește oferta|pentru Cluj");
    await run.controller.stop();

    expect(run.draft().text).toBe("Salut, te rog, pregătește oferta pentru Cluj");
    expect(run.draft().selection.start).toBe(run.draft().text.length);
    expect(run.states).toEqual(["preparing", "recording", "transcribing", "idle"]);
  });

  it("finishes by itself when the browser ends recognition after silence", async () => {
    const run = harness({ text: "", caret: 0 }, "en-US");
    await run.controller.start();
    FakeRecognition.last!.say([{ text: "Good morning", final: true }]);
    const idle = run.next("idle");
    FakeRecognition.last!.onend?.();
    await idle;
    expect(run.draft().text).toBe("Good morning");
    expect(run.controller.currentState.phase).toBe("idle");
  });

  it("leaves the draft unchanged when cancelled", async () => {
    const run = harness({ text: "keep me", caret: 7 });
    await run.controller.start();
    FakeRecognition.last!.say([{ text: "discard this", final: true }]);
    run.controller.cancel();
    expect(run.controller.currentState.phase).toBe("idle");
    expect(run.draft().text).toBe("keep me");
  });

  it("reports a blocked microphone instead of inserting nothing silently", async () => {
    const run = harness({ text: "", caret: 0 });
    await run.controller.start();
    FakeRecognition.last!.onerror?.({ error: "not-allowed" });
    await run.controller.stop();
    expect(run.controller.currentState).toMatchObject({
      phase: "error",
      error: webSpeechErrorMessage("not-allowed"),
    });
    expect(run.draft().text).toBe("");
  });

  it("joins results and finds the constructor under either name", () => {
    expect(
      joinRecognitionResults({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: " Bună ziua " } },
          { isFinal: true, 0: { transcript: "" } },
          { isFinal: false, 0: { transcript: "mâine" } },
        ],
      }),
    ).toEqual({ committed: "Bună ziua", tentative: "mâine" });
    expect(webSpeechRecognitionConstructor({ webkitSpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
    expect(webSpeechRecognitionConstructor({})).toBeNull();
  });
});
