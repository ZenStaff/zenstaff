import {
  buildWorkflowMessage,
  localizeRegistryEntry,
  localizeWorkflowManifest,
  type ZenWorkflowManifest,
} from "@t3tools/contracts/zenOffice";
import { describe, expect, it } from "vite-plus/test";

import { CATEGORY_TEXT, localizeWorkflowProblem, officeText } from "../office/office.i18n";
import { translateUpstreamText, upstreamRewriteLocale } from "./upstreamText";
import {
  countLabel,
  defineZenMessages,
  detectZenLocale,
  resolveZenLocale,
  zenMessagesFor,
} from "./zenI18n";

describe("locale", () => {
  it("follows the browser's first supported language", () => {
    expect(detectZenLocale(["ro-RO", "en-US"])).toBe("ro");
    expect(detectZenLocale(["de-DE", "ro"])).toBe("ro");
    expect(detectZenLocale(["fr-FR", "de"])).toBe("en");
    expect(detectZenLocale([])).toBe("en");
    // A Windows in English with Romanian second, or set to Romania's time zone, starts in Romanian.
    expect(detectZenLocale(["en-US", "ro"])).toBe("ro");
    expect(detectZenLocale(["en-US"], "Europe/Bucharest")).toBe("ro");
    expect(detectZenLocale(["en-US"], "Europe/Chisinau")).toBe("ro");
    expect(detectZenLocale(["en-US"], "Europe/Berlin")).toBe("en");
  });

  it("lets the Settings override win over the browser", () => {
    expect(resolveZenLocale("en", ["ro-RO"])).toBe("en");
    expect(resolveZenLocale("auto", ["ro-RO"])).toBe("ro");
  });
});

describe("dictionaries", () => {
  it("falls back to English key by key when a translation is missing", () => {
    const catalog = defineZenMessages({
      en: { hello: "Hello", bye: "Bye", count: (n: number) => `${n} files` },
      ro: { hello: "Salut", bye: "", count: (n: number) => `${n} fișiere` },
    });
    const ro = zenMessagesFor(catalog, "ro");
    expect(ro.hello).toBe("Salut");
    expect(ro.bye).toBe("Bye");
    expect(ro.count(3)).toBe("3 fișiere");
    const partial = { en: catalog.en, ro: { hello: "Salut" } } as unknown as typeof catalog;
    expect(zenMessagesFor(partial, "ro").count(2)).toBe("2 files");
    expect(zenMessagesFor(catalog, "en")).toBe(catalog.en);
  });

  it("has every Office string in Romanian, with comma-below diacritics", () => {
    const ro = zenMessagesFor(officeText, "ro");
    for (const [key, value] of Object.entries(officeText.ro)) {
      expect(value, key).toBeTruthy();
      expect(JSON.stringify(value) + String(value), key).not.toMatch(/[şţŞŢ]/);
    }
    expect(ro.homeQuestion).toBe("Ce vrei să faci azi?");
    expect(zenMessagesFor(CATEGORY_TEXT, "ro").social).toBe("Rețele sociale");
  });

  it("counts like a Romanian speaker", () => {
    const files = { one: "fișier", other: "fișiere" };
    expect(countLabel("ro", 1, files)).toBe("1 fișier");
    expect(countLabel("ro", 3, files)).toBe("3 fișiere");
    expect(countLabel("ro", 20, files)).toBe("20 de fișiere");
    expect(countLabel("ro", 101, files)).toBe("101 fișiere");
    expect(countLabel("ro", 120, files)).toBe("120 de fișiere");
    expect(countLabel("en", 20, { one: "file", other: "files" })).toBe("20 files");
  });

  it("translates editor validation problems", () => {
    expect(localizeWorkflowProblem("Give the workflow a name.", "ro")).toBe("Dă un nume sarcinii.");
    expect(localizeWorkflowProblem('Two inputs use the id "x".', "ro")).toBe(
      "Două întrebări au același cod, „x”.",
    );
    expect(localizeWorkflowProblem("Something new.", "ro")).toBe("Something new.");
  });
});

