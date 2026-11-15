import type { StaffAgent } from "@t3tools/contracts/zenStaff";
import { describe, expect, it } from "vite-plus/test";

import { isScratchThreadFolder } from "../office/officeState";
import { entryWorkflows } from "./UsePackButton";
import {
  applyHireProposal,
  chipsVisible,
  isIntakeThread,
  listChanges,
  scheduleRepeat,
  startingWithItems,
} from "./intakeState";

const chips = {
  id: "c1",
  field: "networks",
  question: "Pe ce rețele?",
  options: ["Instagram + Facebook", "LinkedIn"],
  askedAt: 1_000,
};

describe("intake dock helpers", () => {
  it("recognises intake and hiring chats by their first message", () => {
    expect(isIntakeThread("Postări\n\n---\n\n[zen-intake: social-media-post-set]\n...")).toBe(true);
    expect(isIntakeThread("Angajare\n\n---\n\n[zen-hire-setup: maria-1a2b]")).toBe(true);
    expect(isIntakeThread("Salut, scrie-mi un e-mail")).toBe(false);
    expect(isIntakeThread(null)).toBe(false);
  });

  it("shows the quick replies until the person answers", () => {
    expect(chipsVisible(chips, null)).toBe(true);
    expect(chipsVisible(chips, 500)).toBe(true);
    expect(chipsVisible(chips, 1_500)).toBe(false);
    expect(chipsVisible(null, null)).toBe(false);
  });

  it("writes the Starting with line in the person's words", () => {
    const manifest = {
      inputs: [
        { id: "topic", label: "Despre ce e vorba?", type: "longtext" as const, required: true },
        { id: "tone", label: "Tonul", type: "select" as const, required: true },
        { id: "language", label: "Limba", type: "text" as const, required: false },
      ],
    };
    expect(startingWithItems(manifest, { topic: "Meniul de toamnă", tone: "Prietenos" })).toEqual([
      { label: "Despre ce e vorba", value: "Meniul de toamnă" },
      { label: "Tonul", value: "Prietenos" },
    ]);
  });

  it("turns the agent's repeat into the form's repeat", () => {
    expect(
      scheduleRepeat({ kind: "weekly", weekday: 1, time: "09:00", state: "pending", detail: null }),
    ).toEqual({ kind: "weekly", weekday: 1, time: "09:00" });
    expect(
      scheduleRepeat({ kind: "daily", weekday: 1, time: "18:00", state: "pending", detail: null }),
    ).toEqual({ kind: "daily", time: "18:00" });
  });

  it("writes the approved proposal into the employee's profile and activates it", () => {
    const agent = {
      id: "maria-1a2b",
      name: "Maria",
      instructions: "Ești social media managerul companiei.",
      workflows: ["social-media-post-set", "newsletter-issue"],
      connectors: ["meta-pages"],
      duties: [],
      paused: true,
    } as unknown as StaffAgent;
    const next = applyHireProposal(
      agent,
      {
        instructions: "Planifici 4 postări pe săptămână pentru Instagram.",
        workflows: ["social-media-post-set"],
        connectors: ["Meta", "Zernio"],
        duties: [{ title: "Postările săptămânii", prompt: "Propune", weekday: 1, time: "09:00" }],
        publishesTo: ["Instagram @cafeabuna"],
        approvals: "Alex aprobă",
        never: ["Nu inventa prețuri"],
      },
      "ro",
    );
    expect(next.paused).toBe(false);
    expect(next.workflows).toEqual(["social-media-post-set"]);
    expect(next.connectors).toEqual(["Meta", "Zernio"]);
    expect(next.duties[0]).toMatchObject({
      title: "Postările săptămânii",
      weekday: 1,
      scheduledTaskId: null,
    });
    expect(next.instructions).toContain("Aprobări: Alex aprobă");
    expect(listChanges(agent.workflows, next.workflows)).toEqual([
      { kind: "same", text: "social-media-post-set" },
      { kind: "removed", text: "newsletter-issue" },
    ]);
  });

  it("finds the workflows of a Magazin entry that are on this machine", () => {
    const workflow = (id: string) => ({ manifest: { id } }) as never;
    const list = [workflow("a"), workflow("b"), workflow("c")];
    expect(
      entryWorkflows({ id: "pack", workflows: ["c", "a", "x"] }, list).map(
        (item) => (item as { manifest: { id: string } }).manifest.id,
      ),
    ).toEqual(["c", "a"]);
    expect(entryWorkflows({ id: "b" }, list)).toHaveLength(1);
  });

  it("leaves Scratch chat folders out of the Office folder picker", () => {
    const scratch = "/home/ana/.zen/scratch";
    expect(
      isScratchThreadFolder(`${scratch}/2026-11-07-https-www-reddit-com-r-5dfc959f`, scratch),
    ).toBe(true);
    expect(isScratchThreadFolder(scratch, scratch)).toBe(false);
    expect(isScratchThreadFolder("/home/ana/Documente/Marketing", scratch)).toBe(false);
    expect(
      isScratchThreadFolder("C:\\Users\\Ana\\.zen\\scratch\\x", "C:\\Users\\Ana\\.zen\\scratch"),
    ).toBe(true);
    expect(isScratchThreadFolder("/x", null)).toBe(false);
  });
});
