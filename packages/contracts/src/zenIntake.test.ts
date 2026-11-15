import { describe, expect, it } from "@effect/vitest";

import {
  buildHireSetupMessage,
  buildIntakeMessage,
  checkIntakeValues,
  hireInstructionsText,
  humanFolderWords,
  intakeChecklist,
  intakeRunFolder,
  lineDiff,
  matchOption,
  matchToneOption,
  normalizeChips,
  normalizeHireProposal,
  normalizeScheduleRequest,
  parseHireSetupMarker,
  parseIntakeMarker,
  prefillIntake,
  type IntakeContext,
} from "./zenIntake.ts";
import {
  localizeWorkflowManifest,
  splitWorkflowMessage,
  type ZenWorkflowManifest,
} from "./zenOffice.ts";

const social: ZenWorkflowManifest = {
  id: "social-media-post-set",
  name: "Social media post set",
  description: "A week of posts.",
  category: "social",
  icon: "megaphone",
  inputs: [
    { id: "topic", label: "What is it about?", type: "longtext", required: true },
    { id: "audience", label: "Who should it reach?", type: "text", required: true },
    {
      id: "networks",
      label: "Networks",
      type: "select",
      required: true,
      options: ["Instagram + Facebook", "LinkedIn", "Instagram + Facebook + LinkedIn"],
    },
    {
      id: "tone",
      label: "Tone",
      type: "select",
      required: true,
      options: ["Friendly", "Professional", "Playful", "Bold"],
    },
    {
      id: "posts",
      label: "How many posts?",
      type: "select",
      required: true,
      options: ["3", "5", "7"],
    },
    { id: "call_to_action", label: "What should people do?", type: "text", required: false },
    { id: "language", label: "Language", type: "text", required: false },
  ],
  output: "social-posts.md",
  version: "1.0.0",
  author: "Zen Staff",
  i18n: {
    ro: {
      name: "Postări pentru rețelele sociale",
      inputs: {
        topic: { label: "Despre ce e vorba?" },
        audience: { label: "Cui te adresezi?" },
        networks: {
          label: "Rețelele",
          options: ["Instagram + Facebook", "LinkedIn", "Instagram + Facebook + LinkedIn"],
        },
        tone: { label: "Tonul", options: ["Prietenos", "Profesionist", "Jucăuș", "Îndrăzneț"] },
        posts: { label: "Câte postări?" },
        call_to_action: { label: "Ce vrei să facă oamenii?" },
        language: { label: "Limba" },
      },
    },
  },
};
const ro = localizeWorkflowManifest(social, "ro");

const facts = {
  companyName: "Cafea Bună",
  tones: ["friendly"],
  website: "https://cafeabuna.ro",
  customers: "Tineri care lucrează la birou, în Cluj",
  links: ["https://cafeabuna.ro/rezervari"],
};

describe("intake checklist", () => {
  it("turns every form question into a checklist item with its choices and what is known", () => {
    const suggestions = prefillIntake({ inputs: ro.inputs, facts, previous: null, locale: "ro" });
    const checklist = intakeChecklist(ro.inputs, suggestions);
    expect(checklist).toContain('- topic (required, longtext): "Despre ce e vorba?"');
    expect(checklist).toContain('choices: "Prietenos", "Profesionist", "Jucăuș", "Îndrăzneț"');
    expect(checklist).toContain('already known: "Prietenos" (from tonul din profilul firmei)');
    expect(checklist).toContain("- call_to_action (optional, text)");
  });

  it("builds a first message that splits like a workflow message and names the workflow", () => {
    const context: IntakeContext = {
      suggestions: prefillIntake({ inputs: ro.inputs, facts, previous: null, locale: "ro" }),
      facts,
      profileExcerpt: "# Cafea Bună\n\nCafenea în Cluj.",
      memoryExcerpt: "- [Profil](company-profile.md)",
      recentFiles: [{ name: "meniu-toamna.pdf", modifiedAt: "2026-11-07T10:00:00.000Z" }],
      previousAt: null,
      connections: ["Meta (Claude Code)"],
      folderName: "Marketing",
    };
    const message = buildIntakeMessage({
      workflow: { manifest: social },
      localized: ro,
      locale: "ro",
      context,
    });
    const split = splitWorkflowMessage(message);
    expect(split?.summary.split("\n")[0]).toBe("Postări pentru rețelele sociale");
    expect(split?.summary).toContain("Hai să stabilim");
    expect(parseIntakeMarker(message)).toBe("social-media-post-set");
    expect(message).toContain("Do NOT start the task yet");
    expect(message).toContain("intake_ready");
    expect(message).toContain("intake_ask");
    expect(message).toContain("meniu-toamna.pdf (2026-11-07)");
    expect(message).toContain("Connected apps: Meta (Claude Code).");
    expect(message).toContain("Folosesc tonul prietenos din profilul firmei");
    expect(message).toContain("Always answer them in Romanian");
  });
});

