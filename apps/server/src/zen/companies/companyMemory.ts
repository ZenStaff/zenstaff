// @effect-diagnostics nodeBuiltinImport:off -- Called synchronously while the adapter builds query options.
// The hook ClaudeAdapterV2 calls when it launches a Claude Code process: it adds the company's
// memory directory to the SDK's flag settings (`--settings`). Claude Code reads
// `autoMemoryDirectory` from policy settings first, then flag settings, then local/user settings,
// so a company's directory wins over the user's own setting for that session only.
//
// A module-level resolver keeps the adapter free of a new service requirement: ZenCompanies
// installs it at startup and the adapter reads it synchronously while building query options.
import * as NodeFS from "node:fs";

type MemoryDirectoryResolver = (projectId: string) => string | null;

let resolver: MemoryDirectoryResolver = () => null;

export function setZenCompanyMemoryResolver(next: MemoryDirectoryResolver | null): void {
  resolver = next ?? (() => null);
}

export function zenCompanyMemoryDirectory(projectId: string): string | null {
  try {
    return resolver(projectId);
  } catch {
    return null;
  }
}

/**
 * `{ sdkSettings }` for makeClaudeQueryOptions: the launch-argument settings plus
 * `autoMemoryDirectory` when the project belongs to a company with its own memory.
 */
export function withZenCompanyMemory<Settings extends object>(
  projectId: string,
  sdkSettings: Settings | undefined,
): { readonly sdkSettings?: Settings } {
  const directory = zenCompanyMemoryDirectory(projectId);
  if (directory === null) return sdkSettings === undefined ? {} : { sdkSettings };
  try {
    NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch {
    // Claude Code creates the directory itself when it first writes a memory.
  }
  return {
    sdkSettings: { ...sdkSettings, autoMemoryDirectory: directory } as unknown as Settings,
  };
}
