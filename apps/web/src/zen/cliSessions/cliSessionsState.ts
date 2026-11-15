import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_CLI_SESSIONS_WS_METHODS,
  type ZenCliSession,
  type ZenCliSessionsListInput,
} from "@t3tools/contracts/zenCliSessions";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";

export const cliSessionsList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-cli-sessions:list",
  tag: ZEN_CLI_SESSIONS_WS_METHODS.list,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});

export const cliSessionResume = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-cli-sessions:resume",
  tag: ZEN_CLI_SESSIONS_WS_METHODS.resume,
});

/** One list query per environment, keyed so the same filters reuse atoms across renders. */
export const cliSessionsAcrossEnvironments = Atom.family((key: string) => {
  const [ids, input] = JSON.parse(key) as [ReadonlyArray<EnvironmentId>, ZenCliSessionsListInput];
  return Atom.make((get) =>
    ids.map((environmentId) => ({
      environmentId,
      result: get(cliSessionsList({ environmentId, input })),
    })),
  ).pipe(Atom.withLabel(`zen-cli-sessions:${key}`));
});

export const cliSessionsKey = (
  environmentIds: ReadonlyArray<EnvironmentId>,
  input: ZenCliSessionsListInput,
) => JSON.stringify([environmentIds, input]);

function shellQuote(value: string): string {
  return /^[\w./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** `claude --resume` only finds a session from the folder it started in, so the command `cd`s first. */
export function resumeCommand(session: Pick<ZenCliSession, "provider" | "sessionId" | "cwd">) {
  const resume =
    session.provider === "codex"
      ? `codex resume ${session.sessionId}`
      : `claude --resume ${session.sessionId}`;
  if (session.cwd === null) return resume;
  if (/^[A-Za-z]:[\\/]/.test(session.cwd) || session.cwd.startsWith("\\\\")) {
    return `Set-Location -LiteralPath '${session.cwd.replaceAll("'", "''")}'; ${resume}`;
  }
  return `cd ${shellQuote(session.cwd)} && ${resume}`;
}

export interface ProjectGroup {
  readonly key: string;
  readonly cwd: string | null;
  readonly sessions: ReadonlyArray<ZenCliSession>;
}

/** Groups by folder; groups and sessions keep the server's order (relevance, then recency). */
export function groupByProject(
  sessions: ReadonlyArray<ZenCliSession>,
): ReadonlyArray<ProjectGroup> {
  const groups = new Map<string, { cwd: string | null; sessions: Array<ZenCliSession> }>();
  for (const session of sessions) {
    const key = session.cwd ?? "";
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { cwd: session.cwd, sessions: [session] });
    else group.sessions.push(session);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

/** `unknownLabel` is the current language's "Unknown folder" (English by default, for tests). */
export function folderName(cwd: string | null, unknownLabel = "Unknown folder"): string {
  if (cwd === null) return unknownLabel;
  const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? cwd;
}
