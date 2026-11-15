// Opt-in (downloads models, runs native inference): ZEN_VOICE_E2E=1, optional ZEN_VOICE_E2E_HOME
// (a Zen home whose models to reuse) and ZEN_VOICE_E2E_MODELS (comma list of catalog names).
// Feeds Piper TTS fixtures (ro, en; 16 kHz WAV) as the Float32 PCM the web client uploads to
// SpeechService.transcribe, the call behind POST /api/voice/transcribe.
import * as NodeOS from "node:os";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as SpeechModelStore from "../../speech/SpeechModelStore.ts";
import * as SpeechService from "../../speech/SpeechService.ts";

const enabled = process.env.ZEN_VOICE_E2E === "1";
const home = process.env.ZEN_VOICE_E2E_HOME ?? `${NodeOS.homedir()}/.cache/zen-voice-e2e`;
const models = (process.env.ZEN_VOICE_E2E_MODELS ?? "whisper-tiny-gguf,parakeet-tdt-0.6b-v3-gguf")
  .split(",")
  .map((name) => `handy-computer/${name.trim()}`);

/** 16-bit PCM WAV to the little-endian Float32 bytes the browser capture uploads. */
function wavToFloat32Pcm(bytes: Uint8Array): Uint8Array {
  const wav = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = wav.getUint32(offset + 4, true);
    if (id === "data") {
      const samples = new Float32Array(size / 2);
      for (let index = 0; index < samples.length; index += 1)
        samples[index] = wav.getInt16(offset + 8 + index * 2, true) / 32768;
      return new Uint8Array(samples.buffer);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

const fixture = Effect.fn(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return wavToFloat32Pcm(yield* fs.readFile(path.join(import.meta.dirname, "fixtures", name)));
});

const speechLayer = (modelId: string) =>
  SpeechService.layer.pipe(
    Layer.provide(SpeechModelStore.layer),
    Layer.provide(ServerSettings.layerTest({ speechModelId: modelId })),
    Layer.provide(ServerConfig.layerTest(process.cwd(), home)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const normalize = (text: string) => text.toLocaleLowerCase("ro").normalize("NFC");

describe.skipIf(!enabled)("local dictation end to end", () => {
  it.each(models)("transcribes Romanian and English with %s", async (modelId) => {
    const results = await Effect.gen(function* () {
      const speech = yield* SpeechService.SpeechService;
      yield* speech.downloadModel(modelId);
      const run = (name: string, speechLanguage: string) =>
        fixture(name).pipe(
          Effect.flatMap((pcm) =>
            speech.transcribe(pcm, { ...DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS, speechLanguage }),
          ),
        );
      const transcripts = {
        ro: yield* run("voice-ro.wav", "ro"),
        en: yield* run("voice-en.wav", "en"),
        auto: yield* run("voice-ro.wav", "auto"),
      };
      yield* Effect.logInfo(`${modelId} ${JSON.stringify(transcripts)}`);
      return transcripts;
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(speechLayer(modelId), NodeServices.layer)),
      Effect.runPromise,
    );

    expect(normalize(results.en)).toContain("report");
    expect(normalize(results.en)).toContain("friday");
    // Every size stays in Romanian (no translation to English) and keeps common words;
    // Whisper Tiny gets little else right, which is why the dialog says "weak for Romanian".
    for (const text of [results.ro, results.auto]) {
      expect(normalize(text)).toContain("pentru");
      expect(text).toMatch(/[ăâîșț]/);
    }
    if (!modelId.includes("whisper-tiny")) {
      expect(normalize(results.ro)).toContain("dimineață");
      expect(normalize(results.ro)).toMatch(/ofert|clientul/);
    }
  });
});
