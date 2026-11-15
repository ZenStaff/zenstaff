// Zen Staff: the tool catalog (./catalog: tools/*.json, connectors, npm lockfiles, hashed pip
// requirements). Validation keeps recipes declarative: closed list of step types, every download
// pinned by sha256 over https, no path may leave the toolchain folder.
import {
  ZenConnectorCatalogEntry,
  ZenToolCatalogEntry,
  type ZenConnectorCatalogEntry as ZenConnectorCatalogEntryType,
  type ZenRecipeStep,
  type ZenToolCatalogEntry as ZenToolCatalogEntryType,
  type ZenToolRecipe,
  type ZenToolVersion,
  type ZenToolchainArch,
  type ZenToolchainOs,
} from "@t3tools/contracts/zenToolchains";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { isValidRange, isValidVersion } from "./versions.ts";

export interface ToolCatalog {
  readonly tools: ReadonlyMap<string, ZenToolCatalogEntryType>;
  readonly connectors: ReadonlyMap<string, ZenConnectorCatalogEntryType>;
  /** Folder holding the data files; lockfileDir and requirements resolve against it. */
  readonly dir: string;
  /** Files that did not load, with the reason. */
  readonly problems: ReadonlyArray<string>;
}

const decodeTool = Schema.decodeUnknownResult(ZenToolCatalogEntry);
const decodeConnectors = Schema.decodeUnknownResult(
  Schema.Struct({ connectors: Schema.Array(ZenConnectorCatalogEntry) }),
);

const SHA256 = /^[0-9a-f]{64}$/;
const TOOL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STEP_TYPES = new Set(["download", "npm", "uvPython", "venv", "pip", "remotionBrowser"]);
const ENV_NAME = /^ZEN_[A-Z0-9_]+$/;

/** A relative path that stays inside its folder: no "..", no absolute or drive paths. */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 300) return false;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return false;
  return value.split(/[\\/]/).every((part) => part !== ".." && part !== "");
}

function stepProblems(step: ZenRecipeStep, where: string): string[] {
  const problems: string[] = [];
  if (!STEP_TYPES.has(step.type)) {
    problems.push(`${where}: step type "${step.type}" is not allowed.`);
    return problems;
  }
  switch (step.type) {
    case "download": {
      if (!step.url.startsWith("https://")) problems.push(`${where}: downloads must use https.`);
      if (!SHA256.test(step.sha256)) problems.push(`${where}: a sha256 checksum is required.`);
      if (!(step.size > 0)) problems.push(`${where}: the download size is required.`);
      if (step.dest !== undefined && !isSafeRelativePath(step.dest)) {
        problems.push(`${where}: dest "${step.dest}" leaves the toolchain folder.`);
      }
      for (const file of step.files ?? []) {
        if (!isSafeRelativePath(file))
          problems.push(`${where}: file "${file}" is not a safe path.`);
      }
      if ((step.archive === "gz" || step.archive === "none") && step.dest === undefined) {
        problems.push(`${where}: a single-file download needs a dest name.`);
      }
      break;
    }
    case "npm":
      if (!isSafeRelativePath(step.lockfileDir)) problems.push(`${where}: bad lockfileDir.`);
      break;
    case "pip":
      if (!isSafeRelativePath(step.requirements)) problems.push(`${where}: bad requirements path.`);
      break;
    case "uvPython":
      if (!isValidVersion(step.python)) problems.push(`${where}: python version is not exact.`);
      break;
    case "venv":
      if (!TOOL_ID.test(step.pythonTool)) problems.push(`${where}: bad pythonTool.`);
      break;
    case "remotionBrowser":
      break;
  }
  return problems;
}

