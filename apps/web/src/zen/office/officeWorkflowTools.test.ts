import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  clearWorkflowDraft,
  fileToBase64,
  readWorkflowDraft,
  stashWorkflowDraft,
  workflowModelSelection,
} from "./officeWorkflowTools";

const claude = ProviderInstanceId.make("claudeAgent");
const codex = ProviderInstanceId.make("codex");
const entry = (
  instanceId: typeof claude,
  driverKind: string,
  slugs: ReadonlyArray<string>,
  extra: { isAvailable?: boolean } = {},
) => ({
  instanceId,
  driverKind,
  enabled: true,
  installed: true,
  isAvailable: extra.isAvailable ?? true,
  models: slugs.map((slug, index) => ({ slug, isDefault: index === 0 })),
});

describe("the model a workflow runs with", () => {
  const fallback = { instanceId: claude, model: "claude-sonnet-5" };
  const entries = [
    entry(codex, "codex", ["gpt-6"]),
    entry(claude, "claudeAgent", ["claude-sonnet-5", "claude-haiku-5-5", "claude-opus-5-5"]),
  ];

  it("uses the folder's default without a model", () => {
    expect(workflowModelSelection(undefined, fallback, entries)).toBe(fallback);
    expect(workflowModelSelection("  ", fallback, entries)).toBe(fallback);
  });

  it("finds an exact slug or an alias, preferring the default's provider", () => {
    expect(workflowModelSelection("claude-haiku-5-5", fallback, entries)).toEqual({
      instanceId: claude,
      model: "claude-haiku-5-5",
    });
    expect(workflowModelSelection("opus", fallback, entries)).toEqual({
      instanceId: claude,
      model: "claude-opus-5-5",
    });
    expect(workflowModelSelection("gpt-6", fallback, entries)).toEqual({
      instanceId: codex,
      model: "gpt-6",
    });
  });

  it("lets Claude run a Claude model it does not list, and falls back otherwise", () => {
    expect(workflowModelSelection("claude-haiku-6", fallback, entries)).toEqual({
      instanceId: claude,
      model: "claude-haiku-6",
    });
    expect(workflowModelSelection("mystery-model", fallback, entries)).toBe(fallback);
    const offline = [entry(claude, "claudeAgent", ["claude-haiku-5-5"], { isAvailable: false })];
    expect(workflowModelSelection("haiku", fallback, offline)).toBe(fallback);
  });
});

describe("the draft hand-over and file inputs", () => {
  it("keeps the draft until it is cleared", () => {
    const draft = {
      manifest: {
        id: "x",
        name: "X",
        description: "",
        category: "admin" as const,
        icon: "sparkles",
        inputs: [],
        output: "",
        version: "1.0.0",
        author: "Me",
      },
      prompt: "Do it.",
      method: "ai" as const,
    };
    stashWorkflowDraft(draft);
    expect(readWorkflowDraft()).toEqual(draft);
    clearWorkflowDraft();
    expect(readWorkflowDraft()).toBeNull();
  });

  it("encodes a file as base64 without a data prefix", async () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 251);
    const encoded = await fileToBase64(new Blob([bytes]));
    expect(Buffer.from(encoded, "base64").equals(Buffer.from(bytes))).toBe(true);
    expect(await fileToBase64(new Blob(["hello"]))).toBe("aGVsbG8=");
  });
});
