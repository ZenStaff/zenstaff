// Zen Staff company memory: the RPC atoms and commands the web app uses.
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { ZEN_MEMORY_WS_METHODS } from "@t3tools/contracts/zenMemory";

import { connectionAtomRuntime } from "../../connection/runtime";

export const memorySettings = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:settings",
  tag: ZEN_MEMORY_WS_METHODS.settings,
  staleTimeMs: 10_000,
  idleTtlMs: 60_000,
});

export const memoryThreadState = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:thread-state",
  tag: ZEN_MEMORY_WS_METHODS.threadState,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});

/** First pages of decisions and promises; "Load more" fetches the next ones with the commands. */
export const memoryDecisionsPage = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:decisions-page",
  tag: ZEN_MEMORY_WS_METHODS.decisions,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});

export const memoryPromisesPage = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:promises-page",
  tag: ZEN_MEMORY_WS_METHODS.promises,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});

export const memoryConfigure = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:configure",
  tag: ZEN_MEMORY_WS_METHODS.configure,
});

export const memoryTest = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:test",
  tag: ZEN_MEMORY_WS_METHODS.test,
});

export const memorySearch = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:search",
  tag: ZEN_MEMORY_WS_METHODS.search,
});

export const memoryDecisions = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:decisions",
  tag: ZEN_MEMORY_WS_METHODS.decisions,
});

export const memoryPromises = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:promises",
  tag: ZEN_MEMORY_WS_METHODS.promises,
});

export const memoryForget = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:forget",
  tag: ZEN_MEMORY_WS_METHODS.forget,
});

export const memorySetThreadSkip = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:set-thread-skip",
  tag: ZEN_MEMORY_WS_METHODS.setThreadSkip,
});

// v4: zones, "Ce știe memoria", rules waiting for confirmation, erasing a person.
export const memoryZones = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:zones",
  tag: ZEN_MEMORY_WS_METHODS.zones,
  staleTimeMs: 30_000,
  idleTtlMs: 60_000,
});

export const memoryFactsPage = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:facts-page",
  tag: ZEN_MEMORY_WS_METHODS.facts,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});

export const memoryPendingRules = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-memory:pending-rules",
  tag: ZEN_MEMORY_WS_METHODS.pendingRules,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});

export const memoryFacts = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:facts",
  tag: ZEN_MEMORY_WS_METHODS.facts,
});

export const memoryFactAction = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:fact-action",
  tag: ZEN_MEMORY_WS_METHODS.factAction,
});

export const memoryDecideRule = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:decide-rule",
  tag: ZEN_MEMORY_WS_METHODS.decideRule,
});

export const memoryForgetPerson = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-memory:forget-person",
  tag: ZEN_MEMORY_WS_METHODS.forgetPerson,
});