/** Plain list of problems in one catalog entry; empty means it is safe to use. */
export function validateCatalogEntry(entry: ZenToolCatalogEntryType): string[] {
  const problems: string[] = [];
  if (!TOOL_ID.test(entry.id)) problems.push(`Tool id "${entry.id}" is not valid.`);
  if (entry.versions.length === 0) problems.push(`${entry.id}: no versions.`);
  if (entry.minSafeVersion !== undefined && !isValidVersion(entry.minSafeVersion)) {
    problems.push(`${entry.id}: minSafeVersion is not a version.`);
  }
  for (const blocked of entry.blockedVersions ?? []) {
    if (!isValidRange(blocked.version)) problems.push(`${entry.id}: bad blocked version range.`);
  }
  for (const version of entry.versions) {
    if (!isValidVersion(version.version)) {
      problems.push(`${entry.id}: "${version.version}" is not a version.`);
    }
    for (const dependency of version.dependsOn ?? []) {
      if (!isValidRange(dependency.version)) {
        problems.push(`${entry.id}@${version.version}: bad dependency range.`);
      }
    }
    for (const recipe of version.recipes) {
      const where = `${entry.id}@${version.version} ${recipe.os}/${recipe.arch}`;
      if (recipe.steps.length === 0) problems.push(`${where}: no steps.`);
      recipe.steps.forEach((step, index) => {
        problems.push(...stepProblems(step, `${where} step ${index + 1}`));
      });
      for (const [name, path] of Object.entries(recipe.bin)) {
        if (!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(name)) problems.push(`${where}: bad command name.`);
        if (!isSafeRelativePath(path)) problems.push(`${where}: bin "${name}" leaves the folder.`);
      }
      for (const name of Object.keys(recipe.env ?? {})) {
        if (!ENV_NAME.test(name)) problems.push(`${where}: env "${name}" must start with ZEN_.`);
      }
    }
  }
  return problems;
}

/** Parses one tools/*.json file. */
export function parseCatalogEntry(
  text: string,
): { readonly entry: ZenToolCatalogEntryType } | { readonly error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "not valid JSON" };
  }
  const decoded = decodeTool(json);
  if (Result.isFailure(decoded)) return { error: decoded.failure.message };
  const problems = validateCatalogEntry(decoded.success);
  return problems.length > 0 ? { error: problems.join(" ") } : { entry: decoded.success };
}

export function parseConnectors(text: string): ReadonlyArray<ZenConnectorCatalogEntryType> {
  try {
    const decoded = decodeConnectors(JSON.parse(text));
    return Result.isSuccess(decoded) ? decoded.success.connectors : [];
  } catch {
    return [];
  }
}

export function recipeFor(
  version: ZenToolVersion,
  os: ZenToolchainOs,
  arch: ZenToolchainArch,
): ZenToolRecipe | null {
  return version.recipes.find((recipe) => recipe.os === os && recipe.arch === arch) ?? null;
}

/** Bytes downloaded by a recipe (pip/npm/browser steps are estimated from installedSize). */
export function recipeDownloadBytes(recipe: ZenToolRecipe): number {
  const pinned = recipe.steps.reduce(
    (sum, step) => sum + (step.type === "download" ? step.size : 0),
    0,
  );
  const fetched = recipe.steps.some((step) => step.type !== "download");
  return fetched ? Math.max(pinned, Math.round(recipe.installedSize * 0.45)) : pinned;
}

/** Rough seconds to install: download at `bytesPerSecond`, plus time for package managers. */
export function recipeInstallSeconds(recipe: ZenToolRecipe, bytesPerSecond: number): number {
  const extra = recipe.steps.reduce((sum, step) => {
    switch (step.type) {
      case "npm":
        return sum + 45;
      case "pip":
        return sum + 40;
      case "uvPython":
      case "venv":
        return sum + 10;
      case "remotionBrowser":
        return sum + 30;
      case "download":
        return sum + 3;
    }
  }, 0);
  return Math.round(recipeDownloadBytes(recipe) / bytesPerSecond + extra);
}

export type CatalogEntry = ZenToolCatalogEntryType;
