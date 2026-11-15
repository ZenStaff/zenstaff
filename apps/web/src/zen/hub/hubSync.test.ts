import { describe, expect, it } from "vite-plus/test";

import { decidePreferenceSync } from "./HubSync";

describe("hub preference sync", () => {
  it("applies the person's hub edition and language when they differ", () => {
    expect(
      decidePreferenceSync({
        hub: { edition: "office", language: "ro" },
        local: { edition: "code", language: "en" },
      }),
    ).toEqual({ applyEdition: "office", applyLanguage: "ro" });
  });
  it("keeps the device's own choice when the hub has none", () => {
    expect(
      decidePreferenceSync({
        hub: { edition: null, language: null },
        local: { edition: "code", language: "auto" },
      }),
    ).toEqual({ applyEdition: null, applyLanguage: null });
  });
});
