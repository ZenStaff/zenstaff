// Zen Staff hosted memory (zen-memory): settings, search, decisions, promises, GDPR forget, "don't
// save". v4: zones (company/department/project), the person's own memory (companyId "personal"),
// review and correction, rules waiting for confirmation, promotion with consent. See ZEN.md.
// Spread into ZEN_COMPANIES_RPCS (zenCompanies.ts), so upstream maps need no new lines.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { NonNegativeInt } from "./baseSchemas.ts";

export const ZEN_MEMORY_WS_METHODS = {
  settings: "zen.memory.settings",
  configure: "zen.memory.configure",
  test: "zen.memory.test",
  search: "zen.memory.search",
  decisions: "zen.memory.decisions",
  promises: "zen.memory.promises",
  entity: "zen.memory.entity",
  forget: "zen.memory.forget",
  threadState: "zen.memory.threadState",
  setThreadSkip: "zen.memory.setThreadSkip",
  // v4
  zones: "zen.memory.zones",
  facts: "zen.memory.facts",
  factAction: "zen.memory.factAction",
  pendingRules: "zen.memory.pendingRules",
  decideRule: "zen.memory.decideRule",
  forgetPerson: "zen.memory.forgetPerson",
} as const;

/** Where a fact lives: the whole company, a department, a project, or the person's own memory. */
export const ZenMemoryZoneRef = Schema.Struct({
  ref: Schema.String,
  kind: Schema.Literals(["company", "team", "project", "personal"]),
  name: Schema.String,
});
export type ZenMemoryZoneRef = typeof ZenMemoryZoneRef.Type;

/** The model that writes conversation summaries (cheap; summaries are short). */
export const ZEN_MEMORY_SUMMARY_MODEL = "claude-haiku-5-5";

const CompanyId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(64),
);
const ThreadIdString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const ZenMemoryLastSave = Schema.Struct({
  at: Schema.String,
  /** accepted | skipped | duplicate | queued | failed | nothing (no business content). */
  status: Schema.String,
  detail: Schema.NullOr(Schema.String),
});
export type ZenMemoryLastSave = typeof ZenMemoryLastSave.Type;

/** Hosted company memory offered by the hub (hub v13); null without a hub link. */
export const ZenMemoryHosted = Schema.Struct({
  /** The hub can give this company hosted memory (our hosted hub). */
  available: Schema.Boolean,
  /** An owner/admin turned it on once. */
  activated: Schema.Boolean,
  /** The company's memory is the hosted one (its address on the hub is the hosted address). */
  active: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
});
export type ZenMemoryHosted = typeof ZenMemoryHosted.Type;

