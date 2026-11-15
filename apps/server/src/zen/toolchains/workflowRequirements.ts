// @effect-diagnostics nodeBuiltinImport:off -- Reads workflow folders directly.
// Zen Staff: the `requires` block of each workflow, read straight from workflow.json (built-in,
// company, user folders, later wins, like ZenOffice), plus packs not installed yet.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZenWorkflowRequires,
  ZenWorkflowUnattended,
  unattendedProblems,
  type ZenWorkflowAccess,
} from "@t3tools/contracts/zenToolchains";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { parseAccess } from "./access.ts";
import { isValidRange } from "./versions.ts";

const decodeRequires = Schema.decodeUnknownResult(ZenWorkflowRequires);
const decodeUnattended = Schema.decodeUnknownResult(ZenWorkflowUnattended);

export interface WorkflowRequirementsEntry {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly requires: ZenWorkflowRequires | null;
  /** Why the requires block was ignored, when it did not validate. */
  readonly problem: string | null;
  readonly access: ZenWorkflowAccess;
  readonly accessProblems: ReadonlyArray<string>;
  /** The `unattended` block (what a scheduled run may do alone); null when absent or invalid. */
  readonly unattended: ZenWorkflowUnattended | null;
  readonly unattendedProblems: ReadonlyArray<string>;
}

/** The `unattended` block of a workflow.json text; null when absent. */
export function parseUnattended(text: string): {
  readonly unattended: ZenWorkflowUnattended | null;
  readonly problems: ReadonlyArray<string>;
} {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { unattended: null, problems: [] };
  }
  if (json.unattended === undefined) return { unattended: null, problems: [] };
  const decoded = decodeUnattended(json.unattended);
  if (Result.isFailure(decoded)) {
    return { unattended: null, problems: [`unattended is not valid: ${decoded.failure.message}`] };
  }
  const problems = unattendedProblems(decoded.success);
  return problems.length > 0
    ? { unattended: null, problems }
    : { unattended: decoded.success, problems: [] };
}

/** The requires block of a workflow.json text; null when absent. */
export function parseRequires(text: string): {
  readonly id: string | null;
  readonly name: string | null;
  readonly requires: ZenWorkflowRequires | null;
  readonly problem: string | null;
} {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { id: null, name: null, requires: null, problem: "workflow.json is not valid JSON." };
  }
  const id = typeof json.id === "string" ? json.id : null;
  const name = typeof json.name === "string" ? json.name : id;
  if (json.requires === undefined) return { id, name, requires: null, problem: null };
  const decoded = decodeRequires(json.requires);
  if (Result.isFailure(decoded)) {
    return {
      id,
      name,
      requires: null,
      problem: `requires is not valid: ${decoded.failure.message}`,
    };
  }
  const bad = (decoded.success.tools ?? []).filter(
    (tool) => tool.version && !isValidRange(tool.version),
  );
  if (bad.length > 0) {
    return {
      id,
      name,
      requires: null,
      problem: `requires has a bad version range for ${bad.map((tool) => tool.id).join(", ")}.`,
    };
  }
  return { id, name, requires: decoded.success, problem: null };
}

async function readFolder(folder: string): Promise<WorkflowRequirementsEntry | null> {
  let text: string;
  try {
    text = await NodeFS.promises.readFile(NodePath.join(folder, "workflow.json"), "utf8");
  } catch {
    return null;
  }
  const parsed = parseRequires(text);
  const id = parsed.id ?? NodePath.basename(folder);
  const access = parseAccess(text);
  const unattended = parseUnattended(text);
  return {
    id,
    name: parsed.name ?? id,
    folder,
    requires: parsed.requires,
    problem: parsed.problem,
    access: access.access,
    accessProblems: access.problems,
    unattended: unattended.unattended,
    unattendedProblems: unattended.problems,
  };
}

/** Every workflow under the folders, later folders replacing earlier ones by id. */
export async function loadWorkflowRequirements(
  dirs: ReadonlyArray<string>,
): Promise<Map<string, WorkflowRequirementsEntry>> {
  const byId = new Map<string, WorkflowRequirementsEntry>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = (await NodeFS.promises.readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of names.toSorted()) {
      const entry = await readFolder(NodePath.join(dir, name));
      if (entry && entry.id === name) byId.set(entry.id, entry);
    }
  }
  return byId;
}

/** A marketplace pack's folder from registry.json, for packs not installed yet. */
export async function loadPackRequirements(
  registryPath: string,
  packId: string,
): Promise<WorkflowRequirementsEntry | null> {
  try {
    const registry = JSON.parse(await NodeFS.promises.readFile(registryPath, "utf8")) as {
      entries?: Array<{ id?: string; kind?: string; path?: string }>;
    };
    const entry = registry.entries?.find((candidate) => candidate.id === packId);
    if (!entry || entry.kind !== "pack" || typeof entry.path !== "string") return null;
    return await readFolder(NodePath.resolve(NodePath.dirname(registryPath), entry.path));
  } catch {
    return null;
  }
}

/** Every pack of the bundled registry (for the enterprise list before install). */
export async function loadPackRequirementsAll(
  registryPath: string,
): Promise<WorkflowRequirementsEntry[]> {
  try {
    const registry = JSON.parse(await NodeFS.promises.readFile(registryPath, "utf8")) as {
      entries?: Array<{ id?: string; kind?: string; path?: string }>;
    };
    const out: WorkflowRequirementsEntry[] = [];
    for (const entry of registry.entries ?? []) {
      if (entry.kind !== "pack" || typeof entry.path !== "string") continue;
      const found = await readFolder(NodePath.resolve(NodePath.dirname(registryPath), entry.path));
      if (found) out.push(found);
    }
    return out;
  } catch {
    return [];
  }
}
