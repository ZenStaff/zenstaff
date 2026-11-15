import type {
  ZenChatAgent,
  ZenChatBinding,
  ZenChatConnectionView,
  ZenChatMember,
} from "@t3tools/contracts/zenChat";
import { describe, expect, it } from "vite-plus/test";

import { chatText } from "./chat.i18n";
import { platformGuide } from "./chatGuides.i18n";
import {
  groupBindingsByConnection,
  identityLabel,
  isChatTab,
  membersToImport,
  missingSecrets,
  parseList,
  postingAgents,
  reportTargets,
  scheduleLabel,
  stateTone,
  validateAgent,
  validateBinding,
  validateConnection,
  validateMember,
  validateReport,
  wizardStartStep,
} from "./chatModel";
import { zenMessagesFor } from "../i18n/zenI18n";
import { ZEN_CHAT_PLATFORMS } from "@t3tools/contracts/zenChat";

const connection = (overrides: Partial<ZenChatConnectionView> = {}): ZenChatConnectionView => ({
  id: "c1",
  platform: "slack",
  name: "Acme Slack",
  scope: "company",
  enabled: true,
  workspaceAllowlist: ["T1"],
  channelAllowlist: [],
  settings: { teamId: "T1" },
  secretsStored: { botToken: true, appToken: true },
  state: "connected",
  detail: null,
  lastEventAt: null,
  webhookUrl: null,
  ...overrides,
});

const agent = (overrides: Partial<ZenChatAgent> = {}): ZenChatAgent => ({
  id: "a1",
  name: "Ana",
  kind: "company",
  managerEmail: "boss@acme.example",
  ownerEmail: null,
  projectId: "p1",
  model: "claude-haiku-5-5",
  runtimeMode: "auto-accept-edits",
  instructions: "",
  ...overrides,
});

const binding = (overrides: Partial<ZenChatBinding> = {}): ZenChatBinding => ({
  id: "b1",
  connectionId: "c1",
  channelId: "C1",
  channelName: "#general",
  agentId: "a1",
  respondTo: "mention",
  posters: [],
  ...overrides,
});

describe("chat setup model", () => {
  it("parses lists and tabs", () => {
    expect(parseList("T1, T2\nT1  ;T3")).toEqual(["T1", "T2", "T3"]);
    expect(isChatTab("people")).toBe(true);
    expect(isChatTab("nope")).toBe(false);
  });

  it("validates connections, agents, bindings, members and reports", () => {
    expect(
      validateConnection({ platform: "slack", name: "", workspaceAllowlist: [], settings: {} }),
    ).toEqual(["name", "workspace", "setting"]);
    expect(
      validateConnection({
        platform: "telegram",
        name: "Bot",
        workspaceAllowlist: ["-100"],
        settings: { botUsername: "acme_bot" },
      }),
    ).toEqual([]);
    expect(validateAgent(agent())).toEqual([]);
    expect(validateAgent(agent({ kind: "personal", ownerEmail: null, managerEmail: "x" }))).toEqual(
      ["manager", "owner"],
    );
    expect(validateBinding(binding({ channelId: " " }))).toEqual(["channel"]);
    expect(
      validateMember({
        email: "a@b.example",
        identities: [{ platform: "slack", workspaceId: "T1", userId: "" }],
      }),
    ).toEqual(["identity"]);
    expect(
      validateReport({
        name: "Daily",
        agentId: "a1",
        bindingId: "b1",
        prompt: "x",
        days: [],
        time: "25:00",
      }),
    ).toEqual(["days", "time"]);
  });

  it("knows who may post and where reports can go", () => {
    const agents = [agent(), agent({ id: "a2", name: "Bogdan" }), agent({ id: "a3" })];
    expect(postingAgents(binding({ posters: ["a2"] }), agents).map((item) => item.id)).toEqual([
      "a1",
      "a2",
    ]);
    const bindings = [
      binding(),
      binding({ id: "b2", posters: ["a2"] }),
      binding({ id: "b3", channelId: "dm" }),
    ];
    expect(reportTargets(bindings, "a2").map((item) => item.id)).toEqual(["b2"]);
    expect(reportTargets(bindings, "a1").map((item) => item.id)).toEqual(["b1", "b2"]);
    expect(groupBindingsByConnection(bindings, [connection()])[0]!.bindings).toHaveLength(3);
  });

  it("describes connection state and wizard progress", () => {
    expect(stateTone("connected")).toBe("ok");
    expect(stateTone("waiting-relay")).toBe("wait");
    expect(stateTone("locked")).toBe("error");
    expect(missingSecrets(connection({ secretsStored: { botToken: true } }))).toEqual(["appToken"]);
    expect(wizardStartStep(null)).toBe(1);
    expect(wizardStartStep(connection({ secretsStored: {} }))).toBe(2);
    expect(wizardStartStep(connection({ workspaceAllowlist: [] }))).toBe(3);
    expect(wizardStartStep(connection())).toBe(4);
  });

  it("labels schedules", () => {
    const names = {
      days: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
      everyDay: "Every day",
      weekdays: "Mon-Fri",
    };
    expect(scheduleLabel([1, 2, 3, 4, 5], "09:00", names)).toBe("Mon-Fri 09:00");
    expect(scheduleLabel([0, 1, 2, 3, 4, 5, 6], "08:30", names)).toBe("Every day 08:30");
    expect(scheduleLabel([3, 1, 0], "17:00", names)).toBe("Mo, We, Su 17:00");
  });

  it("imports hub members once, by e-mail", () => {
    const existing: ZenChatMember[] = [
      { id: "m1", email: "Ana@acme.example", name: "Ana", role: "admin", identities: [] },
    ];
    expect(
      membersToImport(existing, [
        { email: "ana@acme.example", name: "Ana", role: "admin" },
        { email: "dan@acme.example", name: "Dan", role: "member" },
        { email: "DAN@acme.example", name: "Dan", role: "member" },
      ]),
    ).toEqual([{ email: "dan@acme.example", name: "Dan", role: "member", identities: [] }]);
    expect(identityLabel({ platform: "telegram", workspaceId: "", userId: "42" })).toBe(
      "Telegram: 42",
    );
  });

  it("has Romanian for every page string and every platform guide", () => {
    const ro = zenMessagesFor(chatText, "ro");
    expect(ro.tabs.connections).toBe("Conexiuni");
    expect(JSON.stringify(ro)).not.toMatch(/[şţŞŢ]/);
    for (const platform of ZEN_CHAT_PLATFORMS) {
      for (const locale of ["en", "ro"] as const) {
        const guide = platformGuide(platform, locale);
        expect(guide.steps.length).toBeGreaterThan(2);
        expect(guide.tos.length).toBeGreaterThan(0);
        expect(JSON.stringify(guide)).not.toMatch(/[şţŞŢ]/);
      }
    }
  });
});
