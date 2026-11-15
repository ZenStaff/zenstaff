import { describe, expect, it } from "vite-plus/test";

import catalog from "../../../../server/src/speech/catalog.json";
import {
  ZEN_VOICE_MODEL_CHOICES,
  downloadPercent,
  isLocalTranscriptionHost,
  recommendZenVoiceSize,
  resolveZenVoiceEngine,
  webSpeechLocale,
  zenVoiceLanguageFromSetting,
  zenVoiceModeFromSetting,
  zenVoiceSizeOfModel,
  zenSetupAvailable,
} from "./zenVoiceModel";

describe("model choices", () => {
  it("offers tiny, base, small and the Romanian pick, all in upstream's catalog with Romanian", () => {
    expect(ZEN_VOICE_MODEL_CHOICES.map((choice) => choice.size)).toEqual([
      "tiny",
      "base",
      "small",
      "best",
    ]);
    for (const choice of ZEN_VOICE_MODEL_CHOICES) {
      const entry = catalog.models.find((model) => model.id === choice.modelId);
      expect(entry, choice.modelId).toBeDefined();
      expect(entry!.languages).toContain("ro");
      expect(entry!.languages).toContain("en");
      // The size shown in the dialog matches the real download within 5%.
      expect(
        Math.abs(entry!.size / 1024 / 1024 - choice.megabytes) / choice.megabytes,
      ).toBeLessThan(0.08);
    }
  });

  it("maps model ids back to sizes and ignores models picked elsewhere", () => {
    expect(zenVoiceSizeOfModel("handy-computer/whisper-small-gguf")).toBe("small");
    expect(zenVoiceSizeOfModel("handy-computer/parakeet-unified-en-0.6b-gguf")).toBeNull();
    expect(zenVoiceSizeOfModel(null)).toBeNull();
  });
});

describe("settings", () => {
  it("reads the language setting as one of the three simple choices", () => {
    expect(zenVoiceLanguageFromSetting("ro")).toBe("ro");
    expect(zenVoiceLanguageFromSetting("en")).toBe("en");
    expect(zenVoiceLanguageFromSetting("auto")).toBe("auto");
    expect(zenVoiceLanguageFromSetting("de")).toBe("auto");
  });

  it("reads upstream's shortcut mode as toggle unless it is hold", () => {
    expect(zenVoiceModeFromSetting("hold")).toBe("hold");
    expect(zenVoiceModeFromSetting("toggle")).toBe("toggle");
    expect(zenVoiceModeFromSetting("auto")).toBe("toggle");
  });

  it("keeps the browser engine behind any destination chosen in Settings → Voice", () => {
    const base = { webSpeechAvailable: true } as const;
    expect(resolveZenVoiceEngine({ ...base, preferred: "browser", hasUpstreamGrant: false })).toBe(
      "browser",
    );
    expect(resolveZenVoiceEngine({ ...base, preferred: "browser", hasUpstreamGrant: true })).toBe(
      "local",
    );
    expect(
      resolveZenVoiceEngine({
        preferred: "browser",
        hasUpstreamGrant: false,
        webSpeechAvailable: false,
      }),
    ).toBe("local");
    expect(resolveZenVoiceEngine({ ...base, preferred: "local", hasUpstreamGrant: false })).toBe(
      "local",
    );
  });
});

describe("language selection", () => {
  it("recommends the accurate model for Romanian and Auto, a small one for English", () => {
    expect(recommendZenVoiceSize({ language: "ro" })).toBe("best");
    expect(recommendZenVoiceSize({ language: "auto" })).toBe("best");
    expect(recommendZenVoiceSize({ language: "en" })).toBe("base");
  });

  it("prefers a size that is already installed and selected", () => {
    expect(
      recommendZenVoiceSize({
        language: "ro",
        installedModelIds: ["handy-computer/whisper-small-gguf"],
        selectedModelId: "handy-computer/whisper-small-gguf",
      }),
    ).toBe("small");
    expect(
      recommendZenVoiceSize({
        language: "en",
        installedModelIds: [
          "handy-computer/whisper-tiny-gguf",
          "handy-computer/whisper-small-gguf",
        ],
      }),
    ).toBe("small");
    // Selected but not installed (upstream's default) does not count.
    expect(
      recommendZenVoiceSize({
        language: "en",
        installedModelIds: [],
        selectedModelId: "handy-computer/whisper-tiny-gguf",
      }),
    ).toBe("base");
  });

  it("gives Web Speech one locale, picking Romanian or English from browser languages for Auto", () => {
    expect(webSpeechLocale("ro", ["en-US"])).toBe("ro-RO");
    expect(webSpeechLocale("en", ["ro-RO"])).toBe("en-US");
    expect(webSpeechLocale("auto", ["ro-RO", "en-US"])).toBe("ro-RO");
    expect(webSpeechLocale("auto", ["de-DE", "en-GB", "ro"])).toBe("en-GB");
    expect(webSpeechLocale("auto", ["ro"])).toBe("ro-RO");
    expect(webSpeechLocale("auto", ["de-DE"])).toBe("en-US");
    expect(webSpeechLocale("auto", [])).toBe("en-US");
    expect(webSpeechLocale("fr", [])).toBe("fr");
  });
});

describe("where audio goes", () => {
  it("treats loopback hosts as this computer", () => {
    expect(isLocalTranscriptionHost("http://127.0.0.1:3873/")).toBe(true);
    expect(isLocalTranscriptionHost("http://localhost:3873")).toBe(true);
    expect(isLocalTranscriptionHost("http://[::1]:3873")).toBe(true);
    expect(isLocalTranscriptionHost("http://zen.localhost")).toBe(true);
    expect(isLocalTranscriptionHost("https://zen.example.ro")).toBe(false);
    expect(isLocalTranscriptionHost("http://100.64.0.2:3873")).toBe(false);
    expect(isLocalTranscriptionHost(null)).toBe(false);
    expect(isLocalTranscriptionHost("not a url")).toBe(false);
  });

  it("reports download progress in percent", () => {
    expect(downloadPercent({ size: 200, downloaded: 50 })).toBe(25);
    expect(downloadPercent({ size: 200 })).toBeNull();
    expect(downloadPercent({ size: 200, downloaded: 500 })).toBe(100);
    expect(downloadPercent({ size: 200, state: "installed" })).toBe(100);
  });
});

describe("quick setup in other editors", () => {
  it("shows the mic where upstream hid it, when audio can be captured", () => {
    expect(zenSetupAvailable(false, true)).toBe(true);
    expect(zenSetupAvailable(false, false)).toBe(false);
    expect(zenSetupAvailable(true, false)).toBe(true);
  });
});
