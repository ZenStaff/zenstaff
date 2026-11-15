// Zen Staff: small helpers behind the workflow tools: the model a workflow runs with, the draft
// handed from a thread to the editor ("Save this as a workflow"), and file inputs. Pure except the
// draft hand-over (sessionStorage, so a reload of the editor keeps it). Tested in
// officeWorkflowTools.test.ts.
import type { ModelSelection } from "@t3tools/contracts";
import type { ZenWorkflowDraft } from "@t3tools/contracts/zenOffice";

/** The aliases a workflow.json may use for `model`, matched against the models a provider lists. */
export const WORKFLOW_MODEL_ALIASES = ["haiku", "sonnet", "opus"] as const;

interface ModelEntry {
  readonly instanceId: ModelSelection["instanceId"];
  readonly driverKind: string;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly isAvailable: boolean;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly isLegacy?: boolean | undefined;
    readonly isDefault?: boolean | undefined;
  }>;
}

/**
 * The model a workflow runs with. `preferred` is the workflow's `model` (a slug such as
 * "claude-haiku-5-5", or an alias); null or not available falls back to the folder's default.
 * The default's provider wins when it offers the model; a Claude provider accepts any Claude
 * slug even when its list does not show it.
 */
export function workflowModelSelection(
  preferred: string | undefined,
  fallback: ModelSelection | null,
  entries: ReadonlyArray<ModelEntry>,
): ModelSelection | null {
  const wanted = preferred?.trim().toLowerCase();
  if (!wanted) return fallback;
  const available = entries.filter(
    (entry) => entry.enabled && entry.installed && entry.isAvailable,
  );
  const ordered = fallback
    ? [
        ...available.filter((entry) => entry.instanceId === fallback.instanceId),
        ...available.filter((entry) => entry.instanceId !== fallback.instanceId),
      ]
    : available;
  const isAlias = (WORKFLOW_MODEL_ALIASES as ReadonlyArray<string>).includes(wanted);
  for (const entry of ordered) {
    const models = entry.models.filter((model) => !model.isLegacy);
    const found = isAlias
      ? (models.find((model) => model.slug.toLowerCase().includes(wanted) && model.isDefault) ??
        models.find((model) => model.slug.toLowerCase().includes(wanted)))
      : models.find((model) => model.slug.toLowerCase() === wanted);
    if (found) return { instanceId: entry.instanceId, model: found.slug };
  }
  if (!isAlias && wanted.startsWith("claude-")) {
    const claude = ordered.find((entry) => entry.driverKind === "claudeAgent");
    if (claude) return { instanceId: claude.instanceId, model: preferred!.trim() };
  }
  return fallback;
}

// Draft hand-over.

const DRAFT_KEY = "zen:office:workflow-draft";
let memoryDraft: ZenWorkflowDraft | null = null;

/** Keeps a draft for the editor to open ("Save this as a workflow"). */
export function stashWorkflowDraft(draft: ZenWorkflowDraft): void {
  memoryDraft = draft;
  try {
    globalThis.sessionStorage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage may be blocked; the in-memory copy still reaches the editor.
  }
}

/** The stashed draft, or null. It stays until another draft replaces it or it is saved. */
export function readWorkflowDraft(): ZenWorkflowDraft | null {
  if (memoryDraft) return memoryDraft;
  try {
    const text = globalThis.sessionStorage?.getItem(DRAFT_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text) as ZenWorkflowDraft;
    return parsed &&
      typeof parsed === "object" &&
      parsed.manifest &&
      typeof parsed.prompt === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function clearWorkflowDraft(): void {
  memoryDraft = null;
  try {
    globalThis.sessionStorage?.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

// File inputs.

/** Base64 of a chosen file, without the `data:...;base64,` prefix. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