export const ZenMemorySettings = Schema.Struct({
  companyId: CompanyId,
  /** Personal never uses company memory. */
  available: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
  hasKey: Schema.Boolean,
  /** Where the key is kept: the OS keychain or an owner-only file next to the vault. */
  keyStore: Schema.NullOr(Schema.Literals(["keychain", "file"])),
  /** Connected = URL and key are set. */
  connected: Schema.Boolean,
  saveConversations: Schema.Boolean,
  /** Summaries waiting to be sent (quota, network). */
  pendingCount: NonNegativeInt,
  /** When the queue retries next (after a 429's Retry-After). */
  nextRetryAt: Schema.NullOr(Schema.String),
  lastSave: Schema.NullOr(ZenMemoryLastSave),
  /** "hub" when the company's hub sets the address and the save switch (the key stays here). */
  managedBy: Schema.optional(Schema.NullOr(Schema.Literal("hub"))),
  /** This person's hub role in the linked hub company; null/absent without a hub link. */
  hubRole: Schema.optional(Schema.NullOr(Schema.Literals(["owner", "admin", "member", "guest"]))),
  /** Hosted memory from the hub; this machine gets its own key from the hub automatically. */
  hosted: Schema.optional(Schema.NullOr(ZenMemoryHosted)),
  /** Why this machine has no hosted key yet (hub answer), when hosted memory is active. */
  hostedError: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenMemorySettings = typeof ZenMemorySettings.Type;

export const ZenMemoryCompanyInput = Schema.Struct({ companyId: CompanyId });
export type ZenMemoryCompanyInput = typeof ZenMemoryCompanyInput.Type;

export const ZenMemoryConfigureInput = Schema.Struct({
  companyId: CompanyId,
  /** http(s) URL of the zen-memory server; "" removes the connection. */
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  /** A new API key; "" removes the stored key; omitted keeps it. Never returned. */
  apiKey: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
  saveConversations: Schema.optional(Schema.Boolean),
  /** Owners/admins of a hub company: turn on the hosted memory (the hub creates it once). */
  activateHosted: Schema.optional(Schema.Boolean),
});
export type ZenMemoryConfigureInput = typeof ZenMemoryConfigureInput.Type;

export const ZenMemoryTestInput = Schema.Struct({
  companyId: CompanyId,
  /** Test these values before saving them; omitted uses the saved ones. */
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  apiKey: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
});
export type ZenMemoryTestInput = typeof ZenMemoryTestInput.Type;

export const ZenMemoryQuota = Schema.Struct({
  name: Schema.String,
  limit: Schema.Number,
  used: Schema.Number,
  resetsAt: Schema.NullOr(Schema.String),
});
export type ZenMemoryQuota = typeof ZenMemoryQuota.Type;

export const ZenMemoryTestResult = Schema.Struct({
  ok: Schema.Boolean,
  companyName: Schema.NullOr(Schema.String),
  /** Counts of the company's graph (entities, facts, episodes) as the server names them. */
  graph: Schema.Record(Schema.String, Schema.Number),
  quotas: Schema.Array(ZenMemoryQuota),
  error: Schema.NullOr(Schema.String),
});
export type ZenMemoryTestResult = typeof ZenMemoryTestResult.Type;

export const ZenMemorySource = Schema.Struct({
  threadId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  user: Schema.NullOr(Schema.String),
  machine: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  at: Schema.NullOr(Schema.String),
});
export type ZenMemorySource = typeof ZenMemorySource.Type;

export const ZenMemoryRef = Schema.Struct({ id: Schema.String, name: Schema.String });
export type ZenMemoryRef = typeof ZenMemoryRef.Type;

/** A fact, decision or promise, as the app shows it (camelCase of the zen-memory contract). */
export const ZenMemoryFact = Schema.Struct({
  id: Schema.String,
  /** Decision, Promise, or a plain relation name. */
  type: Schema.String,
  fact: Schema.String,
  validFrom: Schema.NullOr(Schema.String),
  validTo: Schema.NullOr(Schema.String),
  current: Schema.Boolean,
  subject: Schema.NullOr(ZenMemoryRef),
  object: Schema.NullOr(ZenMemoryRef),
  owner: Schema.NullOr(Schema.String),
  promisedTo: Schema.NullOr(Schema.String),
  dueDate: Schema.NullOr(Schema.String),
  decisionDate: Schema.NullOr(Schema.String),
  /** Promise: open | overdue | done | cancelled | superseded; decision: active | reversed | superseded. */
  status: Schema.NullOr(Schema.String),
  sources: Schema.Array(ZenMemorySource),
  /** v4: the zone it came from (absent on older servers). */
  zone: Schema.optional(Schema.NullOr(ZenMemoryZoneRef)),
  /** v4: trusted (said in a chat), untrusted (external content: an observation), confirmed. */
  trust: Schema.optional(Schema.NullOr(Schema.Literals(["trusted", "untrusted", "confirmed"]))),
  /** v4, personal memory: the company this item was sent to. */
  promotedTo: Schema.optional(Schema.NullOr(Schema.String)),
  /** v4: someone marked it wrong. */
  markedWrong: Schema.optional(Schema.Boolean),
});
export type ZenMemoryFact = typeof ZenMemoryFact.Type;

export const ZenMemoryEntity = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  types: Schema.Array(Schema.String),
  summary: Schema.NullOr(Schema.String),
});
export type ZenMemoryEntity = typeof ZenMemoryEntity.Type;

