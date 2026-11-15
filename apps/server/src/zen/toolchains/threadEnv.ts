// @effect-diagnostics nodeBuiltinImport:off - read synchronously while the adapter builds query options.
// Zen Staff: the hook ClaudeAdapterV2 calls when it starts Claude Code for a thread. A prepared
// workflow thread gets its tool launchers first on PATH, ZEN_TOOL_* variables and permission
// rules (flag settings). A module-level resolver keeps the adapter free of a new service; the
// environment is fixed when the process starts, so threads are prepared before their first turn.

import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

export interface ZenThreadToolchain {
  readonly env: Readonly<Record<string, string>>;
  /** Folder of the thread's launchers, prepended to PATH (null: no launchers). */
  readonly pathFirst: string | null;
  readonly permissions: {
    readonly allow: ReadonlyArray<string>;
    readonly deny: ReadonlyArray<string>;
  };
}

type Resolver = (threadId: string) => ZenThreadToolchain | null;

let resolver: Resolver = () => null;

export function setZenToolchainThreadResolver(next: Resolver | null): void {
  resolver = next ?? (() => null);
}

function lookup(threadId: string): ZenThreadToolchain | null {
  try {
    return resolver(threadId);
  } catch {
    return null;
  }
}

/**
 * Other Zen features that add variables to a thread's process (the hub's company API key for
 * company chats on a company runner). Each returns null when it has nothing for that thread.
 */
type EnvContributor = (
  threadId: string,
  projectId: string | undefined,
) => Readonly<Record<string, string>> | null;
const contributors = new Map<string, EnvContributor>();

export function setZenThreadEnvContributor(name: string, contributor: EnvContributor | null): void {
  if (contributor === null) contributors.delete(name);
  else contributors.set(name, contributor);
}

function contributed(threadId: string, projectId: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const contributor of contributors.values()) {
    try {
      Object.assign(env, contributor(threadId, projectId) ?? {});
    } catch {
      // A failing contributor adds nothing.
    }
  }
  return env;
}

/** The thread's prepared toolchain (launchers, ZEN_TASK_DIR), or null. */
export function zenThreadToolchain(threadId: string): ZenThreadToolchain | null {
  return lookup(threadId);
}

/**
 * Other Zen features that add flag settings to a thread's session (AI staff: the shell of a
 * company agent without network, WebFetch denied). Their `env` also goes into the process
 * environment. Each returns null when it has nothing for that thread.
 */
export interface ZenThreadSettingsContribution {
  readonly env: Readonly<Record<string, string>>;
  readonly deny: ReadonlyArray<string>;
}
type SettingsContributor = (
  threadId: string,
  cwd: string | undefined,
) => ZenThreadSettingsContribution | null;
const settingsContributors = new Map<string, SettingsContributor>();

export function setZenThreadSettingsContributor(
  name: string,
  contributor: SettingsContributor | null,
): void {
  if (contributor === null) settingsContributors.delete(name);
  else settingsContributors.set(name, contributor);
}

function contributedSettings(
  threadId: string,
  cwd: string | undefined,
): ZenThreadSettingsContribution | null {
  const env: Record<string, string> = {};
  const deny: string[] = [];
  let any = false;
  for (const contributor of settingsContributors.values()) {
    let contribution: ZenThreadSettingsContribution | null = null;
    try {
      contribution = contributor(threadId, cwd);
    } catch {
      contribution = null;
    }
    if (contribution === null) continue;
    any = true;
    Object.assign(env, contribution.env);
    deny.push(...contribution.deny);
  }
  return any ? { env, deny } : null;
}

/** The process environment for a thread's Claude Code process. */
export function withZenToolchainEnv(
  threadId: string,
  baseEnvironment: NodeJS.ProcessEnv,
  unattended: ZenUnattendedTurn | null = null,
  projectId?: string,
  cwd?: string,
): NodeJS.ProcessEnv {
  const extra = {
    ...contributed(threadId, projectId),
    ...contributedSettings(threadId, cwd)?.env,
  };
  const environment =
    Object.keys(extra).length === 0 ? baseEnvironment : { ...baseEnvironment, ...extra };
  const prepared = unattended ?? lookup(threadId);
  if (prepared === null) return environment;
  // Windows spells it "Path"; keep whatever spelling the environment already uses.
  const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const current = environment[pathKey];
  if (prepared.pathFirst === null) return { ...environment, ...prepared.env };
  return {
    ...environment,
    ...prepared.env,
    [pathKey]: current
      ? `${prepared.pathFirst}${NodePath.delimiter}${current}`
      : prepared.pathFirst,
  };
}

