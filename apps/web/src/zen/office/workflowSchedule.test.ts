import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { parseZenScheduledWorkflowMarker } from "@t3tools/contracts/zenToolchains";
import { describe, expect, it } from "vite-plus/test";

import { zenMessagesFor } from "../i18n/zenI18n";
import { officeChatText } from "./officeChat.i18n";
import { describeRepeat } from "./WorkflowRepeatField";
import { isValidRepeatTime, workflowScheduleInput } from "./workflowSchedule";

const workflow = {
  manifest: {
    id: "website-change-watcher",
    name: "Watch a page",
    description: "",
    category: "reports" as const,
    icon: "search",
    inputs: [{ id: "url", label: "Page", type: "url" as const, required: true }],
    output: "",
    version: "1.1.0",
    author: "ZED-ZEN",
  },
  prompt: "Watch {{url}}.",
  skill: null,
};

describe("Repeat it automatically", () => {
  it("builds a scheduled task whose prompt names the workflow", () => {
    const input = workflowScheduleInput({
      workflow,
      values: { url: "https://bistro.ro/meniu" },
      locale: "ro",
      title: "Watch a page: https://bistro.ro/meniu",
      projectId: ProjectId.make("p1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-haiku-5-5",
      },
      runtimeMode: "auto-accept-edits",
      repeat: { kind: "weekly", time: "08:30", weekday: 1 },
    });
    expect(parseZenScheduledWorkflowMarker(input.prompt)).toBe("website-change-watcher");
    expect(input.prompt).toContain("Watch https://bistro.ro/meniu.");
    expect(input.schedule).toEqual({ type: "fixed_time", timeOfDay: "08:30", weekdays: [1] });
    expect(input).toMatchObject({
      threadId: null,
      threadMode: "new_thread",
      workspaceStrategy: { type: "root" },
      enabled: true,
    });
    const daily = workflowScheduleInput({
      workflow,
      values: {},
      locale: "en",
      title: "t",
      projectId: ProjectId.make("p1"),
      modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "x" },
      runtimeMode: "auto-accept-edits",
      repeat: { kind: "daily", time: " 9:05 " },
    });
    expect(daily.schedule).toEqual({ type: "fixed_time", timeOfDay: "9:05" });
  });

  it("checks the time and says when it repeats, in Romanian too", () => {
    expect(isValidRepeatTime("09:30")).toBe(true);
    expect(isValidRepeatTime("24:00")).toBe(false);
    expect(isValidRepeatTime("9.30")).toBe(false);
    const ro = zenMessagesFor(officeChatText, "ro");
    expect(describeRepeat({ kind: "weekly", time: "08:00", weekday: 2 }, ro)).toBe(
      "în fiecare marți la 08:00",
    );
    expect(
      describeRepeat({ kind: "daily", time: "08:00" }, zenMessagesFor(officeChatText, "en")),
    ).toBe("every day at 08:00");
  });
});