export const ZenMemorySearchInput = Schema.Struct({
  companyId: CompanyId,
  q: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  /** v4: one zone ("company", "team:<id>", "project:<id>"); omitted = every zone you can read. */
  zone: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
  /** v4: also search your own memory (default true when it is on). */
  includePersonal: Schema.optional(Schema.Boolean),
});
export type ZenMemorySearchInput = typeof ZenMemorySearchInput.Type;

export const ZenMemorySearchResult = Schema.Struct({
  facts: Schema.Array(ZenMemoryFact),
  entities: Schema.Array(ZenMemoryEntity),
});
export type ZenMemorySearchResult = typeof ZenMemorySearchResult.Type;

const ZEN_MEMORY_PROMISE_STATUSES = [
  "open",
  "overdue",
  "done",
  "cancelled",
  "superseded",
  "all",
] as const;
export type ZenMemoryPromiseStatus = (typeof ZEN_MEMORY_PROMISE_STATUSES)[number];

export const ZenMemoryListInput = Schema.Struct({
  companyId: CompanyId,
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  /** Promises only. */
  status: Schema.optional(Schema.Literals(ZEN_MEMORY_PROMISE_STATUSES)),
  /** Decisions only. */
  includeSuperseded: Schema.optional(Schema.Boolean),
});
export type ZenMemoryListInput = typeof ZenMemoryListInput.Type;

export const ZenMemoryListResult = Schema.Struct({
  items: Schema.Array(ZenMemoryFact),
  nextCursor: Schema.NullOr(Schema.String),
});
export type ZenMemoryListResult = typeof ZenMemoryListResult.Type;

export const ZenMemoryEntityInput = Schema.Struct({
  companyId: CompanyId,
  entityId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});
export type ZenMemoryEntityInput = typeof ZenMemoryEntityInput.Type;

export const ZenMemoryEntityResult = Schema.Struct({
  entity: ZenMemoryEntity,
  timeline: Schema.Array(ZenMemoryFact),
});
export type ZenMemoryEntityResult = typeof ZenMemoryEntityResult.Type;

export const ZenMemoryForgetInput = Schema.Struct({
  companyId: CompanyId,
  entityId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  /** The person confirmed, as the company's admin on this machine, that this is erased for good. */
  adminConfirmed: Schema.Literal(true),
});
export type ZenMemoryForgetInput = typeof ZenMemoryForgetInput.Type;

export const ZenMemoryForgetResult = Schema.Struct({
  factsDeleted: Schema.Number,
  factsRewritten: Schema.Number,
  summariesRewritten: Schema.Number,
  episodesRedacted: Schema.Number,
});
export type ZenMemoryForgetResult = typeof ZenMemoryForgetResult.Type;

const ZoneString = Schema.String.check(Schema.isMaxLength(120));
const FactId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const ZenMemoryZone = Schema.Struct({
  ref: Schema.String,
  kind: Schema.Literals(["company", "team", "project", "personal"]),
  name: Schema.String,
  archived: Schema.Boolean,
  parentRef: Schema.NullOr(Schema.String),
  facts: Schema.Number,
  /** Owners/admins only: hub user ids that read the zone. */
  readers: Schema.optional(Schema.Array(Schema.String)),
});
export type ZenMemoryZone = typeof ZenMemoryZone.Type;

export const ZenMemoryZonesResult = Schema.Struct({
  zones: Schema.Array(ZenMemoryZone),
  admin: Schema.Boolean,
  rules: Schema.NullOr(
    Schema.Struct({ autoPromoteDecisions: Schema.Boolean, sensitivePolicy: Schema.String }),
  ),
});
export type ZenMemoryZonesResult = typeof ZenMemoryZonesResult.Type;

