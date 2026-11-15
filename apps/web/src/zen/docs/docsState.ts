// Zen Staff document editing: the zen.docs RPCs as a DocBackend for one environment. Each
// environment answers over its own connection, so a file on a remote machine is read and saved
// there, exactly like upstream's file viewer reads it.
import {
  type AtomCommand,
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_DOCS_WS_METHODS,
  type ZenDocNote,
  type ZenDocTarget,
} from "@t3tools/contracts/zenDocs";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import type { DocBackend } from "./docSession";

const readDoc = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-docs:read",
  tag: ZEN_DOCS_WS_METHODS.read,
});
const writeDoc = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-docs:write",
  tag: ZEN_DOCS_WS_METHODS.write,
});
const listDocVersions = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-docs:versions",
  tag: ZEN_DOCS_WS_METHODS.versions,
});
const readDocVersion = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-docs:read-version",
  tag: ZEN_DOCS_WS_METHODS.readVersion,
});
const docNotes = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-docs:notes",
  tag: ZEN_DOCS_WS_METHODS.notes,
});

async function run<W, A, E>(command: AtomCommand<W, A, E>, value: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, value, { reportFailure: false });
  if (result._tag === "Success") return result.value;
  const error = squashAtomCommandFailure(result);
  throw error instanceof Error ? error : new Error(String(error));
}

export function environmentDocBackend(environmentId: EnvironmentId): DocBackend {
  return {
    read: (target) => run(readDoc, { environmentId, input: target }),
    write: (input) => run(writeDoc, { environmentId, input }),
    versions: async (target) =>
      (await run(listDocVersions, { environmentId, input: target })).versions,
    readVersion: (target, versionId) =>
      run(readDocVersion, { environmentId, input: { ...target, versionId } }),
  };
}

export async function loadNotes(environmentId: EnvironmentId, target: ZenDocTarget) {
  return (await run(docNotes, { environmentId, input: target })).notes;
}

export async function saveNotes(
  environmentId: EnvironmentId,
  target: ZenDocTarget,
  notes: ReadonlyArray<ZenDocNote>,
) {
  return (await run(docNotes, { environmentId, input: { ...target, notes } })).notes;
}
