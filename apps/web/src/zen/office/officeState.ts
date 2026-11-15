// Zen Staff: Office edition state on the web: RPC atoms, the edition store, and the pure helpers
// the pages and tests share. See ZEN.md, "Office edition".
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_OFFICE_WS_METHODS,
  type ZenEdition,
  type ZenWorkflow,
  type ZenWorkflowCategory,
  type ZenWorkflowInput,
  type ZenWorkflowInputType,
  type ZenWorkflowManifest,
} from "@t3tools/contracts/zenOffice";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { applyDeviceEdition, applyServerEdition } from "./editionStore";

export const officeSettings = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-office:settings",
  tag: ZEN_OFFICE_WS_METHODS.settings,
  staleTimeMs: 30_000,
  idleTtlMs: 300_000,
});

export const officeWorkflows = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-office:workflows",
  tag: ZEN_OFFICE_WS_METHODS.listWorkflows,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

export const officeMarketplace = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-office:registry",
  tag: ZEN_OFFICE_WS_METHODS.registry,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

export const officeSampleMedia = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-office:sample-media",
  tag: ZEN_OFFICE_WS_METHODS.sampleMedia,
  staleTimeMs: 300_000,
  idleTtlMs: 300_000,
});

const setOfficeEdition = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:set-edition",
  tag: ZEN_OFFICE_WS_METHODS.setEdition,
});
export const saveOfficeWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:save-workflow",
  tag: ZEN_OFFICE_WS_METHODS.saveWorkflow,
});
export const deleteOfficeWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:delete-workflow",
  tag: ZEN_OFFICE_WS_METHODS.deleteWorkflow,
});
export const installOfficePack = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:install-pack",
  tag: ZEN_OFFICE_WS_METHODS.installPack,
});
export const setOfficeRegistryUrl = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:set-registry-url",
  tag: ZEN_OFFICE_WS_METHODS.setRegistryUrl,
});
export const uninstallOfficePack = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:uninstall-pack",
  tag: ZEN_OFFICE_WS_METHODS.uninstallPack,
});
export const draftOfficeWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:draft-workflow",
  tag: ZEN_OFFICE_WS_METHODS.draftWorkflow,
});
export const uploadOfficeInputFile = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:upload-input-file",
  tag: ZEN_OFFICE_WS_METHODS.uploadInputFile,
});

/** The empty inputs the query families are keyed by (one shared atom per environment). */
export const NO_INPUT = {} as const;
/** listWorkflows input: the selected company adds its workflows (null = all companies). */
export function workflowsInput(companyId: string | null): { readonly companyId: string | null } {
  return { companyId };
}

// Edition.
// The store lives in editionStore.ts (no runtime imports, so upstream guards can read it). The
// edition is per device: switching saves this browser's choice; the server's value is only the
// default for devices that never chose. It moves to the hub account later (ZEN.md).

export { getZenEdition } from "./editionStore";

/** Switches the edition on this device only. */
export function switchZenEdition(edition: ZenEdition): void {
  applyDeviceEdition(edition);
}

/** Makes an edition the default for every device of the primary machine that has not chosen. */
export async function setServerDefaultEdition(
  environmentId: EnvironmentId | null,
  edition: ZenEdition,
): Promise<boolean> {
  if (environmentId === null) return false;
  const result = await runAtomCommand(
    appAtomRegistry,
    setOfficeEdition,
    { environmentId, input: { edition } },
    { label: "Set default edition", reportFailure: true, reportDefect: true },
  );
  if (result._tag === "Failure") return false;
  applyServerEdition(edition);
  appAtomRegistry.refresh(officeSettings({ environmentId, input: NO_INPUT }));
  return true;
}

// Categories.

/** The order categories appear in on the Office home. */
export const CATEGORY_ORDER: ReadonlyArray<ZenWorkflowCategory> = [
  "design",
  "pr",
  "video",
  "social",
  "sales",
  "reports",
  "admin",
];

export function groupWorkflowsByCategory(
  workflows: ReadonlyArray<ZenWorkflow>,
): ReadonlyArray<{ category: ZenWorkflowCategory; workflows: ReadonlyArray<ZenWorkflow> }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    workflows: workflows.filter((workflow) => workflow.manifest.category === category),
  })).filter((group) => group.workflows.length > 0);
}

