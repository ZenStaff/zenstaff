import { validateWorkflow, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_WORKFLOW_DRAFT,
  draftFromWorkflow,
  groupWorkflowsByCategory,
  initialFormValues,
  inputIdFromLabel,
  insertPlaceholder,
  invalidUrlInputs,
  manifestFromDraft,
  matchesSearch,
  workflowThreadTitle,
} from "./officeState";
import { zenRightPanelAvailability, zenThreadDetailsVisibility } from "./useZenEdition";

const workflow = (id: string, category: ZenWorkflow["manifest"]["category"]): ZenWorkflow => ({
  manifest: {
    id,
    name: id,
    description: "",
    category,
    icon: "sparkles",
    inputs: [
      { id: "topic", label: "Topic", type: "text", required: true },
      {
        id: "tone",
        label: "Tone",
        type: "select",
        required: true,
        options: ["Friendly", "Formal"],
      },
      { id: "link", label: "Link", type: "url", required: false },
    ],
    output: "",
    version: "1.0.0",
    author: "Zen Staff",
  },
  prompt: "{{topic}} {{tone}} {{#link}}{{link}}{{/link}}",
  skill: null,
  source: "builtin",
  packId: null,
  editable: false,
});

describe("office state", () => {
  it("groups by the fixed category order and drops empty categories", () => {
    const groups = groupWorkflowsByCategory([
      workflow("a", "admin"),
      workflow("b", "design"),
      workflow("c", "admin"),
    ]);
    expect(groups.map((group) => [group.category, group.workflows.length])).toEqual([
      ["design", 1],
      ["admin", 2],
    ]);
  });

  it("searches without case or accents, all words", () => {
    expect(matchesSearch("press REL", ["Press release", "PR"])).toBe(true);
    expect(matchesSearch("oferta", ["Ofertă client"])).toBe(true);
    expect(matchesSearch("press video", ["Press release"])).toBe(false);
    expect(matchesSearch("  ", ["anything"])).toBe(true);
  });

  it("starts choice lists on their first option and checks links", () => {
    const { inputs } = workflow("a", "admin").manifest;
    expect(initialFormValues(inputs)).toEqual({ topic: "", tone: "Friendly", link: "" });
    expect(invalidUrlInputs(inputs, { link: "acme.ro" }).map((input) => input.id)).toEqual([
      "link",
    ]);
    expect(invalidUrlInputs(inputs, { link: "https://acme.ro" })).toEqual([]);
    expect(invalidUrlInputs(inputs, { link: "javascript:alert(1)" })).toHaveLength(1);
  });

  it("titles a thread with the workflow name and the first short answer", () => {
    const { manifest } = workflow("Press release", "pr");
    expect(workflowThreadTitle(manifest, { topic: "New shop", tone: "Formal" })).toBe(
      "Press release: New shop",
    );
    expect(workflowThreadTitle(manifest, { topic: "line one\nline two", tone: "" })).toBe(
      "Press release",
    );
  });

  it("round-trips a workflow through the editor draft", () => {
    const original = workflow("round-trip", "sales");
    const manifest = manifestFromDraft(draftFromWorkflow(original), original.manifest.id);
    expect(manifest).toEqual(original.manifest);
    expect(validateWorkflow(manifest, original.prompt)).toEqual([]);
  });

  it("builds a manifest from a fresh draft with defaults", () => {
    const manifest = manifestFromDraft({ ...EMPTY_WORKFLOW_DRAFT, name: " Notes " }, "notes");
    expect(manifest).toMatchObject({ id: "notes", name: "Notes", version: "1.0.0", author: "Me" });
  });

  it("makes unique input ids from labels", () => {
    expect(inputIdFromLabel("Client name", [])).toBe("client_name");
    expect(inputIdFromLabel("Client name", ["client_name"])).toBe("client_name_2");
    expect(inputIdFromLabel("2026 budget", [])).toBe("budget");
    expect(inputIdFromLabel("!!!", [])).toBe("input");
  });

  it("inserts a placeholder at the cursor", () => {
    expect(insertPlaceholder("Hello world", "name", { start: 6, end: 11 })).toEqual({
      text: "Hello {{name}}",
      cursor: 14,
    });
    expect(insertPlaceholder("Hi ", "name", null).text).toBe("Hi {{name}}");
  });
});

describe("edition guards", () => {
  const visible = { environment: true, gitActions: true, changes: true, automations: true };
  it("hides developer rows only in Office", () => {
    expect(zenThreadDetailsVisibility(visible, false)).toBe(visible);
    expect(zenThreadDetailsVisibility(visible, true)).toMatchObject({
      environment: false,
      gitActions: false,
      changes: false,
      automations: true,
    });
  });

  it("turns off terminal, diff, pull request and device tabs in Office", () => {
    const props = {
      terminalAvailable: true,
      diffAvailable: true,
      pullRequestAvailable: true,
      pullRequestsAvailable: true,
      deviceAvailable: true,
      filesAvailable: true,
    };
    expect(zenRightPanelAvailability(props, true)).toEqual({
      terminalAvailable: false,
      diffAvailable: false,
      pullRequestAvailable: false,
      pullRequestsAvailable: false,
      deviceAvailable: false,
      filesAvailable: true,
    });
    expect(zenRightPanelAvailability(props, false)).toBe(props);
  });
});
