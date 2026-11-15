// @effect-diagnostics effectFnOpportunity:off - one-line delegations to ToolchainManager.
// Zen Staff: toolchains as an Effect service with RPC handlers; ToolchainManager does the work.
import {
  ZEN_TOOLCHAINS_WS_METHODS,
  ZenToolchainError,
  type ZenAccessOverview,
  type ZenInstallJob,
  type ZenMachineProbe,
  type ZenPrepareThreadInput,
  type ZenPreparedThread,
  type ZenToolchainOverview,
  type ZenToolchainRef,
  type ZenToolchainSettings,
  type ZenWorkflowCompatibility,
  type ZenWorkflowStatusSummary,
  type ZenWorkflowTarget,
} from "@t3tools/contracts/zenToolchains";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import { resolveWorkflowAssetsDir } from "../workflows/workflowAssets.ts";
import { resolveToolchainCatalogDir } from "./catalogAssets.ts";
import { ToolchainFailure, ToolchainManager, type ManagerOptions } from "./manager.ts";

type Run<A> = Effect.Effect<A, ZenToolchainError>;
type SecretInput = { readonly workflowId: string; readonly secretId: string };
/** Hub v9: which company this server serves the action is for (absent: the first one). */
type CompanyScope = { readonly companyId?: string | null | undefined };
type GrantInput = { readonly packId: string; readonly user: string } & CompanyScope;
type ApproveInstallInput = {
  readonly packId: string;
  readonly adminConfirmed: boolean;
  readonly localCompanyId?: string | null | undefined;
} & CompanyScope;

export class ZenToolchains extends Context.Service<
  ZenToolchains,
  {
    readonly probe: (input: { readonly refresh?: boolean | undefined }) => Run<ZenMachineProbe>;
    readonly checkWorkflows: (input: {
      readonly companyId?: string | null | undefined;
      readonly requester?: string | null | undefined;
      readonly locale?: "en" | "ro" | undefined;
    }) => Run<ReadonlyArray<ZenWorkflowStatusSummary>>;
    readonly checkWorkflow: (input: ZenWorkflowTarget) => Run<ZenWorkflowCompatibility>;
    readonly install: (input: ZenWorkflowTarget) => Run<ZenInstallJob>;
    readonly job: (input: { readonly jobId: string }) => Run<ZenInstallJob>;
    readonly cancel: (input: { readonly jobId: string }) => Run<ZenInstallJob>;
    readonly overview: Run<ZenToolchainOverview>;
    readonly verify: (input: ZenToolchainRef) => Run<ZenToolchainOverview>;
    readonly remove: (input: ZenToolchainRef) => Run<ZenToolchainOverview>;
    readonly cleanup: Run<ZenToolchainOverview>;
    readonly setSettings: (input: ZenToolchainSettings) => Run<ZenToolchainOverview>;
    readonly prepareThread: (input: ZenPrepareThreadInput) => Run<ZenPreparedThread>;
    readonly access: (input: CompanyScope) => Run<ZenAccessOverview>;
    readonly setSecret: (input: SecretInput & { readonly value: string }) => Run<ZenAccessOverview>;
    readonly removeSecret: (input: SecretInput) => Run<ZenAccessOverview>;
    readonly grant: (
      input: GrantInput & { readonly adminConfirmed: boolean },
    ) => Run<ZenAccessOverview>;
    readonly revoke: (input: GrantInput) => Run<ZenAccessOverview>;
    readonly approveInstall: (input: ApproveInstallInput) => Run<ZenAccessOverview>;
  }
>()("t3/zen/toolchains/ZenToolchains") {}

const toError = (error: unknown): ZenToolchainError =>
  error instanceof ToolchainFailure
    ? new ZenToolchainError({ reason: error.reason, detail: error.message })
    : new ZenToolchainError({
        reason: "io",
        detail: error instanceof Error ? error.message : String(error),
      });

const call = <A>(run: () => Promise<A>): Run<A> => Effect.tryPromise({ try: run, catch: toError });