describe("upstream text in Office", () => {
  it("rewrites whole strings only, keeping surrounding spaces", () => {
    expect(translateUpstreamText("Settings", "ro")).toBe("Setări");
    expect(translateUpstreamText("  Projects ", "en")).toBe("  Folders ");
    expect(translateUpstreamText("Settings", "en")).toBeNull();
    expect(translateUpstreamText("Open the Settings page", "ro")).toBeNull();
    expect(translateUpstreamText("Worked for 57s", "ro")).toBe("Am lucrat 57s");
    expect(translateUpstreamText("Worked for 57s", "en")).toBeNull();
  });

  it("translates upstream text in Code too when the app speaks Romanian", () => {
    expect(upstreamRewriteLocale("office", "ro")).toBe("ro");
    expect(upstreamRewriteLocale("office", "en")).toBe("en");
    // Code in Romanian: the sidebar's "Settled" shelf was still English.
    expect(upstreamRewriteLocale("code", "ro")).toBe("ro");
    expect(translateUpstreamText("Settled", upstreamRewriteLocale("code", "ro")!)).toBe(
      "Terminate",
    );
    // Code in English keeps upstream's developer wording.
    expect(upstreamRewriteLocale("code", "en")).toBeNull();
  });
});

const manifest: ZenWorkflowManifest = {
  id: "press-release",
  name: "Press release",
  description: "A release.",
  category: "pr",
  icon: "newspaper",
  output: "press-release.md",
  version: "1.0.0",
  author: "Zen Staff",
  inputs: [
    { id: "news", label: "What is the news?", type: "longtext", required: true },
    { id: "tone", label: "Tone", type: "select", required: true, options: ["Friendly", "Formal"] },
  ],
  i18n: {
    ro: {
      name: "Comunicat de presă",
      inputs: {
        news: { label: "Care e vestea?" },
        tone: { label: "Ton", options: ["Prietenos", "Oficial"] },
      },
    },
  },
};

describe("workflow translations", () => {
  it("localizes visible text and falls back to the source", () => {
    const ro = localizeWorkflowManifest(manifest, "ro");
    expect(ro.name).toBe("Comunicat de presă");
    expect(ro.description).toBe("A release.");
    expect(ro.inputs[0]!.label).toBe("Care e vestea?");
    expect(ro.inputs[1]!.options).toEqual(["Prietenos", "Oficial"]);
    expect(localizeWorkflowManifest(manifest, "de")).toBe(manifest);
  });

  it("ignores option translations of the wrong length", () => {
    const broken = {
      ...manifest,
      i18n: { ro: { inputs: { tone: { options: ["Doar una"] } } } },
    };
    expect(localizeWorkflowManifest(broken, "ro").inputs[1]!.options).toEqual([
      "Friendly",
      "Formal",
    ]);
  });

  it("localizes marketplace entries", () => {
    const entry = { name: "Job ad", description: "An ad.", i18n: { ro: { name: "Anunț" } } };
    expect(localizeRegistryEntry(entry, "ro")).toMatchObject({
      name: "Anunț",
      description: "An ad.",
    });
  });

  it("tells the agent to answer in the person's language and opens with their answers", () => {
    const text = buildWorkflowMessage(
      { prompt: "Write about {{news}}.", skill: null },
      { news: "a new shop" },
      {
        locale: "ro",
        summary: {
          title: "Comunicat de presă",
          answers: [{ label: "Care e vestea?", value: "a new shop" }],
        },
      },
    );
    expect(text.startsWith("Comunicat de presă\n\nCare e vestea? a new shop")).toBe(true);
    expect(text).toContain("Write about a new shop.");
    expect(text).toContain("Always answer them in Romanian");
  });
});

describe("Office wording for scheduled tasks and voice counts", () => {
  it("translates schedule labels and the next-run time", async () => {
    const { translateUpstreamText } = await import("./upstreamText");
    expect(translateUpstreamText("Mon at 09:00 ·", "ro")).toBe("luni la 09:00 ·");
    expect(translateUpstreamText("Daily at 7:30", "ro")).toBe("Zilnic la 7:30");
    expect(translateUpstreamText("in 1d", "ro")).toBe("în 1d");
    expect(translateUpstreamText("entries", "ro")).toBe("intrări");
    expect(translateUpstreamText("This command requires approval", "ro")).toBe(
      "Pasul ăsta are nevoie de acordul tău",
    );
  });
});
