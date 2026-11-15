// Zen Staff: toolchains on the web: RPC atoms and a small promise helper for the Preparing step,
// the Office badges, the marketplace requirements and Settings > Tools. ZEN.md, "Toolchains for
// workflows".
import {
  type AtomCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_TOOLCHAINS_WS_METHODS,
  type ZenToolchainStatus,
} from "@t3tools/contracts/zenToolchains";

import { useAtomValue } from "@effect/atom-react";
import { ZEN_HUB_WS_METHODS, type ZenHubStatus } from "@t3tools/contracts/zenHub";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { appAtomRegistry } from "../../rpc/atomRegistry";

const M = ZEN_TOOLCHAINS_WS_METHODS;

/** Badges on the Office home: one call per environment and company. */
export const toolchainStatuses = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-toolchains:statuses",
  tag: M.checkWorkflows,
  staleTimeMs: 15_000,
  idleTtlMs: 120_000,
});

/** One workflow or pack (marketplace requirements before install). */
export const toolchainCheck = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-toolchains:check-one",
  tag: M.checkWorkflow,
  staleTimeMs: 30_000,
  idleTtlMs: 120_000,
});

/** The machine probe, to find connected machines marked as the company server. */
export const toolchainProbe = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-toolchains:probe",
  tag: M.probe,
  staleTimeMs: 60_000,
  idleTtlMs: 300_000,
});

export const toolchainAccess = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-toolchains:access",
  tag: M.access,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

export const toolchainOverview = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-toolchains:overview",
  tag: M.overview,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

const commands = {
  probe: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:probe",
    tag: M.probe,
  }),
  checkWorkflow: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:check",
    tag: M.checkWorkflow,
  }),
  install: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:install",
    tag: M.install,
  }),
  job: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:job",
    tag: M.job,
  }),
  cancel: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:cancel",
    tag: M.cancel,
  }),
  verify: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:verify",
    tag: M.verify,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:remove",
    tag: M.remove,
  }),
  cleanup: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:cleanup",
    tag: M.cleanup,
  }),
  setSettings: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:settings",
    tag: M.setSettings,
  }),
  access: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:access",
    tag: M.access,
  }),
  setSecret: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:setSecret",
    tag: M.setSecret,
  }),
  removeSecret: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:removeSecret",
    tag: M.removeSecret,
  }),
  grant: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:grant",
    tag: M.grant,
  }),
  revoke: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:revoke",
    tag: M.revoke,
  }),
  approveInstall: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:approveInstall",
    tag: M.approveInstall,
  }),
  prepareThread: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:zen-toolchains:prepare-thread",
    tag: M.prepareThread,
  }),
};

type Commands = typeof commands;
type AnyCommand<W> = AtomCommand<W, any, any>;
type InputOf<K extends keyof Commands> =
  Commands[K] extends AnyCommand<infer W>
    ? W extends { readonly input: infer I }
      ? I
      : never
    : never;
type OutputOf<K extends keyof Commands> =
  Commands[K] extends AtomCommand<any, infer A, any> ? A : never;

export type CallResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: string };

/** Runs one toolchain RPC on an environment; failures come back as a plain message. */
export async function callToolchains<K extends keyof Commands>(
  name: K,
  environmentId: EnvironmentId,
  input: InputOf<K>,
): Promise<CallResult<OutputOf<K>>> {
  // The command map is homogeneous in shape; the casts keep one helper for all of them.
  const command = commands[name] as unknown as Parameters<typeof runAtomCommand>[1];
  const result = await runAtomCommand(
    appAtomRegistry,
    command,
    { environmentId, input },
    { label: `Tools: ${name}`, reportFailure: false },
  );
  if (result._tag === "Success") return { ok: true, value: result.value as OutputOf<K> };
  const error = squashAtomCommandFailure(result);
  return {
    ok: false,
    error:
      error instanceof Error && error.message
        ? error.message
        : typeof error === "object" && error !== null && "detail" in error
          ? String((error as { detail: unknown }).detail)
          : "Something went wrong.",
  };
}

export function refreshToolchainViews(environmentId: EnvironmentId, companyId: string | null) {
  appAtomRegistry.refresh(toolchainStatuses({ environmentId, input: { companyId } }));
  appAtomRegistry.refresh(toolchainOverview({ environmentId, input: {} }));
}

export const STATUS_BADGES: Record<
  ZenToolchainStatus,
  { readonly label: string; readonly variant: "success" | "warning" | "error" | "info" }
> = {
  ready: { label: "Ready", variant: "success" },
  slow: { label: "Slow here", variant: "info" },
  "needs-install": { label: "Setup needed", variant: "warning" },
  updating: { label: "Setup needed", variant: "warning" },
  "not-compatible": { label: "Not supported here", variant: "error" },
};

/**
 * Who is starting a workflow: the hub account of this window's primary machine, or null without
 * a hub. The runner checks its own grants for this name; it is a claim, not a proof (ZEN.md).
 */
export function useZenRequester(): string | null {
  const environmentId = usePrimaryEnvironmentId();
  return useRequesterFor(environmentId);
}

function useRequesterFor(environmentId: EnvironmentId | null): string | null {
  const result = useAtomValue(
    environmentId === null
      ? noHubAtom
      : hubStatus({ environmentId, input: { op: "status", input: {} } }),
  );
  if (!AsyncResult.isSuccess(result)) return null;
  const status = result.value as ZenHubStatus | null;
  return status?.user?.email?.toLowerCase() ?? null;
}

/** The hub status (who is signed in), read the same way the Team page does. */
const hubStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-toolchains:hub-status",
  tag: ZEN_HUB_WS_METHODS.call,
  staleTimeMs: 60_000,
  idleTtlMs: 300_000,
});

const noHubAtom = Atom.make(AsyncResult.success(null as unknown)).pipe(
  Atom.withLabel("zen-toolchains:no-hub"),
);