const make = Effect.fn("ZenToolchains.make")(function* (options: Partial<ManagerOptions> = {}) {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const here = import.meta.dirname;
  // Same folder ZenOffice uses (source, or the embedded copy in packaged builds).
  const workflowsAssetsDir = yield* resolveWorkflowAssetsDir(config.baseDir).pipe(
    Effect.orElseSucceed(() => path.join(here, "..", "workflows")),
  );
  // Source folder, or the catalog embedded in packaged builds (catalogAssets.gen.ts).
  const catalogDir = yield* resolveToolchainCatalogDir(config.baseDir).pipe(
    Effect.orElseSucceed(() => path.join(here, "catalog")),
  );
  const manager = new ToolchainManager({
    zenHome: config.baseDir,
    stateDir: config.stateDir,
    platform,
    arch,
    catalogDir,
    workflowsAssetsDir,
    ...options,
  });
  yield* Effect.promise(() => manager.init());
  manager.startBackground();
  yield* Effect.addFinalizer(() => Effect.sync(() => manager.dispose()));

  return ZenToolchains.of({
    probe: (input) => call(() => manager.probe(input.refresh === true)),
    checkWorkflows: (input) =>
      call(() => manager.checkWorkflows(input.companyId, input.requester, input.locale)),
    checkWorkflow: (input) => call(() => manager.checkWorkflow(input)),
    install: (input) => call(() => manager.install(input)),
    job: (input) => call(async () => manager.job(input.jobId)),
    cancel: (input) => call(async () => manager.cancel(input.jobId)),
    overview: call(() => manager.overview()),
    verify: (input) => call(() => manager.verify(input)),
    remove: (input) => call(() => manager.remove(input)),
    cleanup: call(() => manager.cleanup()),
    setSettings: (input) => call(() => manager.setSettings(input)),
    prepareThread: (input) => call(() => manager.prepareThread(input)),
    access: (input) => call(() => manager.accessOverview(input)),
    setSecret: (input) => call(() => manager.setSecret(input)),
    removeSecret: (input) => call(() => manager.removeSecret(input)),
    grant: (input) => call(() => manager.grant(input)),
    revoke: (input) => call(() => manager.revoke(input)),
    approveInstall: (input) => call(() => manager.approveInstall(input)),
  });
});

export const layer = Layer.effect(ZenToolchains, make());

/** RPC handlers for ws.ts, kept here so the upstream file only spreads them in. */
export const wsHandlers = (service: Option.Option<ZenToolchains["Service"]>) => {
  const unavailable = Effect.fail(
    new ZenToolchainError({
      reason: "unavailable",
      detail: "Tools are not available on this server.",
    }),
  );
  const run = <A>(fn: (toolchains: ZenToolchains["Service"]) => Run<A>) =>
    Option.isSome(service) ? fn(service.value) : unavailable;
  const M = ZEN_TOOLCHAINS_WS_METHODS;
  return {
    [M.probe]: (input: { readonly refresh?: boolean | undefined }) => run((t) => t.probe(input)),
    [M.checkWorkflows]: (input: {
      readonly companyId?: string | null | undefined;
      readonly requester?: string | null | undefined;
      readonly locale?: "en" | "ro" | undefined;
    }) => run((t) => t.checkWorkflows(input)),
    [M.checkWorkflow]: (input: ZenWorkflowTarget) => run((t) => t.checkWorkflow(input)),
    [M.install]: (input: ZenWorkflowTarget) => run((t) => t.install(input)),
    [M.job]: (input: { readonly jobId: string }) => run((t) => t.job(input)),
    [M.cancel]: (input: { readonly jobId: string }) => run((t) => t.cancel(input)),
    [M.overview]: (_input: {}) => run((t) => t.overview),
    [M.verify]: (input: ZenToolchainRef) => run((t) => t.verify(input)),
    [M.remove]: (input: ZenToolchainRef) => run((t) => t.remove(input)),
    [M.cleanup]: (_input: {}) => run((t) => t.cleanup),
    [M.setSettings]: (input: ZenToolchainSettings) => run((t) => t.setSettings(input)),
    [M.prepareThread]: (input: ZenPrepareThreadInput) => run((t) => t.prepareThread(input)),
    [M.access]: (input: CompanyScope) => run((t) => t.access(input)),
    [M.setSecret]: (input: SecretInput & { readonly value: string }) =>
      run((t) => t.setSecret(input)),
    [M.removeSecret]: (input: SecretInput) => run((t) => t.removeSecret(input)),
    [M.grant]: (input: GrantInput & { readonly adminConfirmed: boolean }) =>
      run((t) => t.grant(input)),
    [M.revoke]: (input: GrantInput) => run((t) => t.revoke(input)),
    [M.approveInstall]: (input: ApproveInstallInput) => run((t) => t.approveInstall(input)),
  };
};
