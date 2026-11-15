// Zen Staff: customized packs on the web: RPC atoms and the pure helpers (which workflows can be
// customized, the chat request that asks for it). ZEN.md, "Customized packs".
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  ZEN_OFFICE_WS_METHODS,
  splitWorkflowMessage,
  type ZenCustomPackView,
  type ZenWorkflow,
} from "@t3tools/contracts/zenOffice";

import { connectionAtomRuntime } from "../../connection/runtime";

export const officeCustomPacks = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-office:custom-packs",
  tag: ZEN_OFFICE_WS_METHODS.customPacks,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});
export const customizeOfficePack = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:customize-pack",
  tag: ZEN_OFFICE_WS_METHODS.customizePack,
});
/** The review of a draft (diff, checks, blockers); read fresh each time the dialog opens. */
export const officeCustomDraftReview = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-office:custom-draft",
  tag: ZEN_OFFICE_WS_METHODS.customDraft,
  staleTimeMs: 0,
  idleTtlMs: 5_000,
});
export const saveCustomDraft = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:save-custom-draft",
  tag: ZEN_OFFICE_WS_METHODS.saveCustomDraft,
});
export const discardCustomDraft = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:discard-custom-draft",
  tag: ZEN_OFFICE_WS_METHODS.discardCustomDraft,
});
export const revertCustomPack = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:revert-custom-pack",
  tag: ZEN_OFFICE_WS_METHODS.revertCustomPack,
});
export const resolveCustomUpdate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:resolve-custom-update",
  tag: ZEN_OFFICE_WS_METHODS.resolveCustomUpdate,
});
export const shareCustomPack = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-office:share-custom-pack",
  tag: ZEN_OFFICE_WS_METHODS.shareCustomPack,
});

/** Whether `next` is a newer dotted version than `current` ("2.10.0" > "2.9.1"). */
export function isNewerVersion(next: string, current: string): boolean {
  const parse = (value: string) => value.replace(/^v/i, "").split(/[.+-]/);
  const a = parse(next);
  const b = parse(current);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? "0";
    const y = b[index] ?? "0";
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx > ny;
    return x > y;
  }
  return false;
}

/** Packs from the marketplace, built-ins and customized copies can be customized; your own not. */
export function isCustomizable(workflow: Pick<ZenWorkflow, "source" | "packId" | "customization">) {
  return (
    workflow.source === "builtin" ||
    workflow.packId !== null ||
    workflow.customization !== undefined
  );
}

/** The copy the card shows for a workflow: the person's own first, then the company's. */
export function customPackFor(
  packs: ReadonlyArray<ZenCustomPackView>,
  workflowId: string,
): ZenCustomPackView | null {
  return (
    packs.find((pack) => pack.workflowId === workflowId && pack.scope === "user") ??
    packs.find((pack) => pack.workflowId === workflowId) ??
    null
  );
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Asks to change the pack itself (not only this result). */
const CUSTOMIZE_WORDS =
  /\b(personalizeaz\w*|personaliz\w*|customi[sz]\w*|de acum( inainte)?|de fiecare data|pe viitor|data viitoare|mereu|intotdeauna|implicit|in (pachet|sablon)|sablonul|from now on|every time|always|next time|by default|in the (pack|template))\b/;
/** Asks for a change ("vreau voce", "pune logo-ul", "make the music quieter"). */
const CHANGE_WORDS =
  /\b(vreau|as vrea|am nevoie|pune|puneti|schimba|schimbati|fa|faceti|adauga|scoate|foloseste|mai (incet|tare|mare|mic|scurt|lung|rar|des)|want|would like|put|change|make|add|remove|use|quieter|louder|bigger|smaller)\b/;
/** Words too common to name a pack. */
const STOP = new Set(
  "kit pack video check checks report reports from with your pentru este sunt care din dintr unui unei cele cel the and for with into este".split(
    " ",
  ),
);

/** Words that name a workflow: its id parts and the longer words of its names. */
export function workflowKeywords(workflow: ZenWorkflow): ReadonlyArray<string> {
  const names = [
    workflow.manifest.name,
    ...Object.values(workflow.manifest.i18n ?? {}).map((item) => item.name ?? ""),
  ];
  const words = new Set<string>();
  for (const part of workflow.manifest.id.split("-")) {
    if (part.length >= 4 && !STOP.has(part)) words.add(part);
  }
  for (const name of names) {
    for (const word of fold(name).split(/[^a-z0-9]+/)) {
      if (word.length >= 5 && !STOP.has(word)) words.add(word);
    }
  }
  return [...words];
}

/** The workflow a thread was started from, by the name on its first message, or null. */
export function threadWorkflowId(
  firstMessage: string | null,
  workflows: ReadonlyArray<ZenWorkflow>,
): string | null {
  if (firstMessage === null) return null;
  const split = splitWorkflowMessage(firstMessage);
  if (split === null) return null;
  const title = fold(split.summary.split("\n")[0]?.trim() ?? "");
  const found = workflows.find((workflow) =>
    [workflow.manifest.name, ...Object.values(workflow.manifest.i18n ?? {}).map((t) => t.name)]
      .filter((name): name is string => Boolean(name))
      .some((name) => fold(name) === title),
  );
  return found?.manifest.id ?? null;
}

/**
 * Whether the person's message asks to change a pack, and which: a message that says to
 * customize ("personalizează", "de acum", "from now on") about a named pack or the pack this
 * thread runs; or, after a workflow ran in the thread, a change request ("vreau", "pune", "mai
 * încet") that names a pack. The first message of a workflow thread is the workflow itself.
 */
export function customizeIntent(input: {
  readonly text: string;
  readonly isFirstMessage: boolean;
  readonly threadWorkflowId: string | null;
  readonly workflows: ReadonlyArray<ZenWorkflow>;
}): { readonly workflowId: string; readonly request: string } | null {
  if (input.isFirstMessage) return null;
  const text = fold(input.text);
  if (text.trim().length < 6 || text.length > 2000) return null;
  const customizable = input.workflows.filter(isCustomizable);
  let best: { readonly id: string; readonly hits: number } | null = null;
  for (const workflow of customizable) {
    const hits = workflowKeywords(workflow).filter((word) =>
      new RegExp(`\\b${word}`).test(text),
    ).length;
    if (hits > 0 && (best === null || hits > best.hits)) best = { id: workflow.manifest.id, hits };
  }
  const asksToCustomize = CUSTOMIZE_WORDS.test(text);
  const asksForChange = CHANGE_WORDS.test(text);
  const inThread = customizable.some((workflow) => workflow.manifest.id === input.threadWorkflowId)
    ? input.threadWorkflowId
    : null;
  const request = input.text.trim();
  // A plain change request counts only after a workflow ran in this thread (in another chat,
  // "vreau un tutorial" asks to run the pack, not to change it).
  const afterRun = input.threadWorkflowId !== null;
  if (best && (asksToCustomize || (asksForChange && afterRun))) {
    return { workflowId: best.id, request };
  }
  if (inThread && asksToCustomize) return { workflowId: inThread, request };
  return null;
}
