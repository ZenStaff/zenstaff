import { ZEN_SUPPORT_EMAIL, ZEN_SUPPORT_URL } from "@t3tools/contracts/zen";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import { ZEN_TRIAGE_PLAYBOOK } from "../zen/triage/zenTriagePlaybook.ts";

/** Keep TRIAGE_PLAYBOOK byte-identical to .github/triage/PLAYBOOK.md after unescaping backticks and backslashes. */
// Zen: ZED-ZEN support instead of upstream's GitHub (ZEN.md "Triage playbook").
export const TRIAGE_PLAYBOOK = ZEN_TRIAGE_PLAYBOOK;

/** Where the session started: the `t3 triage` CLI, or "Triage an issue" in a client. */
export type TriageEntry =
  | { readonly kind: "cli"; readonly cliVersion: string; readonly launchedAs: string }
  | { readonly kind: "app"; readonly client: string };

/** Windows .cmd shims cannot carry a multiline playbook in argv; point to the file instead. */
export const buildTriageLaunchPrompt = (promptFilePath: string) =>
  `Read the file "${promptFilePath}" and follow its instructions exactly: it is your Zen Staff triage playbook, and it starts with asking the user what went wrong.`;

/**
 * The composer text an in-app session opens with. The file link renders as a
 * chip, and the user writes what went wrong after it, so the first turn
 * already carries the description.
 */
export const buildTriageAppPrompt = (promptFilePath: string) =>
  `Read ${serializeComposerFileLink(promptFilePath)} and follow it. `;

export const buildTriageSeedPrompt = (input: {
  readonly contextFilePath: string;
  readonly entry: TriageEntry;
}) => `A Zen Staff user is having a problem with their install and started this \
session ${input.entry.kind === "cli" ? "with `zs triage`" : "from the Zen Staff app"}.

Machine facts (versions, OS, paths, server liveness) are in the triage context file:

    ${input.contextFilePath}

${
  input.entry.kind === "cli"
    ? "Follow the playbook below, starting by asking the user what went wrong."
    : "Follow the playbook below. The message that sent you here may already describe what went wrong; if it does not, start by asking."
}

---

${TRIAGE_PLAYBOOK}`;

/** A clone the server made before the session started, or why it could not. */
export type TriageSourceClone =
  | {
      readonly _tag: "cloned" | "cloning";
      readonly directory: string;
      readonly ref: string;
      readonly commit: string;
      readonly serverVersion: string;
    }
  | { readonly _tag: "failed"; readonly serverVersion: string; readonly reason: string };

export interface TriageContextInput {
  readonly generatedAt: string;
  readonly entry: TriageEntry;
  readonly os: string;
  readonly nodeVersion: string;
  readonly server: string;
  readonly sourceClone?: TriageSourceClone | undefined;
  readonly paths: {
    readonly stateDir: string;
    readonly dbPath: string;
    readonly settingsPath: string;
    readonly logsDir: string;
    readonly serviceLogPath: string;
    readonly desktopBackendLogGlob: string;
    readonly relayClientLogPath: string;
    readonly serverTracePath: string;
    readonly providerEventLogPath: string;
    readonly terminalLogsDir: string;
    readonly providerStatusCacheDir: string;
    readonly secretsDir: string;
    readonly sourceCacheDir: string;
  };
}

const entryLines = (entry: TriageEntry) =>
  entry.kind === "cli"
    ? {
        generatedBy: "`zs triage`",
        before: `- Triage CLI version: ${entry.cliVersion} (the \`zs\` that ran this command; the bug may have happened on another build)`,
        after: `- CLI launched as: ${entry.launchedAs}`,
      }
    : {
        generatedBy: "the Zen Staff app",
        before: `- Started from: ${entry.client} (the client the user pressed "Triage an issue" in; the bug may have happened on another device)`,
        after: undefined,
      };

const sourceSection = (clone: TriageSourceClone) => {
  if (clone._tag === "failed") {
    return `
## Source

The server could not clone the source for its version (${clone.serverVersion}): ${clone.reason}
Clone it as step 4 describes.
`;
  }
  const verb = clone._tag === "cloned" ? "The server cloned" : "The server is cloning";
  const what =
    clone.ref === "main"
      ? `main, since its version (${clone.serverVersion}) has no release tag`
      : `the source for its own version (${clone.serverVersion})`;
  const wait =
    clone._tag === "cloned"
      ? ""
      : `
The folder appears only when the clone is complete. Wait for it instead of
cloning again. If it has not appeared after a few minutes, clone as step 4
describes.
`;
  return `
## Source

${verb} ${what}:

    ${clone.directory}  (${clone.ref}, commit ${clone.commit})
${wait}
Use it when the bug happened on this server's build. When it happened on another
build, clone that version as step 4 describes.
`;
};

const IN_APP_SECTION = `
## This session runs inside Zen Staff

You are a thread inside the Zen Staff server described above. Stopping,
restarting, or killing that server, its service, or the desktop app ends this
session. When a fix needs one of those, give the user the exact steps and let
them do it. The database is in use by that server: read it, never lock it.
`;

export const buildTriageContext = (input: TriageContextInput) => {
  const entry = entryLines(input.entry);
  return `# Zen Staff triage context

Generated by ${entry.generatedBy} at ${input.generatedAt}.

${entry.before}
- OS: ${input.os}
- Node: ${input.nodeVersion}
${entry.after === undefined ? "" : `${entry.after}\n`}- Server process: ${input.server}
- Support: ${ZEN_SUPPORT_EMAIL}, ${ZEN_SUPPORT_URL}
${input.entry.kind === "app" ? IN_APP_SECTION : ""}${input.sourceClone === undefined ? "" : sourceSection(input.sourceClone)}
## Paths

- State dir: ${input.paths.stateDir}
- Database (SQLite; write only with the user's explicit permission): ${input.paths.dbPath}
- Settings: ${input.paths.settingsPath}
- Logs dir: ${input.paths.logsDir}
- Service log (systemd/launchd service installs only): ${input.paths.serviceLogPath}
- Desktop backend logs (glob; one file per backend plus rotated copies; written only when a backend crashes or fails to start): ${input.paths.desktopBackendLogGlob}
- Zen Hub tunnel log (ndjson; what the server logged about its cloudflared connector, with rotated copies \`.1\` and \`.2\`): ${input.paths.relayClientLogPath}
- Server trace (ndjson): ${input.paths.serverTracePath}
- Provider event log: ${input.paths.providerEventLogPath}
- Terminal logs: ${input.paths.terminalLogsDir}
- Provider status cache: ${input.paths.providerStatusCacheDir}
- Secrets dir (NEVER read this): ${input.paths.secretsDir}
- Source cache dir (clone the repo here): ${input.paths.sourceCacheDir}
`;
};
