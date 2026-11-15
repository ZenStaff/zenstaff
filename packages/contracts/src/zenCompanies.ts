// Zen Staff: companies (workspaces). One user works for several companies; each company groups
// its own projects and gives Claude Code its own memory directory. See ZEN.md.
// Upstream schemas are untouched: the project -> company map lives in Zen's own store.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ZEN_MEMORY_RPCS, ZEN_MEMORY_RPC_AGGREGATES, ZEN_MEMORY_RPC_SCOPES } from "./zenMemory.ts";
import {
  ZEN_ONBOARDING_RPCS,
  ZEN_ONBOARDING_RPC_AGGREGATES,
  ZEN_ONBOARDING_RPC_SCOPES,
} from "./zenOnboarding.ts";
import {
  ZEN_TELEMETRY_RPCS,
  ZEN_TELEMETRY_RPC_AGGREGATES,
  ZEN_TELEMETRY_RPC_SCOPES,
} from "./zenTelemetry.ts";
import {
  ZEN_AI_CONNECT_RPCS,
  ZEN_AI_CONNECT_RPC_AGGREGATES,
  ZEN_AI_CONNECT_RPC_SCOPES,
} from "./zenAiConnect.ts";

// The onboarding interview rides on the companies subpath (no new package export).
export * from "./zenOnboarding.ts";
// "Connect your AI" too.
export * from "./zenAiConnect.ts";

export const ZEN_COMPANIES_WS_METHODS = {
  list: "zen.companies.list",
  create: "zen.companies.create",
  update: "zen.companies.update",
  delete: "zen.companies.delete",
  assignProject: "zen.companies.assignProject",
  assignThread: "zen.companies.assignThread",
  listMemory: "zen.companies.listMemory",
  readMemory: "zen.companies.readMemory",
} as const;

/** The company every project belongs to until it is assigned elsewhere. */
export const ZEN_PERSONAL_COMPANY_ID = "personal";

/** Lowercase slug: letters, digits and single dashes. */
export const ZenCompanyId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(64),
);
export type ZenCompanyId = typeof ZenCompanyId.Type;

/** Icons the company picker offers (lucide names); unknown values render as the default. */
export const ZEN_COMPANY_ICONS = [
  "building",
  "briefcase",
  "store",
  "factory",
  "rocket",
  "user",
  "users",
  "heart",
  "star",
  "code",
] as const;

export const ZEN_COMPANY_COLORS = [
  "#2F6F5E",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#CA8A04",
  "#0891B2",
  "#475569",
] as const;

export const ZenCompanyColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));

export const ZenCompany = Schema.Struct({
  id: ZenCompanyId,
  name: TrimmedNonEmptyString,
  color: ZenCompanyColor,
  icon: Schema.String,
  /** Where Claude Code keeps this company's memory; null leaves Claude Code's own setting. */
  memoryDirectory: Schema.NullOr(Schema.String),
  /** The user-chosen directory; null means the default one. */
  customMemoryDirectory: Schema.NullOr(Schema.String),
  isDefault: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type ZenCompany = typeof ZenCompany.Type;

export const ZenProjectCompany = Schema.Struct({
  projectId: ProjectId,
  companyId: ZenCompanyId,
});
export type ZenProjectCompany = typeof ZenProjectCompany.Type;

/**
 * A thread started while a company was chosen, in a project no company owns (the "No project"
 * home). The company may live on another machine of the same person: the id is the switcher's.
 */
export const ZenThreadCompany = Schema.Struct({
  threadId: ThreadId,
  companyId: ZenCompanyId,
});
export type ZenThreadCompany = typeof ZenThreadCompany.Type;

export const ZenCompaniesListResult = Schema.Struct({
  companies: Schema.Array(ZenCompany),
  /** Explicit assignments; projects not listed belong to the default company. */
  projectCompanies: Schema.Array(ZenProjectCompany),
  /** Thread tags; a project's own company wins. Optional: servers before 0.2.7 omit it. */
  threadCompanies: Schema.optional(Schema.Array(ZenThreadCompany)),
  defaultCompanyId: ZenCompanyId,
});
export type ZenCompaniesListResult = typeof ZenCompaniesListResult.Type;

const MemoryDirectoryInput = Schema.String.check(Schema.isMaxLength(4096));

export const ZenCompanyCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  color: Schema.optional(ZenCompanyColor),
  icon: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
  /** Absolute or `~/` path; omitted uses `<zen home>/companies/<id>/memory`. */
  memoryDirectory: Schema.optional(MemoryDirectoryInput),
});
export type ZenCompanyCreateInput = typeof ZenCompanyCreateInput.Type;

