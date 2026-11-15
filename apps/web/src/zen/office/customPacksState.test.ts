import { buildWorkflowMessage, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { describe, expect, it } from "vite-plus/test";

import {
  customPackFor,
  customizeIntent,
  isCustomizable,
  isNewerVersion,
  threadWorkflowId,
  workflowKeywords,
} from "./customPacksState";

const workflow = (
  id: string,
  name: string,
  ro: string,
  extra: Partial<ZenWorkflow> = {},
): ZenWorkflow => ({
  manifest: {
    id,
    name,
    description: "",
    category: "video",
    icon: "film",
    inputs: [],
    output: "",
    version: "2.0.0",
    author: "Zen Staff",
    i18n: { ro: { name: ro } },
  },
  prompt: "Do it.",
  skill: null,
  source: "user",
  packId: id,
  editable: false,
  ...extra,
});

const reels = workflow("social-reels-kit", "Social reels kit", "Kit de reels pentru social media");
const deck = workflow("proposal-deck", "Proposal deck", "Ofertă ca prezentare");
const mine = workflow("thank-you-note", "Thank-you note", "Bilet de mulțumire", {
  packId: null,
  editable: true,
});
const workflows = [reels, deck, mine];

const reelsThread = buildWorkflowMessage(
  reels,
  {},
  {
    locale: "ro",
    summary: { title: "Kit de reels pentru social media", answers: [] },
  },
);

describe("which workflows can be customized", () => {
  it("packs, built-ins and copies yes; your own workflows no (they have the editor)", () => {
    expect(isCustomizable(reels)).toBe(true);
    expect(isCustomizable({ ...mine, source: "builtin" })).toBe(true);
    expect(isCustomizable(mine)).toBe(false);
  });

  it("the person's own copy comes before the company's", () => {
    const base = { workflowId: "social-reels-kit" } as never;
    const company = { ...(base as object), scope: "company", customId: "a@firma" } as never;
    const own = { ...(base as object), scope: "user", customId: "a@personal" } as never;
    expect(customPackFor([company, own], "social-reels-kit")).toBe(own);
    expect(customPackFor([company], "social-reels-kit")).toBe(company);
    expect(customPackFor([company], "other")).toBeNull();
  });

  it("compares versions", () => {
    expect(isNewerVersion("2.1.0", "2.0.0")).toBe(true);
    expect(isNewerVersion("2.10.0", "2.9.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "2.0.0")).toBe(false);
    expect(isNewerVersion("1.9.0", "2.0.0")).toBe(false);
  });
});

describe("the chat request to change a pack", () => {
  it("knows the pack by its id and names", () => {
    expect(workflowKeywords(reels)).toContain("reels");
    expect(workflowKeywords(deck)).toContain("oferta");
    expect(workflowKeywords(reels)).not.toContain("kit");
  });

  it("finds the workflow a thread ran from its first message", () => {
    expect(threadWorkflowId(reelsThread, workflows)).toBe("social-reels-kit");
    expect(threadWorkflowId("salut", workflows)).toBeNull();
    expect(threadWorkflowId(null, workflows)).toBeNull();
  });

  it("after a run, a change that names the pack asks to customize it", () => {
    const intent = customizeIntent({
      text: "la reels vreau voce și muzica mai încet",
      isFirstMessage: false,
      threadWorkflowId: "social-reels-kit",
      workflows,
    });
    expect(intent).toEqual({
      workflowId: "social-reels-kit",
      request: "la reels vreau voce și muzica mai încet",
    });
  });

  it("an explicit request works in any chat and names the pack", () => {
    expect(
      customizeIntent({
        text: "Pune logo-ul și culorile noastre în oferta PPTX, de acum înainte",
        isFirstMessage: false,
        threadWorkflowId: null,
        workflows,
      })?.workflowId,
    ).toBe("proposal-deck");
    expect(
      customizeIntent({
        text: "Personalizează pachetul: fontul nostru, te rog",
        isFirstMessage: false,
        threadWorkflowId: "social-reels-kit",
        workflows,
      })?.workflowId,
    ).toBe("social-reels-kit");
  });

  it("stays quiet for runs, plain chat, the first message and your own workflows", () => {
    const quiet = (text: string, threadId: string | null = null, isFirstMessage = false) =>
      customizeIntent({ text, isFirstMessage, threadWorkflowId: threadId, workflows });
    // Asking to run a pack in another chat is not a change to it.
    expect(quiet("vreau un reels despre meniul de azi")).toBeNull();
    expect(quiet("mulțumesc, arată bine", "social-reels-kit")).toBeNull();
    expect(quiet("la reels vreau muzica mai încet", "social-reels-kit", true)).toBeNull();
    expect(quiet("de acum înainte biletul de mulțumire mai scurt")).toBeNull();
  });
});