describe("prefill", () => {
  it("fills tone, audience, link and language from the profile and memory", () => {
    const out = prefillIntake({ inputs: ro.inputs, facts, previous: null, locale: "ro" });
    expect(out.tone).toMatchObject({ value: "Prietenos", source: "profile" });
    expect(out.audience?.value).toBe("Tineri care lucrează la birou, în Cluj");
    expect(out.call_to_action).toMatchObject({
      value: "https://cafeabuna.ro/rezervari",
      source: "memory",
    });
    expect(out.language?.value).toBe("română");
    expect(out.topic).toBeUndefined();
  });

  it("prefers the last run's choices but never reuses the topic", () => {
    const out = prefillIntake({
      inputs: ro.inputs,
      facts,
      previous: { topic: "Meniul de vară", networks: "LinkedIn", posts: "5", tone: "Profesionist" },
      locale: "ro",
    });
    expect(out.topic).toBeUndefined();
    expect(out.networks).toMatchObject({ value: "LinkedIn", source: "previous" });
    expect(out.posts?.value).toBe("5");
    expect(out.tone?.value).toBe("Profesionist");
  });

  it("matches profile tones to options in either language", () => {
    expect(matchToneOption("warm", ["Prietenos", "Serios", "Amuzant"])).toBe("Prietenos");
    expect(matchToneOption("formal", ["Friendly", "Professional"])).toBe("Professional");
    expect(matchToneOption("playful", ["Prietenos", "Serios", "Amuzant"])).toBe("Amuzant");
    expect(matchToneOption("premium", ["A", "B"])).toBeNull();
  });
});

describe("gathered values", () => {
  it("matches free answers to choices and reports what is still missing", () => {
    const checked = checkIntakeValues({
      manifest: social,
      localized: ro,
      raw: {
        topic: "Meniul de toamnă",
        networks: "facebook si instagram",
        tone: "prietenos",
        extra: "x",
      },
    });
    expect(checked.values.networks).toBe("Instagram + Facebook");
    expect(checked.values.tone).toBe("Prietenos");
    expect(checked.unknown).toEqual(["extra"]);
    expect(checked.missing).toEqual(["Cui te adresezi? (audience)", "Câte postări? (posts)"]);
  });

  it("maps an English choice to the option the person sees", () => {
    const checked = checkIntakeValues({
      manifest: social,
      localized: ro,
      raw: { tone: "Playful", posts: 5 },
    });
    expect(checked.values.tone).toBe("Jucăuș");
    expect(checked.values.posts).toBe("5");
  });

  it("keeps quick replies short, distinct and at most six", () => {
    expect(
      normalizeChips(["Instagram + Facebook", " doar  Instagram ", "LinkedIn", "linkedin", 3]),
    ).toEqual(["Instagram + Facebook", "doar Instagram", "LinkedIn"]);
    expect(normalizeChips(["1", "2", "3", "4", "5", "6", "7"])).toHaveLength(6);
    expect(normalizeChips("nope")).toEqual([]);
    expect(matchOption("doar Instagram", ["Instagram", "LinkedIn"])).toBe("Instagram");
  });

  it("reads the repeat the agent asks for", () => {
    expect(
      normalizeScheduleRequest({ frequency: "weekly", weekday: "luni", time: "9:00" }),
    ).toEqual({
      kind: "weekly",
      weekday: 1,
      time: "09:00",
    });
    expect(normalizeScheduleRequest({ frequency: "daily", time: "18:30" })).toMatchObject({
      kind: "daily",
      time: "18:30",
    });
    expect(
      normalizeScheduleRequest({ frequency: "weekly", weekday: "duminică", time: "07" }),
    ).toEqual({
      kind: "weekly",
      weekday: 0,
      time: "07:00",
    });
    expect(normalizeScheduleRequest({ time: "25:00" })).toHaveProperty("error");
  });
});

