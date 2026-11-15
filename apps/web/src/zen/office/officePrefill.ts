// Zen Staff: a hand-over of sample answers to a workflow's form (the onboarding interview's first
// task). Kept in sessionStorage so the Office home opens that workflow with them once.
import type { ZenWorkflowInput } from "@t3tools/contracts/zenOffice";

const KEY = "zen:office:prefill";

export interface OfficePrefill {
  readonly workflowId: string;
  readonly values: Readonly<Record<string, string>>;
}

export function setOfficePrefill(prefill: OfficePrefill): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(prefill));
  } catch {
    // Without storage the form just opens empty.
  }
}

export function peekOfficePrefill(): OfficePrefill | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfficePrefill;
    return typeof parsed.workflowId === "string" && typeof parsed.values === "object"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** The answers for this workflow (and forgets them), select values matched to the shown options. */
export function takeOfficePrefill(
  workflowId: string,
  inputs: ReadonlyArray<ZenWorkflowInput>,
  sourceInputs: ReadonlyArray<ZenWorkflowInput>,
): Record<string, string> {
  const prefill = peekOfficePrefill();
  if (prefill === null || prefill.workflowId !== workflowId) return {};
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
  return mapPrefillValues(prefill.values, inputs, sourceInputs);
}

/** Select answers are given as the workflow's own options; the form may show translated ones. */
function mapPrefillValues(
  values: Readonly<Record<string, string>>,
  inputs: ReadonlyArray<ZenWorkflowInput>,
  sourceInputs: ReadonlyArray<ZenWorkflowInput>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of inputs) {
    const value = values[input.id];
    if (value === undefined || value === "") continue;
    if (input.type === "file") continue;
    if (input.type === "select" && input.options) {
      if (input.options.includes(value)) out[input.id] = value;
      else {
        const source = sourceInputs.find((item) => item.id === input.id);
        const index = source?.options?.indexOf(value) ?? -1;
        if (index >= 0 && input.options[index] !== undefined) out[input.id] = input.options[index];
      }
      continue;
    }
    out[input.id] = value;
  }
  return out;
}