export const ZenCompanyUpdateInput = Schema.Struct({
  id: ZenCompanyId,
  name: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  color: Schema.optional(ZenCompanyColor),
  icon: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
  /** null or "" returns to the default directory. */
  memoryDirectory: Schema.optional(Schema.NullOr(MemoryDirectoryInput)),
});
export type ZenCompanyUpdateInput = typeof ZenCompanyUpdateInput.Type;

export const ZenCompanyDeleteInput = Schema.Struct({ id: ZenCompanyId });
export type ZenCompanyDeleteInput = typeof ZenCompanyDeleteInput.Type;

export const ZenCompanyAssignProjectInput = Schema.Struct({
  projectId: ProjectId,
  companyId: ZenCompanyId,
});
export type ZenCompanyAssignProjectInput = typeof ZenCompanyAssignProjectInput.Type;

/** Personal removes the tag. */
export const ZenCompanyAssignThreadInput = ZenThreadCompany;
export type ZenCompanyAssignThreadInput = typeof ZenCompanyAssignThreadInput.Type;

export const ZenCompanyMemoryFile = Schema.Struct({
  /** Path inside the memory directory, `/`-separated. */
  relativePath: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  modifiedAt: IsoDateTime,
});
export type ZenCompanyMemoryFile = typeof ZenCompanyMemoryFile.Type;

export const ZenCompanyListMemoryInput = Schema.Struct({ companyId: ZenCompanyId });
export type ZenCompanyListMemoryInput = typeof ZenCompanyListMemoryInput.Type;

export const ZenCompanyListMemoryResult = Schema.Struct({
  directory: Schema.NullOr(Schema.String),
  exists: Schema.Boolean,
  files: Schema.Array(ZenCompanyMemoryFile),
});
export type ZenCompanyListMemoryResult = typeof ZenCompanyListMemoryResult.Type;

export const ZenCompanyReadMemoryInput = Schema.Struct({
  companyId: ZenCompanyId,
  relativePath: TrimmedNonEmptyString,
});
export type ZenCompanyReadMemoryInput = typeof ZenCompanyReadMemoryInput.Type;

export const ZenCompanyReadMemoryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  content: Schema.String,
  truncated: Schema.Boolean,
});
export type ZenCompanyReadMemoryResult = typeof ZenCompanyReadMemoryResult.Type;

export class ZenCompaniesError extends Schema.TaggedError<ZenCompaniesError>()(
  "ZenCompaniesError",
  {
    reason: Schema.Literals([
      "not-found",
      "invalid-input",
      "default-company",
      "file-not-found",
      "unavailable",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const RpcError = Schema.Union([ZenCompaniesError, EnvironmentAuthorizationError]);

const ZenCompaniesListRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.list, {
  payload: Schema.Struct({}),
  success: ZenCompaniesListResult,
  error: RpcError,
});

const ZenCompaniesCreateRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.create, {
  payload: ZenCompanyCreateInput,
  success: ZenCompany,
  error: RpcError,
});

const ZenCompaniesUpdateRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.update, {
  payload: ZenCompanyUpdateInput,
  success: ZenCompany,
  error: RpcError,
});

const ZenCompaniesDeleteRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.delete, {
  payload: ZenCompanyDeleteInput,
  success: Schema.Struct({ reassignedProjectCount: NonNegativeInt }),
  error: RpcError,
});

const ZenCompaniesAssignProjectRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.assignProject, {
  payload: ZenCompanyAssignProjectInput,
  success: ZenProjectCompany,
  error: RpcError,
});

const ZenCompaniesAssignThreadRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.assignThread, {
  payload: ZenCompanyAssignThreadInput,
  success: ZenThreadCompany,
  error: RpcError,
});

const ZenCompaniesListMemoryRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.listMemory, {
  payload: ZenCompanyListMemoryInput,
  success: ZenCompanyListMemoryResult,
  error: RpcError,
});

const ZenCompaniesReadMemoryRpc = Rpc.make(ZEN_COMPANIES_WS_METHODS.readMemory, {
  payload: ZenCompanyReadMemoryInput,
  success: ZenCompanyReadMemoryResult,
  error: RpcError,
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_COMPANIES_RPCS = [
  ZenCompaniesListRpc,
  ZenCompaniesCreateRpc,
  ZenCompaniesUpdateRpc,
  ZenCompaniesDeleteRpc,
  ZenCompaniesAssignProjectRpc,
  ZenCompaniesAssignThreadRpc,
  ZenCompaniesListMemoryRpc,
  ZenCompaniesReadMemoryRpc,
  // Hosted company memory (zenMemory.ts) rides on the companies registration.
  ...ZEN_MEMORY_RPCS,
  ...ZEN_ONBOARDING_RPCS,
  // Anonymous usage statistics (zenTelemetry.ts).
  ...ZEN_TELEMETRY_RPCS,
  ...ZEN_AI_CONNECT_RPCS,
] as const;

export const ZEN_COMPANIES_RPC_SCOPES = {
  [ZEN_COMPANIES_WS_METHODS.list]: AuthOrchestrationReadScope,
  [ZEN_COMPANIES_WS_METHODS.create]: AuthOrchestrationOperateScope,
  [ZEN_COMPANIES_WS_METHODS.update]: AuthOrchestrationOperateScope,
  [ZEN_COMPANIES_WS_METHODS.delete]: AuthOrchestrationOperateScope,
  [ZEN_COMPANIES_WS_METHODS.assignProject]: AuthOrchestrationOperateScope,
  [ZEN_COMPANIES_WS_METHODS.assignThread]: AuthOrchestrationOperateScope,
  [ZEN_COMPANIES_WS_METHODS.listMemory]: AuthOrchestrationReadScope,
  [ZEN_COMPANIES_WS_METHODS.readMemory]: AuthOrchestrationReadScope,
  ...ZEN_MEMORY_RPC_SCOPES,
  ...ZEN_ONBOARDING_RPC_SCOPES,
  ...ZEN_TELEMETRY_RPC_SCOPES,
  ...ZEN_AI_CONNECT_RPC_SCOPES,
} as const;

/** Observability aggregate for each method (RpcInstrumentation.ts must name every RPC). */
export const ZEN_COMPANIES_RPC_AGGREGATES = {
  [ZEN_COMPANIES_WS_METHODS.list]: "zen",
  [ZEN_COMPANIES_WS_METHODS.create]: "zen",
  [ZEN_COMPANIES_WS_METHODS.update]: "zen",
  [ZEN_COMPANIES_WS_METHODS.delete]: "zen",
  [ZEN_COMPANIES_WS_METHODS.assignProject]: "zen",
  [ZEN_COMPANIES_WS_METHODS.assignThread]: "zen",
  [ZEN_COMPANIES_WS_METHODS.listMemory]: "zen",
  [ZEN_COMPANIES_WS_METHODS.readMemory]: "zen",
  ...ZEN_MEMORY_RPC_AGGREGATES,
  ...ZEN_ONBOARDING_RPC_AGGREGATES,
  ...ZEN_TELEMETRY_RPC_AGGREGATES,
  ...ZEN_AI_CONNECT_RPC_AGGREGATES,
} as const;