describe("folder names", () => {
  it("names a run folder from the workflow and the topic, in plain words", () => {
    expect(
      intakeRunFolder({
        date: "2026-11-08",
        localized: ro,
        values: { topic: "Vineri lansăm meniul de toamnă", audience: "Tineri" },
      }),
    ).toBe("2026-11-08-postari-meniul-toamna");
  });

  it("turns links into their site name and drops filler", () => {
    expect(humanFolderWords("https://www.reddit.com/r/cafe/comments/123 ce spun oamenii")).toBe(
      "reddit-ce-spun-oamenii",
    );
    expect(humanFolderWords("Postări meniu toamnă")).toBe("postari-meniu-toamna");
  });
});

describe("hiring", () => {
  const context = {
    agentName: "Maria",
    role: "Social Media Manager",
    templateInstructions: "Ești social media managerul companiei.",
    workflows: [{ id: "social-media-post-set", name: "Postări" }],
    roleWorkflows: ["social-media-post-set"],
    roleConnectors: ["meta-pages"],
    roleDuties: [{ title: "Postările săptămânii", prompt: "Propune", weekday: 1, time: "09:00" }],
    connections: [
      { name: "Meta", where: "Claude Code" },
      { name: "Zernio", where: "Claude Code" },
    ],
    facts,
    recentFiles: [],
    kind: "company" as const,
    managerName: "Alex",
    approvalsRequired: true,
    companyAccount: "Claude Team",
    folderName: "Marketing",
  };

  it("asks about the connections it found and respects the company's approvals", () => {
    const message = buildHireSetupMessage({ agentId: "maria-1a2b", locale: "ro", context });
    expect(parseHireSetupMarker(message)).toBe("maria-1a2b");
    expect(message).toContain(
      "Văd că ai conectat Meta și Zernio în Claude. Le folosesc pentru postări?",
    );
    expect(message).toContain('"Aprobări" on');
    expect(message).toContain("company AI account (Claude Team)");
    expect(message).toContain("hire_propose");
    expect(splitWorkflowMessage(message)?.summary.split("\n")[0]).toBe(
      "Angajare: Maria, Social Media Manager",
    );
  });

  it("cleans the proposal and writes the agreed rules into the instructions", () => {
    const result = normalizeHireProposal(
      {
        instructions: "Planifici și scrii postările săptămânii pe tonul brandului.",
        workflows: ["social-media-post-set", "unknown-flow"],
        connectors: ["Meta", "Zernio", "Meta"],
        duties: [
          { title: "Postările săptămânii", prompt: "Propune 4 postări", weekday: 1, time: "09:00" },
          { title: "Fără zi", prompt: "x", weekday: 9, time: "09:00" },
        ],
        publishes_to: ["Instagram @cafeabuna"],
        approvals: "Alex aprobă fiecare postare",
        never: ["Nu inventa prețuri"],
      },
      { workflows: ["social-media-post-set"] },
    );
    if (!("proposal" in result)) throw new Error(result.error);
    expect(result.proposal.workflows).toEqual(["social-media-post-set"]);
    expect(result.proposal.connectors).toEqual(["Meta", "Zernio"]);
    expect(result.proposal.duties).toHaveLength(1);
    const text = hireInstructionsText(result.proposal, "ro");
    expect(text).toContain("Unde publici:\n- Instagram @cafeabuna");
    expect(text).toContain("Aprobări: Alex aprobă fiecare postare");
    expect(text).toContain("Nu faci niciodată:\n- Nu inventa prețuri");
    expect(normalizeHireProposal({ instructions: "scurt" }, { workflows: [] })).toHaveProperty(
      "error",
    );
  });

  it("diffs the job description line by line", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });
});
