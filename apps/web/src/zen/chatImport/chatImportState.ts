import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { ZEN_IMPORTS_WS_METHODS } from "@t3tools/contracts/zenImports";

import { connectionAtomRuntime } from "../../connection/runtime";

export const importedThreadsList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-imports:list",
  tag: ZEN_IMPORTS_WS_METHODS.list,
  staleTimeMs: 10_000,
  idleTtlMs: 60_000,
});

export const createImports = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-imports:create",
  tag: ZEN_IMPORTS_WS_METHODS.create,
});

export const continueImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-imports:continue",
  tag: ZEN_IMPORTS_WS_METHODS.continueThread,
});

export const previewImportMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-imports:memory-preview",
  tag: ZEN_IMPORTS_WS_METHODS.memoryPreview,
});

export const sendImportMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-imports:memory-send",
  tag: ZEN_IMPORTS_WS_METHODS.memorySend,
});

export const createImportProject = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-imports:create-project",
  tag: ZEN_IMPORTS_WS_METHODS.createProject,
});

export const saveImportMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-imports:save-memory",
  tag: ZEN_IMPORTS_WS_METHODS.saveMemory,
});

/** Splits a selection into calls the server accepts (count and size). */
export function importBatches<
  T extends { readonly messages: ReadonlyArray<{ readonly text: string }> },
>(
  conversations: ReadonlyArray<T>,
  limits: { readonly perCall: number; readonly maxChars: number },
): Array<Array<T>> {
  const batches: Array<Array<T>> = [];
  let current: Array<T> = [];
  let chars = 0;
  for (const conversation of conversations) {
    const size = conversation.messages.reduce((total, message) => total + message.text.length, 0);
    if (
      current.length > 0 &&
      (current.length >= limits.perCall || chars + size > limits.maxChars)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(conversation);
    chars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
