// @effect-diagnostics nodeBuiltinImport:off -- Plain unit test that loads the packs' voice-preview.mjs copies from disk.
// The local Piper voice is a preview only: every voice pack labels it in file names, reports and
// replies, and offers the way to a professional voice (the person's own ElevenLabs).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const here = import.meta.dirname;
const copies = [
  NodePath.join(here, "packs", "app-tutorial-video", "voice-preview.mjs"),
  NodePath.join(here, "packs", "promo-video-30s", "template", "voice-preview.mjs"),
  NodePath.join(here, "packs", "social-reels-kit", "template", "voice-preview.mjs"),
];
const VOICE_PACKS = ["app-tutorial-video", "promo-video-30s", "social-reels-kit"];

interface VoicePreviewModule {
  readonly PREVIEW_VOICE_SUFFIX: string;
  readonly previewFileName: (path: string) => string;
  readonly aiVoiceLabel: (language: string) => string;
  readonly resolveVoice: (
    requested: string,
    env: Record<string, string | undefined>,
  ) => { voice: string; fellBack: boolean };
  readonly voiceReportLines: (voice: string, language: string, fellBack?: boolean) => string[];
}

const load = async (file: string) => (await import(file)) as VoicePreviewModule;

describe("voice packs: the local voice is a preview", () => {
  it("every pack carries the same rules", () => {
    const [first, ...rest] = copies.map((file) => NodeFS.readFileSync(file, "utf8"));
    for (const other of rest) expect(other).toBe(first);
  });

  it("uses the professional voice only when the person's ElevenLabs is connected", async () => {
    const voice = await load(copies[0]!);
    expect(voice.resolveVoice("elevenlabs", { ELEVENLABS_API_KEY: "k" })).toEqual({
      voice: "elevenlabs",
      fellBack: false,
    });
    expect(voice.resolveVoice("elevenlabs", {})).toEqual({ voice: "preview", fellBack: true });
    expect(voice.resolveVoice("preview", { ELEVENLABS_API_KEY: "k" })).toEqual({
      voice: "preview",
      fellBack: false,
    });
    expect(voice.resolveVoice("none", {})).toEqual({ voice: "none", fellBack: false });
  });

  it("marks preview files and says so in Romanian and English, with the redo path", async () => {
    const voice = await load(copies[0]!);
    expect(voice.previewFileName("tutorial/rezervare.mp4")).toBe(
      "tutorial/rezervare-preview-voice.mp4",
    );
    expect(voice.previewFileName("a-preview-voice.mp4")).toBe("a-preview-voice.mp4");
    const ro = voice.voiceReportLines("preview", "ro", true).join("\n");
    expect(ro).toContain("PREVIZUALIZARE LOCALĂ");
    expect(ro).toContain("niciodată pentru reclame");
    expect(ro).toContain("Refă cu voce profesională");
    expect(ro).toContain("ElevenLabs nu e conectat");
    expect(ro).not.toMatch(/[şţŞŢ]/);
    const en = voice.voiceReportLines("preview", "en").join("\n");
    expect(en).toContain("LOCAL PREVIEW");
    expect(en).toContain("never for ads");
    expect(en).toContain("Redo with a professional voice");
    expect(voice.voiceReportLines("elevenlabs", "ro").join(" ")).toContain("Voce generată cu AI");
    expect(voice.voiceReportLines("elevenlabs", "en").join(" ")).not.toContain("PREVIEW");
    expect(voice.aiVoiceLabel("en")).toBe("AI-generated voice");
  });

  it("the scripts name preview files and put the notice in their final text", () => {
    const make = NodeFS.readFileSync(
      NodePath.join(here, "packs", "app-tutorial-video", "make.mjs"),
      "utf8",
    );
    expect(make).toContain("previewFileName(`${slug}.mp4`)");
    expect(make).toContain("## Voice");
    expect(make).toContain("voiceNotice: voiceLines");
    const render = NodeFS.readFileSync(
      NodePath.join(here, "packs", "promo-video-30s", "template", "render.mjs"),
      "utf8",
    );
    expect(render).toContain("out = previewFileName(out)");
    expect(render).toContain("voiceNotice: voiceLines");
    expect(render).toContain("props.aiVoiceLabel = aiVoiceLabel(voiceLanguage)");
    const reels = NodeFS.readFileSync(
      NodePath.join(here, "packs", "social-reels-kit", "template", "render.mjs"),
      "utf8",
    );
    expect(reels).toContain("previewFileName(`${reel.id}.mp4`)");
    expect(reels).toContain("voiceNotice: voiceLines");
    expect(reels).toContain("reel.aiVoiceLabel = aiVoiceLabel(voiceLanguage)");
    expect(reels).toContain("resolveVoice(requestedVoice, process.env)");
    for (const pack of VOICE_PACKS) {
      const skill = NodeFS.readFileSync(NodePath.join(here, "packs", pack, "SKILL.md"), "utf8");
      expect(skill, pack).toContain("Refă cu voce profesională");
      expect(skill, pack).toContain("never for ads");
      const prompt = NodeFS.readFileSync(NodePath.join(here, "packs", pack, "prompt.md"), "utf8");
      expect(prompt, pack).toContain("never presented as final");
    }
  });

  it("the forms offer the professional voice first and the preview as free and indicative", () => {
    for (const pack of VOICE_PACKS) {
      const manifest = JSON.parse(
        NodeFS.readFileSync(NodePath.join(here, "packs", pack, "workflow.json"), "utf8"),
      );
      const ro = manifest.i18n.ro.inputs.voice.options as string[];
      expect(ro[0], pack).toBe("Voce profesională (recomandat)");
      expect(ro[1], pack).toMatch(/^Previzualizare locală \(gratuit, doar orientativ/);
    }
  });
});
