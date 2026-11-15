import { describe, expect, it } from "@effect/vitest";
import { validateWorkflow } from "@t3tools/contracts/zenOffice";

import {
  basicDraft,
  buildDraftPrompt,
  draftMessageText,
  draftTranscript,
  parseDraftReply,
} from "./workflowDraft.ts";

const chat = [
  {
    role: "user" as const,
    text: "Write a Facebook post about our new lunch menu at Bistro Ana, 35 lei.",
  },
  { role: "assistant" as const, text: "Here is the post. I saved it as post.md." },
  { role: "user" as const, text: "Shorter, and add an emoji-free call to action." },
  { role: "assistant" as const, text: "Done, post.md is updated." },
];

describe("Save this as a workflow", () => {
  it("asks for JSON in the person's language and redacts secrets", () => {
    const prompt = buildDraftPrompt(
      [
        ...chat,
        {
          role: "user",
          text: "password: hunter2xyz and key sk-ant-abcdefghijklmnopqrstuvwxyz123456",
        },
      ],
      "ro",
    );
    expect(prompt).toContain("are in Romanian");
    expect(prompt).toContain("Reply with only one JSON object");
    expect(prompt).toContain("Bistro Ana");
    expect(prompt).not.toContain("hunter2xyz");
    expect(prompt).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("keeps the start and the end of a long chat", () => {
    const long = [
      { role: "user" as const, text: "FIRST request" },
      ...Array.from({ length: 40 }, (_, index) => ({
        role: "assistant" as const,
        text: `step ${index} ${"x".repeat(900)}`,
      })),
      { role: "user" as const, text: "LAST message" },
    ];
    const text = draftTranscript(long);
    expect(text.length).toBeLessThanOrEqual(14_000);
    expect(text).toContain("FIRST request");
    expect(text).toContain("LAST message");
    expect(text).toContain("(...)");
  });

  it("turns a good reply into a valid draft and cleans what the model got wrong", () => {
    const reply = `Sure! {"name":"Postare de meniu","description":"O postare scurtă.","category":"social","icon":"megaphone","output":"post.md","inputs":[{"id":"Restaurant Name","label":"Restaurantul","type":"text","required":true,"placeholder":"Bistro Ana"},{"id":"price","label":"Prețul","type":"select","options":["35 lei"]},{"id":"unused","label":"Nefolosit","type":"text"},{"id":"note","label":"Notă (opțional)","type":"text","required":false}],"prompt":"Write a short Facebook post for {{restaurant_name}}{{#price}} at {{price}}{{/price}} about {{dish}}.{{#note}} Note: {{note}}{{/note}} Save it as post.md."}`;
    const draft = parseDraftReply(reply);
    expect(draft).not.toBeNull();
    const { manifest, prompt } = draft!;
    expect(manifest.id).toBe("postare-de-meniu");
    expect(manifest.category).toBe("social");
    // A one-option select becomes text; an unused question is dropped; an unknown placeholder
    // becomes plain words.
    expect(manifest.inputs.map((input) => [input.id, input.type])).toEqual([
      ["restaurant_name", "text"],
      ["price", "text"],
      ["note", "text"],
    ]);
    expect(manifest.inputs[2]?.label).toBe("Notă");
    expect(prompt).toContain("about the dish");
    expect(validateWorkflow(manifest, prompt)).toEqual([]);
  });

  it("refuses replies it cannot use", () => {
    expect(parseDraftReply("no json here")).toBeNull();
    expect(parseDraftReply('{"name":"x"}')).toBeNull();
    expect(parseDraftReply('{"name": "", "prompt": "hi"}')).toBeNull();
  });

  it("builds a basic draft from the first request when the model is not there", () => {
    const draft = basicDraft(chat, "Meniu nou", "ro");
    expect(draft.manifest.name).toBe("Meniu nou");
    expect(draft.manifest.inputs[0]?.label).toBe("Ce e diferit de data asta?");
    expect(draft.prompt).toContain("Bistro Ana");
    expect(validateWorkflow(draft.manifest, draft.prompt)).toEqual([]);
    // Template markers in the old request cannot break the new template.
    const tricky = basicDraft([{ role: "user", text: "Use {{name}} here" }], "", "en");
    expect(validateWorkflow(tricky.manifest, tricky.prompt)).toEqual([]);
  });

  it("uses the instructions of a thread that itself came from a workflow", () => {
    const text =
      "Press release\n\nTopic: Opening\n\n---\n\nWrite a release about Opening.\n\nLanguage: the person using this works in Romanian. Always answer them.";
    expect(draftMessageText(text)).toBe("Write a release about Opening.");
    expect(draftMessageText("plain")).toBe("plain");
  });
});