export const ZenMemoryFactsInput = Schema.Struct({
  companyId: CompanyId,
  zone: Schema.optional(ZoneString),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type ZenMemoryFactsInput = typeof ZenMemoryFactsInput.Type;

export const ZenMemoryFactActionInput = Schema.Struct({
  companyId: CompanyId,
  factId: FactId,
  zone: Schema.optional(ZoneString),
  /** correct (new text), wrong (ends it, kept as history), delete, promote (personal -> company). */
  action: Schema.Literals(["correct", "wrong", "delete", "promote"]),
  text: Schema.optional(Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(2000))),
  /** promote: the company (local id) and its zone. */
  targetCompanyId: Schema.optional(CompanyId),
  targetZone: Schema.optional(ZoneString),
  /** promote: the person agreed. */
  consent: Schema.optional(Schema.Boolean),
});
export type ZenMemoryFactActionInput = typeof ZenMemoryFactActionInput.Type;

export const ZenMemoryFactActionResult = Schema.Struct({
  ok: Schema.Boolean,
  fact: Schema.NullOr(ZenMemoryFact),
  detail: Schema.NullOr(Schema.String),
});
export type ZenMemoryFactActionResult = typeof ZenMemoryFactActionResult.Type;

export const ZenMemoryPendingRule = Schema.Struct({
  id: Schema.String,
  zone: Schema.String,
  text: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
});
export type ZenMemoryPendingRule = typeof ZenMemoryPendingRule.Type;

export const ZenMemoryPendingRulesResult = Schema.Struct({
  rules: Schema.Array(ZenMemoryPendingRule),
});
export type ZenMemoryPendingRulesResult = typeof ZenMemoryPendingRulesResult.Type;

export const ZenMemoryDecideRuleInput = Schema.Struct({
  companyId: CompanyId,
  ruleId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  decision: Schema.Literals(["confirm", "reject"]),
});
export type ZenMemoryDecideRuleInput = typeof ZenMemoryDecideRuleInput.Type;

export const ZenMemoryForgetPersonInput = Schema.Struct({
  companyId: CompanyId,
  name: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  adminConfirmed: Schema.Literal(true),
});
export type ZenMemoryForgetPersonInput = typeof ZenMemoryForgetPersonInput.Type;

export const ZenMemoryForgetPersonResult = Schema.Struct({
  zones: Schema.Array(Schema.String),
  factsDeleted: Schema.Number,
});
export type ZenMemoryForgetPersonResult = typeof ZenMemoryForgetPersonResult.Type;

export const ZenMemoryThreadInput = Schema.Struct({ threadId: ThreadIdString });
export type ZenMemoryThreadInput = typeof ZenMemoryThreadInput.Type;

export const ZenMemoryThreadState = Schema.Struct({
  threadId: ThreadIdString,
  /** The thread's company when it is one with company memory, else null. */
  companyId: Schema.NullOr(Schema.String),
  /** Company memory is connected and saving is on for that company. */
  saving: Schema.Boolean,
  /** "Don't save this chat". */
  skip: Schema.Boolean,
  lastSave: Schema.NullOr(ZenMemoryLastSave),
});
export type ZenMemoryThreadState = typeof ZenMemoryThreadState.Type;

export const ZenMemorySetThreadSkipInput = Schema.Struct({
  threadId: ThreadIdString,
  skip: Schema.Boolean,
});
export type ZenMemorySetThreadSkipInput = typeof ZenMemorySetThreadSkipInput.Type;

export class ZenMemoryError extends Schema.TaggedError<ZenMemoryError>()("ZenMemoryError", {
  reason: Schema.Literals([
    "not-configured",
    "personal",
    "invalid-input",
    "unauthorized",
    "quota",
    "not-found",
    "unreachable",
    "server",
    "admin-required",
    "unavailable",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const RpcError = Schema.Union([ZenMemoryError, EnvironmentAuthorizationError]);

export const ZEN_MEMORY_RPCS = [
  Rpc.make(ZEN_MEMORY_WS_METHODS.settings, {
    payload: ZenMemoryCompanyInput,
    success: ZenMemorySettings,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.configure, {
    payload: ZenMemoryConfigureInput,
    success: ZenMemorySettings,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.test, {
    payload: ZenMemoryTestInput,
    success: ZenMemoryTestResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.search, {
    payload: ZenMemorySearchInput,
    success: ZenMemorySearchResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.decisions, {
    payload: ZenMemoryListInput,
    success: ZenMemoryListResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.promises, {
    payload: ZenMemoryListInput,
    success: ZenMemoryListResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.entity, {
    payload: ZenMemoryEntityInput,
    success: ZenMemoryEntityResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.forget, {
    payload: ZenMemoryForgetInput,
    success: ZenMemoryForgetResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.threadState, {
    payload: ZenMemoryThreadInput,
    success: ZenMemoryThreadState,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.setThreadSkip, {
    payload: ZenMemorySetThreadSkipInput,
    success: ZenMemoryThreadState,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.zones, {
    payload: ZenMemoryCompanyInput,
    success: ZenMemoryZonesResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.facts, {
    payload: ZenMemoryFactsInput,
    success: ZenMemoryListResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.factAction, {
    payload: ZenMemoryFactActionInput,
    success: ZenMemoryFactActionResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.pendingRules, {
    payload: ZenMemoryCompanyInput,
    success: ZenMemoryPendingRulesResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.decideRule, {
    payload: ZenMemoryDecideRuleInput,
    success: ZenMemoryPendingRulesResult,
    error: RpcError,
  }),
  Rpc.make(ZEN_MEMORY_WS_METHODS.forgetPerson, {
    payload: ZenMemoryForgetPersonInput,
    success: ZenMemoryForgetPersonResult,
    error: RpcError,
  }),
] as const;

export const ZEN_MEMORY_RPC_SCOPES = {
  [ZEN_MEMORY_WS_METHODS.settings]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.configure]: AuthOrchestrationOperateScope,
  [ZEN_MEMORY_WS_METHODS.test]: AuthOrchestrationOperateScope,
  [ZEN_MEMORY_WS_METHODS.search]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.decisions]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.promises]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.entity]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.forget]: AuthOrchestrationOperateScope,
  [ZEN_MEMORY_WS_METHODS.threadState]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.setThreadSkip]: AuthOrchestrationOperateScope,
  [ZEN_MEMORY_WS_METHODS.zones]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.facts]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.factAction]: AuthOrchestrationOperateScope,
  [ZEN_MEMORY_WS_METHODS.pendingRules]: AuthOrchestrationReadScope,
  [ZEN_MEMORY_WS_METHODS.decideRule]: AuthOrchestrationOperateScope,
  [ZEN_MEMORY_WS_METHODS.forgetPerson]: AuthOrchestrationOperateScope,
} as const;

export const ZEN_MEMORY_RPC_AGGREGATES = {
  [ZEN_MEMORY_WS_METHODS.settings]: "zen",
  [ZEN_MEMORY_WS_METHODS.configure]: "zen",
  [ZEN_MEMORY_WS_METHODS.test]: "zen",
  [ZEN_MEMORY_WS_METHODS.search]: "zen",
  [ZEN_MEMORY_WS_METHODS.decisions]: "zen",
  [ZEN_MEMORY_WS_METHODS.promises]: "zen",
  [ZEN_MEMORY_WS_METHODS.entity]: "zen",
  [ZEN_MEMORY_WS_METHODS.forget]: "zen",
  [ZEN_MEMORY_WS_METHODS.threadState]: "zen",
  [ZEN_MEMORY_WS_METHODS.setThreadSkip]: "zen",
  [ZEN_MEMORY_WS_METHODS.zones]: "zen",
  [ZEN_MEMORY_WS_METHODS.facts]: "zen",
  [ZEN_MEMORY_WS_METHODS.factAction]: "zen",
  [ZEN_MEMORY_WS_METHODS.pendingRules]: "zen",
  [ZEN_MEMORY_WS_METHODS.decideRule]: "zen",
  [ZEN_MEMORY_WS_METHODS.forgetPerson]: "zen",
} as const;