/** Case- and accent-insensitive search over name, description, category and tags. */
export function matchesSearch(query: string, fields: ReadonlyArray<string | undefined>): boolean {
  const fold = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(fields.filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

// Form values.

/** Starting values: the first option of every choice list, empty text elsewhere. */
export function initialFormValues(inputs: ReadonlyArray<ZenWorkflowInput>): Record<string, string> {
  return Object.fromEntries(
    inputs.map((input) => [input.id, input.type === "select" ? (input.options?.[0] ?? "") : ""]),
  );
}

export function invalidUrlInputs(
  inputs: ReadonlyArray<ZenWorkflowInput>,
  values: Readonly<Record<string, string>>,
): ReadonlyArray<ZenWorkflowInput> {
  return inputs.filter((input) => {
    const value = values[input.id]?.trim();
    if (input.type !== "url" || !value) return false;
    try {
      const url = new URL(value);
      return url.protocol !== "http:" && url.protocol !== "https:";
    } catch {
      return true;
    }
  });
}

/** The thread title: the workflow name and the first short input, such as "Press release: Opening". */
export function workflowThreadTitle(
  manifest: Pick<ZenWorkflowManifest, "name" | "inputs">,
  values: Readonly<Record<string, string>>,
): string {
  const first = manifest.inputs
    // A file path names the input, not the task.
    .filter((input) => input.type !== "file")
    .map((input) => values[input.id]?.trim() ?? "")
    .find((value) => value.length > 0 && value.length <= 60 && !value.includes("\n"));
  const title = first ? `${manifest.name}: ${first}` : manifest.name;
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

// Editor draft.

export interface WorkflowDraftInput {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly type: ZenWorkflowInputType;
  readonly required: boolean;
  /** One option per line. */
  readonly options: string;
  readonly placeholder: string;
}

export interface WorkflowDraft {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ZenWorkflowCategory;
  readonly icon: string;
  readonly output: string;
  readonly version: string;
  readonly author: string;
  readonly inputs: ReadonlyArray<WorkflowDraftInput>;
  readonly prompt: string;
  /** Translations from workflow.json, kept as they are when the workflow is saved again. */
  readonly i18n?: ZenWorkflowManifest["i18n"];
  /** The model this workflow runs with; empty = the folder's default. */
  readonly model: string;
}

let draftKey = 0;
export const newDraftKey = () => `input-${++draftKey}`;

export const EMPTY_WORKFLOW_DRAFT: WorkflowDraft = {
  id: "",
  name: "",
  description: "",
  category: "admin",
  icon: "sparkles",
  output: "",
  version: "1.0.0",
  author: "",
  inputs: [],
  prompt: "",
  model: "",
};

export function draftFromWorkflow(
  workflow: Pick<ZenWorkflow, "manifest" | "prompt">,
): WorkflowDraft {
  const { manifest } = workflow;
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    icon: manifest.icon,
    output: manifest.output,
    version: manifest.version,
    author: manifest.author,
    prompt: workflow.prompt,
    model: manifest.model ?? "",
    ...(manifest.i18n ? { i18n: manifest.i18n } : {}),
    inputs: manifest.inputs.map((input) => ({
      key: newDraftKey(),
      id: input.id,
      label: input.label,
      type: input.type,
      required: input.required,
      options: (input.options ?? []).join("\n"),
      placeholder: input.placeholder ?? "",
    })),
  };
}

export function manifestFromDraft(draft: WorkflowDraft, id: string): ZenWorkflowManifest {
  return {
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category,
    icon: draft.icon,
    output: draft.output.trim(),
    version: draft.version.trim() || "1.0.0",
    author: draft.author.trim() || "Me",
    ...(draft.i18n ? { i18n: draft.i18n } : {}),
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    inputs: draft.inputs.map((input): ZenWorkflowInput => {
      const options = input.options
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean);
      const placeholder = input.placeholder.trim();
      return {
        id: input.id.trim(),
        label: input.label.trim(),
        type: input.type,
        required: input.required,
        ...(input.type === "select" ? { options } : {}),
        ...(placeholder ? { placeholder } : {}),
      };
    }),
  };
}

/** An input id from a label: "Client name" -> "client_name", unique among `taken`. */
export function inputIdFromLabel(label: string, taken: ReadonlyArray<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 32) || "input";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
}

/** Inserts `{{id}}` at the cursor (or the end) of the template. */
export function insertPlaceholder(
  template: string,
  id: string,
  selection: { readonly start: number; readonly end: number } | null,
): { readonly text: string; readonly cursor: number } {
  const token = `{{${id}}}`;
  const start = selection?.start ?? template.length;
  const end = selection?.end ?? template.length;
  return {
    text: template.slice(0, start) + token + template.slice(end),
    cursor: start + token.length,
  };
}

/**
 * A folder inside the Scratch root: the per-chat folder of a quick chat (named from its first
 * message, such as `2026-11-07-https-www-reddit-com-r-5dfc959f`), not a folder to work in. The
 * Office folder picker leaves these out, so "Se salvează în" never names one.
 */
export function isScratchThreadFolder(
  workspaceRoot: string,
  scratchRoot: string | null | undefined,
): boolean {
  if (!scratchRoot) return false;
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const root = normalize(scratchRoot);
  const folder = normalize(workspaceRoot);
  return folder !== root && folder.startsWith(`${root}/`);
}
