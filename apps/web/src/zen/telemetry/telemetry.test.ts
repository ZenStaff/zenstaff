import {
  parseZenTelemetryReport,
  ZEN_TELEMETRY_ERROR_TYPES,
} from "@t3tools/contracts/zenTelemetry";
import { describe, expect, it } from "vite-plus/test";

import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
} from "../../components/settings/settingsSearch";
import { translateUpstreamText } from "../i18n/upstreamText";
import { telemetryText } from "./telemetry.i18n";
import { choiceInput, errorInput, workflowRunInput } from "./telemetryClient";

describe("anonymous statistics in the app", () => {
  it("the choice has two equal options and says what is and is not sent", () => {
    for (const locale of ["en", "ro"] as const) {
      const t = telemetryText[locale];
      expect(t.send).not.toBe(t.dontSend);
      // One plain sentence of what is counted, and what never is.
      expect(t.explain.split(". ").length).toBeLessThanOrEqual(2);
    }
    expect(telemetryText.ro.send).toBe("Trimite statistici anonime");
    expect(telemetryText.ro.dontSend).toBe("Nu trimite");
    expect(telemetryText.ro.explain).toMatch(/Niciodată ce scrii/);
    expect(telemetryText.en.explain).toMatch(/Never what you write/);
  });

  it("the app sends only closed values to its machine", () => {
    expect(choiceInput("on")).toMatchObject({ choice: "on" });
    expect(Object.keys(choiceInput("off")).toSorted()).toEqual(["choice", "edition", "locale"]);
    // A marketplace pack reports its pack id; a built-in its workflow id (the server maps ids
    // that are not ours to "other").
    expect(workflowRunInput({ packId: "horeca-kit", manifest: { id: "meniu" } })).toEqual({
      kind: "workflow",
      packId: "horeca-kit",
    });
    expect(workflowRunInput({ packId: null, manifest: { id: "press-release" } })).toEqual({
      kind: "workflow",
      packId: "press-release",
    });
    for (const type of ZEN_TELEMETRY_ERROR_TYPES)
      expect(errorInput(type)).toEqual({ kind: "error", type });
  });

  it("the report format refuses anything that is not a count", () => {
    const report = {
      v: 1,
      day: "2026-11-09",
      dailyId: "0123456789abcdef0123456789abcdef",
      version: "0.2.4",
      os: "win",
      arch: "x64",
      edition: "office",
      locale: "ro",
      counts: { chats: 1, messages: 2, approvals: 0, workflows: 1 },
      packs: { "horeca-kit": 1 },
      errors: {},
    };
    expect(parseZenTelemetryReport(report)).not.toBeNull();
    expect(parseZenTelemetryReport({ ...report, prompt: "hi" })).toBeNull();
    expect(parseZenTelemetryReport({ ...report, packs: { "SC Firma SRL": 1 } })).toBeNull();
    expect(parseZenTelemetryReport({ ...report, errors: { "C:\\Users\\alex": 1 } })).toBeNull();
  });

  it("Settings has a Privacy page, Confidențialitate in Romanian", () => {
    expect(SETTINGS_SECTION_LABELS["/settings/privacy"]).toBe("Privacy");
    expect(SETTINGS_NAV_GROUPS.flatMap((group) => group.paths)).toContain("/settings/privacy");
    expect(translateUpstreamText("Privacy", "ro")).toBe("Confidențialitate");
  });
});