/**
 * Flag settings for the thread: adds the permission rules and the same PATH/ZEN_TOOL_* values as
 * a settings `env` block (a user's settings.json `env` would otherwise win over the process env).
 * A settings file path (string) cannot take extra keys and goes through unchanged.
 */
export function withZenToolchainSettings<Settings>(
  threadId: string,
  settings: Settings | undefined,
  unattended: ZenUnattendedTurn | null = null,
  cwd?: string,
): Settings | undefined {
  const toolchain = unattended ?? lookup(threadId);
  const extra = contributedSettings(threadId, cwd);
  if ((toolchain === null && extra === null) || typeof settings === "string") return settings;
  const prepared = {
    env: { ...toolchain?.env, ...extra?.env },
    permissions: {
      allow: toolchain?.permissions.allow ?? [],
      deny: [...(toolchain?.permissions.deny ?? []), ...(extra?.deny ?? [])],
    },
  };
  const base = (settings ?? {}) as {
    readonly permissions?: {
      readonly allow?: ReadonlyArray<string>;
      readonly deny?: ReadonlyArray<string>;
    };
    readonly env?: Readonly<Record<string, string>>;
  };
  return {
    ...base,
    env: { ...base.env, ...prepared.env },
    permissions: {
      ...base.permissions,
      allow: [...(base.permissions?.allow ?? []), ...prepared.permissions.allow],
      deny: [...(base.permissions?.deny ?? []), ...prepared.permissions.deny],
    },
  } as unknown as Settings;
}

// Unattended scheduled workflow runs (ZEN.md, "Scheduled workflows"). A scheduled run whose prompt
// names a workflow (`[zen-workflow: <id>]`) and whose workflow declares an `unattended` block runs
// in Claude's dontAsk mode: the declared commands and file work in the task folder are allowed by
// rules, everything else is denied instead of asked (nobody is there to answer).

/** The rules and environment of one unattended turn. */
export interface ZenUnattendedTurn extends ZenThreadToolchain {
  readonly workflowId: string;
}

export interface ZenUnattendedTurnInput {
  readonly threadId: string;
  readonly scheduledTaskId: string;
  readonly prompt: string;
  readonly cwd: string | undefined;
}

type UnattendedResolver = (input: ZenUnattendedTurnInput) => Promise<ZenUnattendedTurn | null>;

let unattendedResolver: UnattendedResolver | null = null;

export function setZenUnattendedResolver(next: UnattendedResolver | null): void {
  unattendedResolver = next;
}

/**
 * The unattended rules for a turn, or null for a normal turn. Only messages the scheduler wrote
 * (`scheduledTaskId`) count, so a person or an agent typing the marker in a chat changes nothing.
 */
export function resolveZenUnattendedTurn(turnInput: {
  readonly appThread: { readonly id: string };
  readonly message: { readonly text: string; readonly scheduledTaskId?: string | null | undefined };
  readonly runtimePolicy: { readonly cwd?: string | null | undefined };
}): Effect.Effect<ZenUnattendedTurn | null> {
  const scheduledTaskId = turnInput.message.scheduledTaskId;
  const resolve = unattendedResolver;
  if (!scheduledTaskId || resolve === null || !turnInput.message.text.includes("[zen-workflow:")) {
    return Effect.succeed(null);
  }
  const input: ZenUnattendedTurnInput = {
    threadId: turnInput.appThread.id,
    scheduledTaskId,
    prompt: turnInput.message.text,
    cwd: turnInput.runtimePolicy.cwd ?? undefined,
  };
  return Effect.promise(() =>
    resolve(input).then(
      (turn) => ({ turn, error: null as unknown }),
      (error: unknown) => ({ turn: null, error }),
    ),
  ).pipe(
    Effect.tap((result) =>
      result.error === null
        ? Effect.void
        : Effect.logWarning(
            "Zen: the unattended rules of a scheduled run could not be read",
            result.error,
          ),
    ),
    Effect.map((result) => result.turn),
  );
}

/**
 * The query policy of an unattended turn: dontAsk (pre-approved rules run, the rest is denied),
 * no permission callback. Plan mode stays as it is (it never runs tools).
 */
export function withZenUnattendedPolicy<
  Policy extends {
    readonly permissionMode: string;
    readonly installPermissionCallback: boolean;
    readonly allowDangerouslySkipPermissions?: true;
  },
>(unattended: ZenUnattendedTurn | null, policy: Policy): Policy {
  if (unattended === null || policy.permissionMode === "plan") return policy;
  const { allowDangerouslySkipPermissions: _bypass, ...rest } = policy;
  return { ...rest, permissionMode: "dontAsk", installPermissionCallback: false } as Policy;
}
