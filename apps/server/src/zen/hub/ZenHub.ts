// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off processEnvInEffect:off globalDate:off -- The hub client is a promise boundary: the runner socket calls back outside any fiber.
// Zen Staff hub client. This server signs in to a hub (accounts, companies, invitations), keeps an
// outbound runner socket to it, shares chats and answers relay requests for them. Agents only run
// here, never on the hub. See docs/zen-hub.md.
//
// v2: every machine has a device identity (hubCrypto.ts). Relay requests it sends are signed and
// their content sealed to the runner; requests it answers as a runner must be signed by a device
// it trusts (relayTrust.ts), and its answers are sealed back to that device. The hub is the source
// of truth for roles, Enterprise grants (verified here), company memory settings and per-person
// preferences; without a hub every feature keeps its local behaviour (hubBridge.ts).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type ChatAttachment,
  CommandId,
  MessageId,
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import {
  ZEN_HUB_WS_METHODS,
  ZenHubError,
  type ZenHubAiAccount,
  type ZenHubAccess,
  zenHubAccessOfRole,
  type ZenHubCallInput,
  type ZenHubComment,
  type ZenHubNotification,
  type ZenHubShare,
  type ZenHubStatus,
  type ZenHubThreadMessage,
  type ZenHubThreadSnapshot,
} from "@t3tools/contracts/zenHub";
import { ZEN_HUB_DEFAULT_URL } from "@t3tools/contracts/zen";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { zenProjectIdForCwd } from "../memory/companyMemoryMcp.ts";
import {
  setZenThreadEnvContributor,
  setZenThreadSettingsContributor,
} from "../toolchains/threadEnv.ts";
import { SecretVault } from "../toolchains/vault.ts";
import {
  readAttachmentForCopy,
  removeCopiedAttachments,
  storeCopiedAttachment,
} from "./copyAttachments.ts";
import { CompanyHubError, makeCompanyHub } from "./companyHub.ts";
import { companyKeyEnv, companyWorkRefusal, startsCompanyWork } from "./companyAiPolicy.ts";
import {
  companyChatMcpPolicy,
  loadServerConsents,
  parseServerConfirmation,
  readClaudeConfigServerNames,
  saveServerConsents,
  SERVER_BLOCK_MESSAGE,
  serverBlockFor,
  type ServerConsent,
  type ServerConsents,
} from "./serverConsent.ts";
import { setZenCompanyHubBridge } from "./companyPorts.ts";
import {
  isHubManager,
  setZenHubBridge,
  type HostedMemoryStatus,
  type HubAccessLedger,
  type HubRole,
  type PersonalMemoryStatus,
} from "./hubBridge.ts";
import {
  deviceCertMessage,
  fingerprintOf,
  newDeviceIdentity,
  newNonce,
  open,
  responseMessage,
  seal,
  sealContext,
  signRequest,
  signText,
  statementMessage,
  verifyText,
  type DeviceIdentity,
} from "./hubCrypto.ts";
import {
  authorizeRelayRequest,
  emptyHubCache,
  isRunnerOf,
  loadHubState,
  normalizeHubUrl,
  readProjectCompanies,
  runnerCompanyFor,
  runnerInstallApproved,
  runnerLedgerFor,
  runnerLedgerOfHub,
  saveHubState,
  threadKind,
  withRunnerCompanies,
  type HubState,
} from "./hubState.ts";
import {
  HubHttpError,
  hubFetch,
  RunnerRequestError,
  RunnerSocket,
  runnerFetch,
  type RelayFrame,
} from "./hubTransport.ts";
import {
  checkRunnerKeys,
  isApprovedPin,
  pendingRefusal,
  pinFingerprint,
  verifyCommentSignature,
  verifyHubGrants,
  verifyRelayRequest,
  withApprovedDevice,
  withPinnedDevice,
  withRejectedDevice,
  withRevokedDevices,
  type HubGrant,
  type PinnedDevice,
} from "./relayTrust.ts";
import {
  normalizePasskeys,
  passkeyId,
  passkeyLabel,
  passkeyLanguage,
  passkeyPageUrl,
} from "./hubPasskeys.ts";
import {
  attachmentKind,
  buildRows,
  type SnapshotItem,
  type SnapshotMessage,
} from "./richSnapshot.ts";
import { buildCopyEvents, planCopyAttachments } from "./threadCopy.ts";
import * as KnownWorkspaces from "../../workspace/KnownWorkspaces.ts";
import {
  ClientApprovalError,
  defaultApprovalTitle,
  loadApprovalRecords,
  readBrandColor,
  readCompanyLogo,
  readDeliverables,
  saveApprovalRecords,
  type LocalApprovalRecord,
} from "./clientApprovals.ts";
import { handleZenChatRelay } from "../chat/relay.ts";

const VIEW_MESSAGE_LIMIT = 200;
const EXPORT_MESSAGE_LIMIT = 1000;
const LONG_POLL_MS = 25_000;
const LONG_POLL_STEP_MS = 600;
const SYNC_INTERVAL_MS = 60_000;
/** Ops whose input and answer are end-to-end encrypted between the device and the runner. */
const SEALED_OPS = new Set([
  "thread.view",
  "thread.export",
  "thread.prompt",
  "thread.meta",
  "thread.attachment",
  // Hub v6: a member's requests to the company runner (companyHub.ts).
  "staff.list",
  "staff.task",
]);
const TITLE_TTL_MS = 5 * 60_000;
const COMPANY_AI_VAULT = "company-ai";

export class ZenHub extends Context.Service<
  ZenHub,
  {
    readonly call: (input: ZenHubCallInput) => Effect.Effect<unknown, ZenHubError>;
  }
>()("t3/zen/hub/ZenHub") {}

const isZenHubError = Schema.is(ZenHubError);
const fail = (reason: ZenHubError["reason"], detail: string) => new ZenHubError({ reason, detail });

function toZenHubError(cause: unknown): ZenHubError {
  if (isZenHubError(cause)) return cause;
  if (cause instanceof CompanyHubError) {
    return fail(cause.reason === "unavailable" ? "offline" : cause.reason, cause.message);
  }
  if (cause instanceof HubHttpError) {
    if (cause.code === "two_factor_required") return fail("two-factor-required", cause.message);
    if (cause.code === "two_factor_setup_required") {
      return fail("two-factor-setup-required", cause.message);
    }
    const reason: ZenHubError["reason"] =
      cause.status === 401
        ? "not-signed-in"
        : cause.status === 403
          ? "forbidden"
          : cause.status === 404
            ? "not-found"
            : cause.status === 400 ||
                cause.status === 413 ||
                cause.status === 415 ||
                cause.status === 429
              ? "invalid-input"
              : cause.status === 0 || cause.status === 503 || cause.status === 504
                ? "offline"
                : "unavailable";
    return fail(reason, cause.message);
  }
  return fail("unavailable", cause instanceof Error ? cause.message : "The hub request failed.");
}

type Input = Record<string, unknown>;

function asInput(value: unknown): Input {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Input)
    : {};
}

function str(input: Input, key: string, max = 500): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw fail("invalid-input", `${key} is required.`);
  }
  return value.trim();
}

function optStr(input: Input, key: string, max = 500): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw fail("invalid-input", `${key} is not valid.`);
  }
  return value.trim();
}

const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeRuntimeMode = Schema.decodeUnknownOption(RuntimeMode);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sync read of the companies feature's project map, for the per-thread environment hook. */
function readProjectCompaniesSync(file: string): Record<string, string> {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(file, "utf8")) as { projects?: unknown };
    if (typeof raw.projects !== "object" || raw.projects === null) return {};
    return Object.fromEntries(
      Object.entries(raw.projects as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

type RunnerKeys = { readonly signPublicKey: string; readonly boxPublicKey: string };

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const eventSink = yield* EventSink.EventSinkV2;
  const platform = yield* HostProcess.Platform;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  // Optional so tests that build ZenHub alone need no workspace layer (approvals then refuse).
  const knownWorkspaces = yield* Effect.serviceOption(KnownWorkspaces.KnownWorkspaces);

  const zenDir = NodePath.join(serverConfig.stateDir, "zen");
  const stateFile = NodePath.join(zenDir, "hub.json");
  const companiesFile = NodePath.join(zenDir, "companies.json");
  const vault = new SecretVault(
    NodePath.join(zenDir, "hub-vault"),
    platform,
    process.env.ZEN_MEMORY_KEYCHAIN !== "0",
  );
  let state: HubState = yield* Effect.promise(() => loadHubState(stateFile));
  // What each company served here may use for colleagues, as confirmed (review P0-6).
  const consentFile = NodePath.join(zenDir, "company-server.json");
  let consents: ServerConsents = loadServerConsents(consentFile);
  const setConsents = (next: ServerConsents) => {
    consents = next;
    saveServerConsents(consentFile, next);
  };
  const companyServerBlock = (hubCompanyId: string): string | null => {
    const blocked = serverBlockFor({ hubCompanyId, consents, companyAis: state.companyAis });
    return blocked === null ? null : SERVER_BLOCK_MESSAGE[blocked];
  };
  // Default for fresh installs: our hosted hub; ZEN_HUB_URL points it elsewhere (self-host, dev).
  const defaultHubUrl = normalizeHubUrl(process.env.ZEN_HUB_URL || ZEN_HUB_DEFAULT_URL);
  let socket: RunnerSocket | null = null;
  let lastError: string | null = null;
  let writing: Promise<void> = Promise.resolve();
  const seenNonces = new Map<string, number>();
  const runnerKeysByShare = new Map<
    string,
    { environmentId: string; keys: RunnerKeys | null; at: number }
  >();

  const update = (change: (current: HubState) => HubState): Promise<void> => {
    writing = writing.then(async () => {
      state = change(state);
      await saveHubState(stateFile, state);
    });
    return writing;
  };

  const log = (line: string) => {
    void runPromise(Effect.logInfo(line));
  };

  const hubUrl = () => {
    if (state.hubUrl === null) throw fail("not-signed-in", "Sign in to a hub first.");
    return state.hubUrl;
  };
  const token = () => {
    if (state.session === null) throw fail("not-signed-in", "Sign in to a hub first.");
    return state.session.token;
  };
  const hub = <T>(method: string, path: string, body?: unknown, timeoutMs?: number) =>
    hubFetch<T>(hubUrl(), token(), method, path, body, timeoutMs).catch((error: unknown) => {
      if (error instanceof HubHttpError && error.status === 401) {
        // The session ended on the hub (signed out elsewhere, expired): forget it here too.
        void update((current) => ({ ...current, session: null }));
        stopRunner();
      }
      throw error;
    });
  const enc = encodeURIComponent;

  const threadShell = (threadId: string) =>
    runPromise(
      orchestrator.getThreadShell(ThreadId.make(threadId)).pipe(Effect.orElseSucceed(() => null)),
    );

  const currentKind = async (projectId: string) =>
    threadKind({
      projectId,
      projectCompanies: await readProjectCompanies(companiesFile),
      links: state.links,
      runnerCompanyIds: state.runnerCompanyIds,
    });

  /** This machine's runner keys: made with the environment, kept across sign-ins of one account. */
  const runnerIdentity = (): DeviceIdentity | null => state.environment?.keys ?? null;

  const publishRunnerKeys = async () => {
    if (state.environment === null || state.session === null) return;
    let keys = runnerIdentity();
    if (keys === null) {
      const fresh = newDeviceIdentity();
      keys = fresh;
      await update((current) => ({
        ...current,
        environment: current.environment === null ? null : { ...current.environment, keys: fresh },
      }));
    }
    await hub("PUT", `/v1/environments/${enc(state.environment.id)}/keys`, {
      signPublicKey: keys.signPublicKey,
      boxPublicKey: keys.boxPublicKey,
    }).catch((error: unknown) => log(`zen hub: could not publish runner keys: ${String(error)}`));
  };

  /**
   * A device key for this session, registered on the hub. A previous key of the same account on
   * this machine vouches for the new one, so runners that knew the old key accept the new one.
   */
  const registerDevice = async (
    signedIn: { readonly token: string; readonly user: { readonly id: string } },
    environmentId: string | null,
    machineName: string,
  ): Promise<DeviceIdentity> => {
    const device = newDeviceIdentity();
    await hubFetch(hubUrl(), signedIn.token, "POST", "/v1/me/device", {
      signPublicKey: device.signPublicKey,
      boxPublicKey: device.boxPublicKey,
      label: `Zen Staff on ${machineName}`,
      environmentId,
    });
    const previous = state.device;
    if (previous !== null && state.environment?.userId === signedIn.user.id) {
      const signature = signText(
        previous,
        deviceCertMessage({
          userId: signedIn.user.id,
          keyId: device.keyId,
          signPublicKey: device.signPublicKey,
          boxPublicKey: device.boxPublicKey,
        }),
      );
      await hubFetch(
        hubUrl(),
        signedIn.token,
        "POST",
        `/v1/me/devices/${enc(device.keyId)}/certify`,
        {
          signature,
          signerKeyId: previous.keyId,
        },
      ).catch(() => undefined);
    }
    return device;
  };

  const pinOwnDevice = (current: HubState, userId: string, email: string, device: DeviceIdentity) =>
    withPinnedDevice(current.trust, userId, {
      keyId: device.keyId,
      signPublicKey: device.signPublicKey,
      boxPublicKey: device.boxPublicKey,
      via: "own",
      at: new Date().toISOString(),
      label: email,
    });

  const ensureDevice = async (): Promise<DeviceIdentity> => {
    if (state.device !== null) return state.device;
    const session = state.session;
    if (session === null) throw fail("not-signed-in", "Sign in to a hub first.");
    const device = await registerDevice(
      session,
      state.environment?.id ?? null,
      state.environment?.name ?? NodeOS.hostname(),
    );
    await update((current) => ({
      ...current,
      device,
      trust: pinOwnDevice(current, session.user.id, session.user.email, device),
    }));
    return device;
  };

  const mediaDataUrl = (
    attachment: SnapshotMessage["attachments"][number],
    budget: number,
  ): string | null => {
    const path = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment: attachment as Parameters<typeof resolveAttachmentPath>[0]["attachment"],
    });
    if (path === null) return null;
    try {
      const bytes = NodeFS.readFileSync(path);
      if (bytes.length > budget) return null;
      return `data:${attachment.mimeType};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  };

  const snapshot = async (
    threadId: string,
    limit: number,
    kind: ZenHubThreadSnapshot["kind"],
    rich: boolean,
  ): Promise<ZenHubThreadSnapshot> => {
    const records = await runPromise(
      orchestrator
        .getThreadRecords(ThreadId.make(threadId), ["messages", "runs", "turnItems"])
        .pipe(
          Effect.asSome,
          Effect.orElseSucceed(() => Option.none()),
        ),
    );
    if (Option.isNone(records) || records.value.thread.deletedAt !== null) {
      throw new RunnerRequestError(404, "This chat no longer exists.");
    }
    const { thread, messages, runs, turnItems } = records.value;
    const visible = messages
      .filter(
        (message) =>
          message.role !== "system" &&
          (message.text.trim() !== "" || message.attachments.length > 0),
      )
      .toSorted(
        (left, right) =>
          DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
      );
    const kept = visible.slice(-limit);
    const running = runs.some(ThreadManagementService.isActiveRun);
    const last = kept.at(-1);
    // A copy (not rich) also takes messages that are only attachments, and lists them.
    const wire: ReadonlyArray<ZenHubThreadMessage> = kept
      .filter((message) => message.text.trim() !== "" || (!rich && message.attachments.length > 0))
      .map((message) => ({
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        text: message.text,
        createdAt: DateTime.formatIso(message.createdAt),
        streaming: message.streaming,
        ...(rich
          ? {}
          : {
              attachments: message.attachments.map((attachment) => ({
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                kind: attachmentKind(attachment.mimeType),
              })),
            }),
      }));
    const since = kept[0] === undefined ? 0 : DateTime.toEpochMillis(kept[0].createdAt);
    const workItems: Array<SnapshotItem> = rich
      ? turnItems.flatMap((item) => {
          const at = item.startedAt ?? item.updatedAt;
          const millis = DateTime.toEpochMillis(at);
          if (millis < since) return [];
          const extra = item as unknown as {
            readonly toolName?: unknown;
            readonly fileName?: unknown;
            readonly input?: unknown;
            readonly viewedImagePath?: unknown;
          };
          return [
            {
              id: item.id,
              type: item.type,
              status: item.status,
              title: item.title,
              at: millis,
              toolName: typeof extra.toolName === "string" ? extra.toolName : null,
              ...(typeof extra.fileName === "string" ? { fileName: extra.fileName } : {}),
              input: extra.input,
              ...(typeof extra.viewedImagePath === "string"
                ? { viewedImagePath: extra.viewedImagePath }
                : {}),
            },
          ];
        })
      : [];
    const lastItem = workItems.at(-1);
    return {
      version: [
        visible.length,
        last?.id ?? "",
        last?.text.length ?? 0,
        last === undefined ? 0 : DateTime.toEpochMillis(last.updatedAt),
        running ? 1 : 0,
        thread.title,
        workItems.length,
        lastItem === undefined ? "" : `${lastItem.id}:${lastItem.status}`,
      ].join(":"),
      title: thread.title,
      kind,
      running,
      messages: wire,
      omittedMessageCount: visible.length - kept.length,
      ...(rich
        ? {
            rows: buildRows({
              messages: kept.map((message) => ({
                id: message.id,
                role: message.role,
                text: message.text,
                streaming: message.streaming,
                createdAt: DateTime.toEpochMillis(message.createdAt),
                attachments: message.attachments,
              })),
              items: workItems,
              media: mediaDataUrl,
            }),
          }
        : {}),
    };
  };

  const seenNonce = (nonce: string) => {
    const now = Date.now();
    if ((seenNonces.get(nonce) ?? 0) > now) return true;
    if (seenNonces.size > 20_000) {
      for (const [key, until] of seenNonces) if (until <= now) seenNonces.delete(key);
    }
    seenNonces.set(nonce, now + 10 * 60_000);
    return false;
  };

  /** Opens the comments the hub handed over; drops any whose signature does not hold. */
  const openComments = (frame: RelayFrame): Array<ZenHubComment> => {
    const keys = runnerIdentity();
    const nowIso = new Date().toISOString();
    return (frame.comments ?? []).flatMap((comment): Array<ZenHubComment> => {
      const base = {
        id: comment.id,
        createdAt: comment.createdAt,
        authorId: comment.authorId,
        authorName: comment.authorName,
      };
      if (comment.legacy !== undefined) {
        return [
          {
            ...base,
            messageId: comment.legacy.messageId,
            body: comment.legacy.body,
            legacy: true,
            verified: false,
          },
        ];
      }
      if (keys === null || typeof comment.sealed !== "string" || comment.sig === undefined) {
        return [];
      }
      const checked = verifyCommentSignature(
        state.trust,
        {
          shareId: frame.shareId,
          authorId: comment.authorId,
          sealed: comment.sealed,
          sig: comment.sig,
          device: comment.device,
        },
        nowIso,
      );
      if (!checked.ok) return [];
      try {
        const opened = asInput(
          JSON.parse(
            open(
              keys,
              comment.sealed,
              sealContext("comment", frame.shareId, comment.sig.nonce, "request"),
            ),
          ),
        );
        if (typeof opened.body !== "string") return [];
        return [
          {
            ...base,
            messageId: typeof opened.messageId === "string" ? opened.messageId : null,
            body: opened.body.slice(0, 4000),
            verified: checked.verified,
          },
        ];
      } catch {
        return [];
      }
    });
  };

  const answerRelay = async (
    frame: RelayFrame,
    input: Input,
    shell: { readonly projectId: ProjectId; readonly title: string },
    shownKind: ZenHubThreadSnapshot["kind"],
  ): Promise<unknown> => {
    switch (frame.op) {
      case "thread.meta": {
        let title = shell.title;
        const keys = runnerIdentity();
        if (title.trim() === "" && keys !== null && typeof frame.titleSealed === "string") {
          try {
            title = open(
              keys,
              frame.titleSealed,
              sealContext("share.title", state.environment?.id ?? "", frame.threadId, "request"),
            );
          } catch {
            title = "";
          }
        }
        return { title, comments: input.titleOnly === true ? [] : openComments(frame) };
      }
      case "thread.attachment": {
        const messageId = typeof input.messageId === "string" ? input.messageId : "";
        const attachmentId = typeof input.attachmentId === "string" ? input.attachmentId : "";
        const records = await runPromise(
          orchestrator.getThreadRecords(ThreadId.make(frame.threadId), ["messages"]).pipe(
            Effect.asSome,
            Effect.orElseSucceed(() => Option.none()),
          ),
        );
        const attachment = Option.isNone(records)
          ? undefined
          : records.value.messages
              .find((message) => message.id === messageId)
              ?.attachments.find((item) => item.id === attachmentId);
        if (attachment === undefined) {
          throw new RunnerRequestError(404, "This file is not in the shared chat.");
        }
        const read = readAttachmentForCopy(serverConfig.attachmentsDir, attachment);
        if (!read.ok) throw new RunnerRequestError(read.status, read.reason);
        return read.value;
      }
      case "thread.view": {
        const since = typeof input.since === "string" ? input.since : null;
        const deadline = Date.now() + LONG_POLL_MS;
        for (;;) {
          const current = await snapshot(frame.threadId, VIEW_MESSAGE_LIMIT, shownKind, true);
          if (since === null || current.version !== since || Date.now() >= deadline) {
            return current;
          }
          await sleep(LONG_POLL_STEP_MS);
        }
      }
      case "thread.export":
        return snapshot(frame.threadId, EXPORT_MESSAGE_LIMIT, shownKind, false);
      case "thread.prompt": {
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (text === "") throw new RunnerRequestError(400, "Write a message first.");
        const id = NodeCrypto.randomUUID();
        const result = await runPromise(
          threadManagement
            .sendToThread({
              projectId: shell.projectId,
              commandId: CommandId.make(`zen-hub:prompt:${id}`),
              threadId: ThreadId.make(frame.threadId),
              messageId: MessageId.make(`zen-hub-message:${id}`),
              // The agent and the people reading the chat both see who wrote it.
              text: `${frame.actor.name} (${frame.actor.email}):\n${text}`,
              attachments: [],
              mode: "queue",
              createdBy: "user",
              creationSource: "server",
            })
            .pipe(Effect.result),
        );
        if (result._tag === "Failure") {
          throw new RunnerRequestError(409, "The chat could not take the message right now.");
        }
        return { delivery: result.success.delivery };
      }
      case "thread.handedOver": {
        await runPromise(
          orchestrator
            .dispatch({
              type: "thread.archive",
              commandId: CommandId.make(`zen-hub:handover:${frame.shareId}`),
              threadId: ThreadId.make(frame.threadId),
            })
            .pipe(Effect.ignore),
        );
        await update((current) => ({
          ...current,
          shares: Object.fromEntries(
            Object.entries(current.shares).filter(([, share]) => share.threadId !== frame.threadId),
          ),
        }));
        return { ok: true };
      }
      default:
        throw new RunnerRequestError(400, "Unknown request.");
    }
  };

  const askForApproval = (
    actor: RelayFrame["actor"],
    pin: PinnedDevice,
    companyId: string | null,
  ) => {
    const environment = state.environment;
    if (state.hubUrl === null || environment === null) return;
    void runnerFetch(state.hubUrl, environment.credential, "/v1/runner/pending-device", {
      userId: actor.userId,
      keyId: pin.keyId,
      companyId,
    }).catch((error: unknown) =>
      log(`zen hub: could not ask for approval of ${actor.email}'s device: ${String(error)}`),
    );
  };

  /** Colleagues' work on this server needs the company API key (companyAiPolicy.ts). */
  const refuseWithoutCompanyKey = (
    hubCompanyId: string | null | undefined,
    actor: RelayFrame["actor"],
  ) => {
    const account = hubCompanyId ? state.companyAis[hubCompanyId] : undefined;
    const refusal = companyWorkRefusal({
      mode: account?.mode ?? null,
      actorUserId: actor.userId,
      ownerUserId: state.session?.user.id ?? null,
    });
    if (refusal !== null) {
      log(`zen hub: refused work for ${actor.email}: no company API key on this server`);
      throw new RunnerRequestError(403, refusal);
    }
  };

  const onRelayRequest = async (frame: RelayFrame): Promise<unknown> => {
    // Chat integrations: platform webhooks relayed by the hub (see zen/chat/relay.ts). They carry
    // no share and no device signature; the chat layer checks the platform's own signature
    // before reading anything.
    if (frame.op.startsWith("chat.")) return handleZenChatRelay(frame.op, frame.input);
    // 1. Who asked: a device this runner trusts for that person, with a valid signature.
    const trusted = verifyRelayRequest(state.trust, frame, Date.now(), seenNonce);
    if (!trusted.ok) {
      log(`zen hub: refused ${frame.op} from ${frame.actor.email}: ${trusted.reason}`);
      throw new RunnerRequestError(403, trusted.reason);
    }
    if (trusted.pin !== null) {
      const pin = { ...trusted.pin, label: trusted.pin.label ?? frame.actor.email };
      await update((current) => ({
        ...current,
        trust: withPinnedDevice(current.trust, frame.actor.userId, pin),
      }));
      // A first device starts read-only; the hub tells the people who can approve it here.
      if (!isApprovedPin(pin)) askForApproval(frame.actor, pin, frame.companyId);
    }
    const waiting = pendingRefusal(trusted.device, frame.op);
    if (waiting !== null) {
      log(`zen hub: ${frame.op} from ${frame.actor.email} waits for device approval`);
      throw new RunnerRequestError(403, waiting);
    }
    // Hub v6: a member asks the company runner (AI staff), not a shared chat.
    if (frame.shareId.startsWith("company:")) {
      if (startsCompanyWork({ via: "company", op: frame.op })) {
        refuseWithoutCompanyKey(frame.companyId, frame.actor);
      }
      return company.handleRelay(frame, trusted.device);
    }
    // 2. What: only shares this machine made, with the rules for that kind.
    const shell = await threadShell(frame.threadId);
    const current = shell === null ? null : await currentKind(shell.projectId);
    const kind = current === null ? null : current.kind;
    const refusal = authorizeRelayRequest(state, frame, kind);
    if (refusal !== null) throw new RunnerRequestError(403, refusal);
    // A colleague's message runs on the company's AI account: only once the owner confirmed the
    // server (review P0-6) and only on a company API key (companyAiPolicy.ts).
    if (frame.op === "thread.prompt" && kind === "company" && current?.hubCompanyId) {
      const blocked = companyServerBlock(current.hubCompanyId);
      if (blocked !== null) throw new RunnerRequestError(409, blocked);
    }
    if (kind === "company" && startsCompanyWork({ via: "chat", op: frame.op })) {
      refuseWithoutCompanyKey(current?.hubCompanyId ?? frame.companyId, frame.actor);
    }
    if (shell === null) throw new RunnerRequestError(404, "This chat no longer exists.");
    const local = state.shares[frame.shareId]!;
    const shownKind = local.kind === "handover" ? "personal" : local.kind;
    // 3. Content is sealed to this runner and answered sealed to the asking device.
    const keys = runnerIdentity();
    const sig = frame.sig;
    if (!SEALED_OPS.has(frame.op) || sig === undefined) {
      return answerRelay(frame, asInput(frame.input), shell, shownKind);
    }
    const sealedInput = asInput(frame.input).sealed;
    if (keys === null || typeof sealedInput !== "string") {
      throw new RunnerRequestError(400, "This request must be end-to-end encrypted.");
    }
    let input: Input;
    try {
      input = asInput(
        JSON.parse(
          open(keys, sealedInput, sealContext(frame.op, frame.shareId, sig.nonce, "request")),
        ),
      );
    } catch {
      throw new RunnerRequestError(400, "The request could not be decrypted on this machine.");
    }
    const result = await answerRelay(frame, input, shell, shownKind);
    const box = seal(
      trusted.device.boxPublicKey,
      JSON.stringify(result),
      sealContext(frame.op, frame.shareId, sig.nonce, "response"),
    );
    return {
      sealed: box,
      sig: signText(
        keys,
        responseMessage({ op: frame.op, shareId: frame.shareId, nonce: sig.nonce, sealed: box }),
      ),
    };
  };

  const onNotice = (frame: Record<string, unknown>) => {
    if (frame.kind !== "device.revoked" || typeof frame.userId !== "string") return;
    const userId = frame.userId;
    const keyIds = Array.isArray(frame.keyIds)
      ? frame.keyIds.filter((item): item is string => typeof item === "string")
      : [];
    void update((current) => ({
      ...current,
      trust: withRevokedDevices(current.trust, userId, keyIds),
    }));
  };

  function stopRunner() {
    socket?.stop();
    socket = null;
  }

  const startRunner = () => {
    stopRunner();
    if (state.hubUrl === null || state.environment === null || state.session === null) return;
    socket = new RunnerSocket({
      hubUrl: state.hubUrl,
      credential: state.environment.credential,
      onRequest: onRelayRequest,
      onNotice,
      log,
    });
    socket.start();
    void publishRunnerKeys();
    void ensureDevice().catch((error: unknown) =>
      log(`zen hub: could not register this device: ${String(error)}`),
    );
  };

  const runnerOfShare = async (shareId: string) => {
    const cached = runnerKeysByShare.get(shareId);
    if (cached !== undefined && Date.now() - cached.at < 5 * 60_000) return cached;
    const detail = await hub<{
      share: ZenHubShare & {
        runner?: { environmentId: string; keys: RunnerKeys | null };
      };
    }>("GET", `/v1/shares/${enc(shareId)}`);
    const runner = detail.share.runner;
    if (runner === undefined) {
      throw fail("unavailable", "This hub does not support encrypted sharing yet. Update the hub.");
    }
    const entry = { ...runner, at: Date.now() };
    runnerKeysByShare.set(shareId, entry);
    return entry;
  };

  /**
   * One signed relay call. Content ops are sealed to the runner (keys pinned on first use) and
   * their answer must be sealed back to this device and signed by that runner.
   */
  /** The keys of the runner behind a share, pinned on first use and refused when they change. */
  const pinnedRunnerKeys = async (shareId: string): Promise<RunnerKeys> => {
    const runner = await runnerOfShare(shareId);
    const checked = checkRunnerKeys(
      state.trust,
      runner.environmentId,
      runner.keys,
      new Date().toISOString(),
    );
    if (!checked.ok) throw fail("forbidden", checked.reason);
    const pin = checked.pin;
    if (pin !== null) {
      await update((current) => ({
        ...current,
        trust: {
          ...current.trust,
          runners: { ...current.trust.runners, [runner.environmentId]: pin },
        },
      }));
    }
    return state.trust.runners[runner.environmentId] ?? runner.keys!;
  };

  const relayCall = async (
    shareId: string,
    op: string,
    path: string,
    plain: Input,
    timeoutMs?: number,
  ): Promise<unknown> => {
    const device = await ensureDevice();
    const user = state.session!.user;
    const nonce = newNonce();
    let wire: Input = plain;
    let runnerKeys: RunnerKeys | null = null;
    if (SEALED_OPS.has(op)) {
      const pinned = await pinnedRunnerKeys(shareId);
      runnerKeys = pinned;
      wire = {
        sealed: seal(
          pinned.boxPublicKey,
          JSON.stringify(plain),
          sealContext(op, shareId, nonce, "request"),
        ),
      };
    }
    const sig = signRequest(
      device,
      { op, shareId, userId: user.id, payload: wire },
      Date.now(),
      nonce,
    );
    const result = await hub<unknown>("POST", path, { input: wire, sig }, timeoutMs);
    if (runnerKeys === null) return result;
    const answer = asInput(result);
    if (typeof answer.sealed !== "string" || typeof answer.sig !== "string") {
      throw fail("unavailable", "The machine that runs this chat answered without encryption.");
    }
    if (
      !verifyText(
        runnerKeys.signPublicKey,
        responseMessage({ op, shareId, nonce, sealed: answer.sealed }),
        answer.sig,
      )
    ) {
      throw fail("forbidden", "The answer was not signed by the machine that runs this chat.");
    }
    return JSON.parse(open(device, answer.sealed, sealContext(op, shareId, nonce, "response")));
  };

  /** A comment sealed to the share's runner and signed by this device; the hub keeps ciphertext. */
  const postComment = async (shareId: string, body: string, messageId: string | null) => {
    const keys = await pinnedRunnerKeys(shareId);
    const device = await ensureDevice();
    const nonce = newNonce();
    const wire = {
      sealed: seal(
        keys.boxPublicKey,
        JSON.stringify({ body, messageId }),
        sealContext("comment", shareId, nonce, "request"),
      ),
    };
    const sig = signRequest(
      device,
      { op: "comment.add", shareId, userId: state.session!.user.id, payload: wire },
      Date.now(),
      nonce,
    );
    return hub("POST", `/v1/shares/${enc(shareId)}/comments`, { input: wire, sig });
  };

  // Chat titles live on the runners; the hub keeps none. Remembered here for lists and alerts.
  const titles = new Map<string, { title: string; at: number }>();
  const titleMisses = new Map<string, number>();
  const titleRefreshing = new Set<string>();
  const rememberTitle = (shareId: string, title: unknown) => {
    if (typeof title === "string" && title.trim() !== "") {
      titles.set(shareId, { title, at: Date.now() });
    }
  };
  const meta = (shareId: string, titleOnly: boolean, timeoutMs: number) =>
    relayCall(
      shareId,
      "thread.meta",
      `/v1/shares/${enc(shareId)}/meta`,
      titleOnly ? { titleOnly: true } : {},
      timeoutMs,
    ).then((answer) => {
      const value = asInput(answer);
      rememberTitle(shareId, value.title);
      return value;
    });
  /** Starts fetching a title in the background (a few at a time); the next list shows it. */
  const refreshTitle = (shareId: string) => {
    const now = Date.now();
    const known = titles.get(shareId);
    if (known !== undefined && now - known.at < TITLE_TTL_MS) return;
    if (now - (titleMisses.get(shareId) ?? 0) < TITLE_TTL_MS) return;
    if (titleRefreshing.has(shareId) || titleRefreshing.size >= 4) return;
    titleRefreshing.add(shareId);
    void meta(shareId, true, 15_000)
      .catch(() => titleMisses.set(shareId, Date.now()))
      .finally(() => titleRefreshing.delete(shareId));
  };
  const titleFor = async (share: ZenHubShare): Promise<string> => {
    if (share.title.trim() !== "") return share.title; // shared before titles were sealed
    if (share.mine && share.threadId !== null) {
      return (await threadShell(share.threadId))?.title ?? "";
    }
    if (share.online) refreshTitle(share.id);
    return titles.get(share.id)?.title ?? "";
  };

  type Me = {
    user: { id: string; email: string; name: string };
    companies: ZenHubStatus["companies"];
    environments: Array<{
      id: string;
      name: string;
      runnerCompanyId: string | null;
      /** Hub v9: every company this machine serves. */
      runnerCompanyIds?: ReadonlyArray<string>;
      online?: boolean;
    }>;
    invites: ZenHubStatus["invites"];
    twoFactor?: ZenHubStatus["twoFactor"];
    preferences?: ZenHubStatus["preferences"];
    unreadNotifications?: number;
    signInMethods?: ReadonlyArray<string>;
  };

  let syncing: Promise<void> | null = null;
  const syncFromHub = (me?: Me): Promise<void> => {
    if (syncing !== null) return syncing;
    syncing = (async () => {
      if (state.session === null) return;
      const fresh = me ?? (await hub<Me>("GET", "/v1/me", undefined, 10_000));
      const roles = Object.fromEntries(
        fresh.companies.map((company) => [company.id, company.role]),
      );
      if (fresh.twoFactor != null && fresh.twoFactor.gate !== "ok") {
        await update((current) => ({ ...current, cache: { ...current.cache, roles } }));
        return;
      }
      const settings: Record<string, { url: string | null; saveConversations: boolean }> = {};
      const hosted: Record<string, HostedMemoryStatus> = {};
      for (const hubCompanyId of new Set(Object.values(state.links))) {
        if (roles[hubCompanyId] === undefined) continue;
        const answer = await hub<{
          memory: { url: string | null; saveConversations: boolean };
          updatedAt: string | null;
          hosted?: HostedMemoryStatus;
        }>("GET", `/v1/companies/${enc(hubCompanyId)}/settings`).catch(() => null);
        if (answer !== null && answer.updatedAt !== null) settings[hubCompanyId] = answer.memory;
        // Hub v13. A failed answer keeps the last known status (a short outage changes nothing).
        const known = answer === null ? state.cache.hosted?.[hubCompanyId] : answer.hosted;
        if (known !== undefined) hosted[hubCompanyId] = known;
      }
      // Hub v17: the person's own memory (an older hub answers 404: kept as "not available").
      const personalAnswer = await hub<PersonalMemoryStatus>(
        "GET",
        "/v1/me/memory",
        undefined,
        10_000,
      ).catch(() => undefined);
      const personalMemory =
        personalAnswer === undefined
          ? (state.cache.personalMemory ?? null)
          : {
              available: personalAnswer.available,
              active: personalAnswer.active,
              url: personalAnswer.url,
            };
      let ledger = state.cache.ledger;
      let ledgerRefused = state.cache.ledgerRefused;
      const ledgers: Record<string, HubAccessLedger> = {};
      let trust = state.trust;
      // Every company this machine serves keeps its own verified Enterprise ledger; a company's
      // runs are checked against its grants only (runnerLedgerFor). `ledger` stays the first's.
      for (const runnerCompanyId of state.runnerCompanyIds) {
        const kept = state.cache.ledgers?.[runnerCompanyId];
        if (kept !== undefined) ledgers[runnerCompanyId] = kept;
        if (roles[runnerCompanyId] === undefined) continue;
        const answers = await Promise.all([
          hub<{ grants: ReadonlyArray<HubGrant> }>(
            "GET",
            `/v1/companies/${enc(runnerCompanyId)}/grants`,
          ),
          hub<{ members: ReadonlyArray<{ userId: string; role: HubRole }> }>(
            "GET",
            `/v1/companies/${enc(runnerCompanyId)}`,
          ),
        ]).catch(() => null);
        if (answers === null) continue;
        const [grants, company] = answers;
        const verified = verifyHubGrants({
          grants: grants.grants,
          companyId: runnerCompanyId,
          managers: new Set(
            company.members
              .filter((member) => member.role === "owner" || member.role === "admin")
              .map((member) => member.userId),
          ),
          trust,
          nowIso: new Date().toISOString(),
        });
        for (const pin of verified.pins) trust = withPinnedDevice(trust, pin.userId, pin.device);
        ledgers[runnerCompanyId] = { grants: verified.grants, approvals: verified.approvals };
        if (runnerCompanyId === state.runnerCompanyIds[0]) {
          ledger = ledgers[runnerCompanyId]!;
          ledgerRefused = verified.refused;
        }
        if (verified.refused.length > 0) {
          log(
            `zen hub: ${verified.refused.length} Enterprise grant(s) refused on this runner (${runnerCompanyId})`,
          );
        }
      }
      if (state.runnerCompanyIds.length === 0) {
        ledger = null;
        ledgerRefused = [];
      }
      // Hub v9: my permissions in the companies this machine works with (linked or served), for
      // the checks it makes for me (agent edits, approvals). Kept on an outage; an older hub has
      // no /access and the role defaults apply.
      const access: Record<string, ZenHubAccess> = {};
      for (const hubCompanyId of new Set([
        ...Object.values(state.links),
        ...state.runnerCompanyIds,
      ])) {
        const role = roles[hubCompanyId];
        if (role === undefined) continue;
        const answer = await hub<{ access: ZenHubAccess | null }>(
          "GET",
          `/v1/companies/${enc(hubCompanyId)}/access`,
          undefined,
          10_000,
        ).catch(() => undefined);
        const known = answer === undefined ? state.cache.access?.[hubCompanyId] : undefined;
        access[hubCompanyId] = answer?.access ?? known ?? zenHubAccessOfRole(role);
      }
      const names = Object.fromEntries(
        fresh.companies.map((company) => [company.id, company.name]),
      );
      const nextTrust = trust;
      await update((current) => ({
        ...current,
        trust: nextTrust,
        cache: {
          roles,
          settings,
          hosted,
          personalMemory,
          ledger,
          ledgerRefused,
          ledgers,
          access,
          names,
        },
      }));
      // Hub v6: company AI staff and company packs.
      await company.sync();
    })()
      .catch((error: unknown) => log(`zen hub: sync failed: ${String(error)}`))
      .finally(() => {
        syncing = null;
      });
    return syncing;
  };

  const finishSignIn = async (
    signedIn: { token: string; user: { id: string; email: string; name: string } },
    machineName: string,
  ) => {
    const sameAccount = state.environment !== null && state.environment.userId === signedIn.user.id;
    let environment = state.environment;
    if (!sameAccount) {
      const registered = await hubFetch<{ environmentId: string; credential: string }>(
        hubUrl(),
        signedIn.token,
        "POST",
        "/v1/environments",
        { name: machineName },
      );
      environment = {
        id: registered.environmentId,
        credential: registered.credential,
        name: machineName,
        userId: signedIn.user.id,
        keys: null,
      };
    }
    const device = await registerDevice(signedIn, environment?.id ?? null, machineName);
    await update((current) => ({
      ...current,
      session: signedIn,
      pendingLogin: null,
      environment,
      device,
      trust: pinOwnDevice(current, signedIn.user.id, signedIn.user.email, device),
      ...(sameAccount
        ? {}
        : {
            ...withRunnerCompanies([]),
            shares: {},
            links: {},
            cache: emptyHubCache(),
            companyAis: {},
          }),
    }));
    startRunner();
    void syncFromHub();
    return { signedIn: true, user: signedIn.user };
  };

  /** One company's AI account on this runner (default: the first company it serves). */
  const companyAiStatus = (
    hubCompanyId: string | null = state.runnerCompanyIds[0] ?? null,
  ): ZenHubAiAccount | null => {
    if (hubCompanyId === null || !isRunnerOf(state, hubCompanyId)) return null;
    const account = state.companyAis[hubCompanyId];
    return account === undefined
      ? null
      : { ...account, hasKey: vault.has(COMPANY_AI_VAULT, hubCompanyId) };
  };
  const companyAisStatus = (): Record<string, ZenHubAiAccount> =>
    Object.fromEntries(
      state.runnerCompanyIds.flatMap((id) => {
        const account = companyAiStatus(id);
        return account === null ? [] : [[id, account]];
      }),
    );

  const status = async (): Promise<ZenHubStatus> => {
    let me: Me | null = null;
    lastError = null;
    if (state.session !== null) {
      try {
        me = await hub<Me>("GET", "/v1/me", undefined, 10_000);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "The hub cannot be reached.";
      }
    }
    if (me !== null) {
      const fresh = me;
      const environment = fresh.environments.find((item) => item.id === state.environment?.id);
      const runnerCompanyIds =
        environment?.runnerCompanyIds ??
        (environment?.runnerCompanyId ? [environment.runnerCompanyId] : []);
      if (
        runnerCompanyIds.join(",") !== state.runnerCompanyIds.join(",") ||
        fresh.user.name !== state.session?.user.name
      ) {
        await update((current) => ({
          ...current,
          ...withRunnerCompanies(runnerCompanyIds),
          session: current.session === null ? null : { ...current.session, user: fresh.user },
        }));
      }
      if (socket === null) startRunner();
      void syncFromHub(fresh);
    }
    // Hub v9: my permissions in each company, for hiding what my role cannot do (the hub and the
    // runner check them again). An older hub has no /access: the built-in role defaults apply.
    const access: Record<string, ZenHubAccess> = {};
    if (me !== null && me.twoFactor?.gate !== "enroll" && me.twoFactor?.gate !== "verify") {
      await Promise.all(
        me.companies.map(async (item) => {
          const answer = await hub<{ access: ZenHubAccess | null }>(
            "GET",
            `/v1/companies/${enc(item.id)}/access`,
            undefined,
            10_000,
          ).catch(() => null);
          access[item.id] = answer?.access ?? zenHubAccessOfRole(item.role);
        }),
      );
    }
    return {
      access,
      hubUrl: state.hubUrl ?? defaultHubUrl,
      signedIn: state.session !== null,
      pendingEmail: state.pendingLogin?.email || null,
      user: state.session?.user ?? null,
      environment:
        state.environment === null
          ? null
          : {
              id: state.environment.id,
              name: state.environment.name,
              connected: socket?.connected ?? false,
            },
      runnerCompanyId: state.runnerCompanyId,
      runnerCompanyIds: state.runnerCompanyIds,
      links: state.links,
      companies: me?.companies ?? [],
      // The person's machines and whether each is connected to the hub right now ("Your company today").
      environments: (me?.environments ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        online: item.online === true,
      })),
      invites: me?.invites ?? [],
      error: lastError ?? socket?.lastError ?? null,
      twoFactor: me?.twoFactor ?? null,
      preferences: me?.preferences ?? null,
      unreadNotifications: me?.unreadNotifications ?? 0,
      signInMethods: me?.signInMethods ?? ["email"],
      companyAi: companyAiStatus(),
      companyAis: companyAisStatus(),
    };
  };

  const createShare = async (input: Input, forcedKind: "handover" | null) => {
    if (state.environment === null) throw fail("not-signed-in", "Sign in to a hub first.");
    const threadId = str(input, "threadId", 200);
    const shell = await threadShell(threadId);
    if (shell === null || shell.deletedAt != null)
      throw fail("not-found", "This chat no longer exists.");
    const { kind, hubCompanyId } = await currentKind(shell.projectId);
    const companyId =
      (kind === "company" ? hubCompanyId : null) ?? optStr(input, "companyId", 80) ?? hubCompanyId;
    if (companyId === null) {
      throw fail("invalid-input", "Choose the company to share with.");
    }
    const shareKind = forcedKind ?? kind;
    if (runnerIdentity() === null) await publishRunnerKeys();
    const keys = runnerIdentity();
    const share = await hub<ZenHubShare>("POST", "/v1/shares", {
      environmentId: state.environment.id,
      companyId,
      threadId,
      kind: shareKind,
      audienceUserId: optStr(input, "audienceUserId", 80),
      // Only this machine can open it; colleagues get the title through it (thread.meta).
      ...(keys === null
        ? {}
        : {
            titleSealed: seal(
              keys.boxPublicKey,
              shell.title,
              sealContext("share.title", state.environment.id, threadId, "request"),
            ),
          }),
    });
    rememberTitle(share.id, shell.title);
    await update((current) => ({
      ...current,
      shares: { ...current.shares, [share.id]: { threadId, kind: shareKind, companyId } },
    }));
    return { ...share, title: shell.title };
  };

  /**
   * Fetches the export's attachments within the copy limits, one sealed relay call each, and
   * stores them for the new thread. A file that fails or is over the limits is listed instead.
   */
  const copyAttachments = async (
    shareId: string,
    snapshotValue: ZenHubThreadSnapshot,
    threadId: string,
  ): Promise<Map<string, ChatAttachment>> => {
    const copied = new Map<string, ChatAttachment>();
    for (const entry of planCopyAttachments(snapshotValue.messages).fetch) {
      try {
        const answer = asInput(
          await relayCall(
            shareId,
            "thread.attachment",
            `/v1/shares/${enc(shareId)}/attachment`,
            { messageId: entry.messageId, attachmentId: entry.attachment.id },
            60_000,
          ),
        );
        if (typeof answer.data !== "string") continue;
        const stored = storeCopiedAttachment({
          attachmentsDir: serverConfig.attachmentsDir,
          threadId,
          source: entry.attachment,
          bytes: Buffer.from(answer.data, "base64"),
        });
        if (stored !== null) copied.set(entry.attachment.id, stored);
      } catch (error) {
        log(`zen hub: an attachment was not copied: ${String(error)}`);
      }
    }
    return copied;
  };

  const importSnapshot = async (
    input: Input,
    shareId: string,
    snapshotValue: ZenHubThreadSnapshot,
    fromName: string,
    how: "copy" | "handover",
  ) => {
    const projectId = ProjectId.make(str(input, "projectId", 200));
    const modelSelection = decodeModelSelection(input.modelSelection);
    const runtimeMode = decodeRuntimeMode(input.runtimeMode);
    if (Option.isNone(modelSelection) || Option.isNone(runtimeMode)) {
      throw fail("invalid-input", "No AI assistant is ready on this computer.");
    }
    const threadId = ThreadId.make(NodeCrypto.randomUUID());
    const now = DateTime.makeUnsafe(Date.now());
    const copied = await copyAttachments(shareId, snapshotValue, threadId);
    try {
      await runPromise(
        eventSink
          .write({
            events: buildCopyEvents({
              threadId,
              projectId,
              modelSelection: modelSelection.value,
              runtimeMode: runtimeMode.value,
              snapshot: snapshotValue,
              fromName,
              how,
              now,
              copied,
              language: input.language === "ro" ? "ro" : "en",
            }),
          })
          .pipe(Effect.orDie),
      );
    } catch (error) {
      removeCopiedAttachments(serverConfig.attachmentsDir, copied.values());
      throw error;
    }
    return { threadId, projectId, attachmentsCopied: copied.size };
  };

  const shareDetail = (shareId: string) =>
    hub<{ share: ZenHubShare }>("GET", `/v1/shares/${enc(shareId)}`);

  const signedGrant = async (input: {
    readonly companyId: string;
    readonly packId: string;
    readonly kind: "use" | "install";
    readonly userId: string | null;
    readonly userEmail: string | null;
  }) => {
    const device = await ensureDevice();
    const ts = Date.now();
    const statement = {
      action: "grant",
      companyId: input.companyId,
      packId: input.packId,
      kind: input.kind,
      userId: input.userId,
      userEmail: input.userEmail,
      grantedBy: state.session!.user.id,
      ts,
    };
    return hub("POST", `/v1/companies/${enc(input.companyId)}/grants`, {
      packId: input.packId,
      kind: input.kind,
      userId: input.userId,
      ts,
      signature: signText(device, statementMessage(statement)),
    });
  };

  const memberByEmail = async (companyId: string, email: string) => {
    const detail = await hub<{ members: ReadonlyArray<{ userId: string; email: string }> }>(
      "GET",
      `/v1/companies/${enc(companyId)}`,
    );
    const member = detail.members.find((item) => item.email.toLowerCase() === email.toLowerCase());
    if (member === undefined) throw fail("not-found", `${email} is not a member of this company.`);
    return member;
  };

  const hubCompanyFor = (input: Input) => {
    const companyId = optStr(input, "companyId", 80);
    if (companyId !== null) return companyId;
    const local = optStr(input, "localCompanyId", 64);
    const linked = local === null ? undefined : state.links[local];
    if (linked === undefined) {
      throw fail("invalid-input", "This company is not linked to a hub company.");
    }
    return linked;
  };

  /** Owner or admin of a hub company (a role not synced yet: the hub decides). */
  const managesCompany = (hubCompanyId: string) => {
    const role = state.cache.roles[hubCompanyId];
    return role === undefined || isHubManager(role);
  };

  /** The served company an Enterprise action is for (asked for, else the first one). */
  const requireRunnerCompany = (wanted?: string | null) => {
    const companyId =
      wanted == null
        ? (state.runnerCompanyIds[0] ?? null)
        : runnerCompanyFor(state, { hubCompanyId: wanted });
    if (companyId === null) {
      throw new Error(
        wanted == null
          ? "This machine is not a company runner."
          : "This machine is not the server of that company.",
      );
    }
    return companyId;
  };

  const startSignIn = async (
    op: "signIn.start" | "signIn.oauth" | "signIn.passkey",
    input: Input,
  ) => {
    const url = normalizeHubUrl(str(input, "hubUrl", 300));
    if (url === null) {
      throw fail(
        "invalid-input",
        "The hub address must start with https:// (or http://localhost).",
      );
    }
    const machineName = optStr(input, "machineName", 80) ?? NodeOS.hostname();
    const email = op === "signIn.start" ? str(input, "email", 254).toLowerCase() : "";
    const started =
      op === "signIn.start"
        ? await hubFetch<{ requestId: string; pollSecret: string; url?: string }>(
            url,
            null,
            "POST",
            "/v1/auth/start",
            { email },
          )
        : op === "signIn.passkey"
          ? await hubFetch<{ requestId: string; pollSecret: string; url?: string }>(
              url,
              null,
              "POST",
              "/v1/auth/passkey/start",
              { lang: passkeyLanguage(input.lang) },
            ).then((passkey) => {
              // Only the hub's own passkey page is opened in the browser.
              const page = passkeyPageUrl(passkey.url, "login");
              if (page === null) throw fail("invalid-input", "The hub sent an unexpected address.");
              return { ...passkey, url: page };
            })
          : await hubFetch<{ requestId: string; pollSecret: string; url?: string }>(
              url,
              null,
              "POST",
              "/v1/auth/oauth/start",
              { provider: str(input, "provider", 20) },
            );
    if (state.hubUrl !== null && state.hubUrl !== url) {
      // Another hub: this machine registers there from scratch.
      stopRunner();
      await update((current) => ({
        ...current,
        session: null,
        environment: null,
        device: null,
        ...withRunnerCompanies([]),
        links: {},
        shares: {},
        cache: emptyHubCache(),
        companyAis: {},
      }));
    }
    await update((current) => ({
      ...current,
      hubUrl: url,
      pendingLogin: {
        email,
        requestId: started.requestId,
        pollSecret: started.pollSecret,
        machineName,
      },
    }));
    return started.url === undefined ? { ok: true } : { ok: true, url: started.url };
  };

  /** The confirmation of `runner.set` / `runner.consent.set`, or an error (nothing changes). */
  const requireConfirmation = (input: Input, companyId: string): ServerConsent => {
    const confirmation = parseServerConfirmation(
      input.confirm,
      new Date(),
      state.session?.user.id ?? null,
    );
    if (confirmation === null) {
      throw fail(
        "invalid-input",
        "Confirm which AI account and which connections the company server uses first.",
      );
    }
    const key = optStr(asInput(asInput(input.confirm).account), "apiKey", 400);
    if (
      confirmation.account.mode === "api-key" &&
      key === null &&
      !vault.has(COMPANY_AI_VAULT, companyId)
    ) {
      throw fail("invalid-input", "Paste the company API key. It stays on this machine.");
    }
    return confirmation;
  };
  /** Saves the company AI account named in the confirmation, then the confirmation itself. */
  const recordConfirmation = async (
    companyId: string,
    confirmation: ServerConsent,
    input: Input,
  ) => {
    const key = optStr(asInput(asInput(input.confirm).account), "apiKey", 400);
    await setAiAccount({
      hubCompanyId: companyId,
      account: {
        provider: confirmation.account.provider,
        mode: confirmation.account.mode,
        label: confirmation.account.label.slice(0, 80),
        ...(key === null ? {} : { apiKey: key }),
      },
    });
    setConsents({ ...consents, [companyId]: confirmation });
    log(
      `Zen hub: company server confirmed for ${companyId} (${confirmation.account.mode}, ${confirmation.shared.length} shared connections)`,
    );
  };

  const setAiAccount = async (input: Input) => {
    const environment = state.environment;
    // Hub v9: each company this machine serves has its own AI account (and its own vault key).
    const companyId = optStr(input, "hubCompanyId", 80) ?? state.runnerCompanyIds[0] ?? null;
    if (environment === null || companyId === null || !isRunnerOf(state, companyId)) {
      throw fail("invalid-input", "Make this machine the company runner first.");
    }
    // Only the company's owners and admins choose its AI account (the hub checks it too).
    if (!managesCompany(companyId)) {
      throw fail("forbidden", "Only the company's owners and admins choose its AI account.");
    }
    const withoutCompany = (accounts: HubState["companyAis"]) =>
      Object.fromEntries(Object.entries(accounts).filter(([id]) => id !== companyId));
    if (input.account === null) {
      await hub("PUT", `/v1/environments/${enc(environment.id)}/ai-account`, {
        companyId,
        account: null,
      });
      vault.remove(COMPANY_AI_VAULT, companyId);
      await update((current) => ({ ...current, companyAis: withoutCompany(current.companyAis) }));
      return { aiAccount: null };
    }
    const account = asInput(input.account);
    const provider = account.provider === "codex" ? "codex" : "claude";
    const mode = account.mode === "api-key" ? "api-key" : "seat";
    const label = str(account, "label", 80);
    const apiKey = optStr(account, "apiKey", 400);
    if (mode === "api-key" && apiKey === null && !vault.has(COMPANY_AI_VAULT, companyId)) {
      throw fail("invalid-input", "Paste the company API key. It stays on this machine.");
    }
    // Metadata first: the hub refuses anything that looks like a key in the label.
    await hub("PUT", `/v1/environments/${enc(environment.id)}/ai-account`, {
      companyId,
      account: { provider, mode, label },
    });
    if (mode === "api-key" && apiKey !== null) vault.set(COMPANY_AI_VAULT, companyId, apiKey);
    if (mode === "seat") vault.remove(COMPANY_AI_VAULT, companyId);
    await update((current) => ({
      ...current,
      companyAis: { ...current.companyAis, [companyId]: { provider, mode, label } },
    }));
    return { aiAccount: companyAiStatus(companyId) };
  };

  const approveDevice = async (keyId: string) => {
    const device = await ensureDevice();
    const listed = await hub<{
      devices: ReadonlyArray<{
        keyId: string;
        signPublicKey: string;
        boxPublicKey: string;
        revoked: boolean;
      }>;
    }>("GET", "/v1/me/devices");
    const target = listed.devices.find((item) => item.keyId === keyId && !item.revoked);
    if (target === undefined) throw fail("not-found", "That device is not signed in any more.");
    const signature = signText(
      device,
      deviceCertMessage({
        userId: state.session!.user.id,
        keyId: target.keyId,
        signPublicKey: target.signPublicKey,
        boxPublicKey: target.boxPublicKey,
      }),
    );
    return hub("POST", `/v1/me/devices/${enc(keyId)}/certify`, { signature });
  };

  /**
   * Who approves a pending device on this runner: the person this machine is registered to (the
   * runner's owner), or an owner/admin of the company it runs for (per the hub's roles).
   */
  const canDecideDevices = (): boolean => {
    const session = state.session;
    if (session === null || state.environment === null) return false;
    if (state.environment.userId === session.user.id) return true;
    return state.runnerCompanyIds.some((id) => {
      const role = state.cache.roles[id];
      return role === "owner" || role === "admin";
    });
  };

  // Client approval links (ZEN.md, "Client approval links").
  const approvalsFile = NodePath.join(zenDir, "client-approvals.json");
  let approvalsWriting: Promise<unknown> = Promise.resolve();
  const updateApprovals = (
    change: (records: Array<LocalApprovalRecord>) => Array<LocalApprovalRecord>,
  ) => {
    const next = approvalsWriting.then(async () => {
      const records = change(await loadApprovalRecords(approvalsFile));
      await saveApprovalRecords(approvalsFile, records);
      return records;
    });
    approvalsWriting = next.catch(() => undefined);
    return next;
  };
  const asApprovalError = (cause: unknown) =>
    cause instanceof ClientApprovalError ? fail(cause.reason, cause.message) : cause;

  const readLocalCompany = (companyId: string) => {
    try {
      const raw = JSON.parse(NodeFS.readFileSync(companiesFile, "utf8")) as {
        companies?: Array<{ id?: unknown; name?: unknown; color?: unknown }>;
      };
      const found = (raw.companies ?? []).find((company) => company.id === companyId);
      return found === undefined
        ? null
        : {
            name: typeof found.name === "string" ? found.name : companyId,
            color: typeof found.color === "string" ? found.color : null,
          };
    } catch {
      return null;
    }
  };

  const createApproval = async (input: Input) => {
    const cwd = str(input, "cwd", 4096);
    if (Option.isNone(knownWorkspaces)) {
      throw fail("unavailable", "Files cannot be read on this machine.");
    }
    const known = await runPromise(
      knownWorkspaces.value.assertContains(cwd).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      ),
    );
    if (!known) throw fail("forbidden", "This folder is not one of the projects on this machine.");
    const relativePaths = Array.isArray(input.relativePaths)
      ? input.relativePaths.filter((path): path is string => typeof path === "string")
      : [];
    const hubCompanyId = str(input, "hubCompanyId", 80);
    const localCompanyId = optStr(input, "localCompanyId", 80);
    const files = await readDeliverables(cwd, relativePaths).catch((cause: unknown) => {
      throw asApprovalError(cause);
    });
    const local = localCompanyId === null ? null : readLocalCompany(localCompanyId);
    const clientName = optStr(input, "clientName", 80) ?? local?.name ?? "Client";
    const logo =
      localCompanyId === null ? null : await readCompanyLogo(serverConfig.baseDir, localCompanyId);
    const color =
      localCompanyId === null
        ? null
        : await readBrandColor(serverConfig.stateDir, localCompanyId, local?.color ?? null);
    const title =
      optStr(input, "title", 160) ?? defaultApprovalTitle(files.map((file) => file.name));
    const days = typeof input.expiresInDays === "number" ? input.expiresInDays : 14;
    const created = await hub<{
      approval: { id: string; status: string };
      url: string;
    }>(
      "POST",
      `/v1/companies/${enc(hubCompanyId)}/approvals`,
      {
        title,
        note: optStr(input, "note", 2000) ?? "",
        language: input.language === "en" ? "en" : "ro",
        expiresInDays: days,
        client: {
          name: clientName,
          ...(color === null ? {} : { color }),
          ...(logo === null
            ? {}
            : { logo: { name: logo.name, data: logo.bytes.toString("base64") } }),
        },
        files: files.map((file) => ({ name: file.name, data: file.bytes.toString("base64") })),
      },
      // Large videos on a slow upload: up to five minutes.
      300_000,
    );
    const record: LocalApprovalRecord = {
      id: created.approval.id,
      url: created.url,
      threadId: optStr(input, "threadId", 200),
      hubCompanyId,
      localCompanyId,
      title,
      clientName,
      files: files.map((file) => ({ name: file.name, kind: file.kind })),
      createdAt: new Date().toISOString(),
      lastStatus: created.approval.status,
    };
    await updateApprovals((records) => [
      ...records.filter((item) => item.id !== record.id),
      record,
    ]);
    return { record, approval: created.approval };
  };

  const listApprovals = async (input: Input) => {
    const threadId = optStr(input, "threadId", 200);
    const records = (await loadApprovalRecords(approvalsFile)).filter(
      (record) => threadId === null || record.threadId === threadId,
    );
    const recent = records.slice(-100);
    if (recent.length === 0 || state.session === null) {
      return {
        items: recent.map((record) => ({ record, approval: null })),
        offline: state.session === null,
      };
    }
    let fetched: Array<{ id: string; status: string }> = [];
    let offline = false;
    try {
      fetched = (
        await hub<{ approvals: Array<{ id: string; status: string }> }>(
          "GET",
          `/v1/approvals?ids=${recent.map((record) => enc(record.id)).join(",")}`,
        )
      ).approvals;
    } catch (cause) {
      if (cause instanceof HubHttpError && cause.status === 401) throw cause;
      offline = true;
    }
    const byId = new Map(fetched.map((approval) => [approval.id, approval]));
    const changed = recent.filter((record) => {
      const status = byId.get(record.id)?.status;
      return status !== undefined && status !== record.lastStatus;
    });
    if (changed.length > 0) {
      await updateApprovals((all) =>
        all.map((record) => {
          const status = byId.get(record.id)?.status;
          return status === undefined ? record : { ...record, lastStatus: status };
        }),
      );
    }
    return {
      items: recent.map((record) => ({ record, approval: byId.get(record.id) ?? null })),
      offline,
    };
  };

  const run = async (op: ZenHubCallInput["op"], raw: unknown): Promise<unknown> => {
    const input = asInput(raw);
    const afterSync = async <T>(result: Promise<T>) => {
      const value = await result;
      void syncFromHub();
      return value;
    };
    switch (op) {
      case "approval.create":
        return createApproval(input);
      case "approval.list":
        return listApprovals(input);
      case "approval.revoke": {
        const id = str(input, "id", 80);
        const records = await loadApprovalRecords(approvalsFile);
        if (!records.some((record) => record.id === id)) {
          throw fail("not-found", "This approval link is not on this machine.");
        }
        return hub("POST", `/v1/approvals/${enc(id)}/revoke`, {});
      }
      case "staff.follow": {
        const localCompanyId = str(input, "companyId", 80);
        if (state.links[localCompanyId] === undefined) {
          throw fail("invalid-input", "This company is not linked to a hub company.");
        }
        try {
          return await company.bridge.staffFollow!({
            localCompanyId,
            staffId: str(input, "staffId", 80),
            runId: str(input, "runId", 80),
            since: optStr(input, "since", 200),
          });
        } catch (error) {
          throw fail(
            "forbidden",
            error instanceof Error ? error.message : "The task cannot be followed.",
          );
        }
      }
      case "companyPacks.list":
      case "companyPacks.install":
      case "companyPacks.remove":
      case "companyPacks.hide":
      case "companyPacks.sync":
        return company.op(op, input);
      case "status":
        return status();
      case "signIn.providers": {
        const url = normalizeHubUrl(
          optStr(input, "hubUrl", 300) ?? state.hubUrl ?? defaultHubUrl ?? "",
        );
        if (url === null) return { providers: [] };
        return hubFetch(url, null, "GET", "/v1/auth/providers").catch(() => ({ providers: [] }));
      }
      case "signIn.start":
      case "signIn.oauth":
      case "signIn.passkey":
        return startSignIn(op, input);
      case "signIn.verify": {
        const pending = state.pendingLogin;
        if (pending === null) throw fail("invalid-input", "Ask for a sign-in code first.");
        const signedIn = await hubFetch<{ token: string; user: Me["user"] }>(
          hubUrl(),
          null,
          "POST",
          "/v1/auth/verify",
          {
            email: pending.email,
            code: str(input, "code", 12),
            label: `Zen Staff on ${pending.machineName}`,
          },
        );
        return finishSignIn(signedIn, pending.machineName);
      }
      case "signIn.poll": {
        const pending = state.pendingLogin;
        if (pending === null) return { signedIn: state.session !== null };
        const polled = await hubFetch<{ pending: boolean; token?: string; user?: Me["user"] }>(
          hubUrl(),
          null,
          "POST",
          "/v1/auth/poll",
          {
            requestId: pending.requestId,
            pollSecret: pending.pollSecret,
            label: `Zen Staff on ${pending.machineName}`,
          },
        );
        if (polled.pending || polled.token === undefined || polled.user === undefined) {
          return { signedIn: false };
        }
        return finishSignIn({ token: polled.token, user: polled.user }, pending.machineName);
      }
      case "signOut": {
        if (state.session !== null && state.hubUrl !== null) {
          await hubFetch(state.hubUrl, state.session.token, "POST", "/v1/auth/logout").catch(
            () => undefined,
          );
        }
        stopRunner();
        // The device key is kept: at the next sign-in it vouches for the new one.
        await update((current) => ({ ...current, session: null, pendingLogin: null }));
        return { ok: true };
      }
      case "profile.setName":
        return hub("PATCH", "/v1/me", { name: str(input, "name", 80) });

      case "twoFactor.status":
        return hub("GET", "/v1/auth/totp");
      case "twoFactor.setup":
        return hub("POST", "/v1/auth/totp/setup", {});
      case "twoFactor.enable":
        return afterSync(hub("POST", "/v1/auth/totp/enable", { code: str(input, "code", 12) }));
      case "twoFactor.verify":
        return afterSync(
          hub("POST", "/v1/auth/totp/verify", {
            code: optStr(input, "code", 12),
            recoveryCode: optStr(input, "recoveryCode", 20),
          }),
        );
      case "twoFactor.disable":
        return hub("POST", "/v1/auth/totp/disable", { code: str(input, "code", 12) });
      case "twoFactor.recoveryCodes":
        return hub("POST", "/v1/auth/totp/recovery-codes", { code: str(input, "code", 12) });

      case "passkeys.list":
        return { passkeys: normalizePasskeys(await hub("GET", "/v1/me/passkeys")) };
      case "passkeys.register": {
        const started = await hub<{ url?: unknown; expiresAt?: unknown }>(
          "POST",
          "/v1/me/passkeys/register",
          {
            label: passkeyLabel(input.label, state.environment?.name ?? NodeOS.hostname()),
            lang: passkeyLanguage(input.lang),
          },
        );
        const page = passkeyPageUrl(started.url, "register");
        if (page === null) throw fail("invalid-input", "The hub sent an unexpected address.");
        return { url: page, expiresAt: started.expiresAt };
      }
      case "passkeys.remove": {
        const id = passkeyId(input.passkeyId);
        if (id === null) throw fail("invalid-input", "No such passkey.");
        return hub("DELETE", `/v1/me/passkeys/${enc(id)}`);
      }

      case "sessions.list":
        return hub("GET", "/v1/me/sessions");
      case "sessions.revoke":
        return hub("DELETE", `/v1/me/sessions/${enc(str(input, "sessionId", 40))}`);
      case "devices.list": {
        const listed = await hub<{
          devices: ReadonlyArray<{ keyId: string; signPublicKey?: string }>;
        }>("GET", "/v1/me/devices");
        return {
          devices: listed.devices.map((item) => ({
            ...item,
            current: item.keyId === state.device?.keyId,
            // Read this to a runner's owner when they ask to approve your new device.
            fingerprint:
              typeof item.signPublicKey === "string" ? fingerprintOf(item.signPublicKey) : null,
          })),
        };
      }
      case "devices.approve":
        return approveDevice(str(input, "keyId", 40));
      case "devices.trusted":
        return {
          canDecide: canDecideDevices(),
          devices: Object.entries(state.trust.devices).flatMap(([userId, devices]) =>
            devices.map((device) => ({
              userId,
              keyId: device.keyId,
              via: device.via,
              at: device.at,
              label: device.label ?? null,
              pending: !isApprovedPin(device),
              fingerprint: pinFingerprint(device),
              approvedBy: device.approvedBy ?? null,
            })),
          ),
          runners: Object.entries(state.trust.runners).map(([environmentId, runner]) => ({
            environmentId,
            at: runner.at,
          })),
        };
      case "devices.decide": {
        if (!canDecideDevices()) {
          throw fail(
            "forbidden",
            "Only this runner's owner or a company owner or admin approves devices here.",
          );
        }
        const userId = str(input, "userId", 80);
        const keyId = str(input, "keyId", 40);
        const approve = input.approve === true;
        const by = state.session?.user.email ?? "this machine";
        let found = true;
        await update((current) => {
          if (!approve)
            return { ...current, trust: withRejectedDevice(current.trust, userId, keyId) };
          const next = withApprovedDevice(
            current.trust,
            userId,
            keyId,
            by,
            new Date().toISOString(),
          );
          if (next === null) found = false;
          return next === null ? current : { ...current, trust: next };
        });
        if (!found) throw fail("not-found", "That device is not waiting here any more.");
        log(`zen hub: device ${keyId} of ${userId} ${approve ? "approved" : "rejected"} by ${by}`);
        return { ok: true };
      }
      case "devices.untrust": {
        const userId = str(input, "userId", 80);
        const keyId = str(input, "keyId", 40);
        await update((current) => ({
          ...current,
          trust: withRevokedDevices(current.trust, userId, [keyId]),
        }));
        return { ok: true };
      }

      case "preferences.get":
        return hub("GET", "/v1/me/preferences");
      case "preferences.set":
        return hub("PUT", "/v1/me/preferences", {
          ...(input.edition !== undefined ? { edition: input.edition } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.notifyEmail !== undefined ? { notifyEmail: input.notifyEmail } : {}),
        });
      case "notifications.list": {
        const listed = await hub<{
          notifications: ReadonlyArray<ZenHubNotification>;
          unread: number;
        }>("GET", "/v1/notifications");
        // The hub sends routing only; the chat's title comes from this app's cache of runners.
        return {
          ...listed,
          notifications: listed.notifications.map((item) => {
            if (item.shareId === null) return { ...item, shareTitle: null };
            if (!titles.has(item.shareId)) refreshTitle(item.shareId);
            return { ...item, shareTitle: titles.get(item.shareId)?.title ?? null };
          }),
        };
      }
      case "notifications.read":
        return hub("POST", "/v1/notifications/read", {
          ids: Array.isArray(input.ids) ? input.ids : null,
        });

      case "company.create": {
        const created = await hub<{ id: string; name: string }>("POST", "/v1/companies", {
          name: str(input, "name", 80),
        });
        const localCompanyId = optStr(input, "localCompanyId", 64);
        if (localCompanyId !== null) {
          await update((current) => ({
            ...current,
            links: { ...current.links, [localCompanyId]: created.id },
          }));
        }
        return created;
      }
      case "company.link": {
        const localCompanyId = str(input, "localCompanyId", 64);
        const hubCompanyId = optStr(input, "hubCompanyId", 80);
        if (hubCompanyId !== null) {
          // Only companies this account belongs to can be linked.
          await hub("GET", `/v1/companies/${enc(hubCompanyId)}`);
        }
        await update((current) => {
          const links = Object.fromEntries(
            Object.entries(current.links).filter(([key]) => key !== localCompanyId),
          );
          return {
            ...current,
            links: hubCompanyId === null ? links : { ...links, [localCompanyId]: hubCompanyId },
          };
        });
        void syncFromHub();
        return { ok: true };
      }
      case "company.get":
        return hub("GET", `/v1/companies/${enc(str(input, "companyId", 80))}`);
      case "invite.create":
        return hub("POST", `/v1/companies/${enc(str(input, "companyId", 80))}/invites`, {
          email: optStr(input, "email", 254),
          role: optStr(input, "role", 20) ?? "member",
        });
      case "invite.accept":
        return hub("POST", "/v1/invites/accept", {
          token: optStr(input, "token", 400),
          inviteId: optStr(input, "inviteId", 80),
        });
      case "invite.revoke":
        return hub(
          "DELETE",
          `/v1/companies/${enc(str(input, "companyId", 80))}/invites/${enc(str(input, "inviteId", 80))}`,
        );
      case "roles.list":
        return hub("GET", `/v1/companies/${enc(str(input, "companyId", 80))}/roles`);
      case "roles.save": {
        const companyId = enc(str(input, "companyId", 80));
        const roleId = optStr(input, "roleId", 80);
        const body = {
          ...(input.name === undefined ? {} : { name: str(input, "name", 48) }),
          ...(input.description === undefined
            ? {}
            : { description: optStr(input, "description", 200) ?? "" }),
          permissions: Array.isArray(input.permissions)
            ? input.permissions.filter((item) => typeof item === "string")
            : [],
        };
        return roleId === null
          ? hub("POST", `/v1/companies/${companyId}/roles`, body)
          : hub("PUT", `/v1/companies/${companyId}/roles/${enc(roleId)}`, body);
      }
      case "roles.delete":
        return hub(
          "DELETE",
          `/v1/companies/${enc(str(input, "companyId", 80))}/roles/${enc(str(input, "roleId", 80))}`,
        );
      case "member.setAccess":
        return hub(
          "PUT",
          `/v1/companies/${enc(str(input, "companyId", 80))}/members/${enc(str(input, "userId", 80))}/access`,
          {
            customRoleId: optStr(input, "customRoleId", 80),
            scoped: Array.isArray(input.scoped) ? input.scoped : [],
          },
        );
      case "member.setRole":
        return hub(
          "PATCH",
          `/v1/companies/${enc(str(input, "companyId", 80))}/members/${enc(str(input, "userId", 80))}`,
          { role: str(input, "role", 20) },
        );
      case "member.remove":
        return hub(
          "DELETE",
          `/v1/companies/${enc(str(input, "companyId", 80))}/members/${enc(str(input, "userId", 80))}`,
        );
      case "audit.list":
        return hub("GET", `/v1/companies/${enc(str(input, "companyId", 80))}/audit`);
      case "settings.get":
        return hub("GET", `/v1/companies/${enc(hubCompanyFor(input))}/settings`);
      case "settings.set": {
        const memory = asInput(input.memory);
        return afterSync(
          hub("PUT", `/v1/companies/${enc(hubCompanyFor(input))}/settings`, {
            memory: {
              url: optStr(memory, "url", 300),
              saveConversations: memory.saveConversations === true,
            },
          }),
        );
      }

      case "memoryHosted.activate":
        return afterSync(
          hub("POST", `/v1/companies/${enc(hubCompanyFor(input))}/memory/hosted/activate`, {
            saveConversations: input.saveConversations !== false,
          }),
        );

      case "memoryHosted.rules": {
        const body: Record<string, unknown> = {};
        if (typeof input.autoPromoteDecisions === "boolean")
          body.autoPromoteDecisions = input.autoPromoteDecisions;
        if (input.sensitivePolicy === "personal" || input.sensitivePolicy === "drop")
          body.sensitivePolicy = input.sensitivePolicy;
        return hub("PUT", `/v1/companies/${enc(hubCompanyFor(input))}/memory/hosted/rules`, body);
      }
      case "memoryHosted.zones":
        return hub("GET", `/v1/companies/${enc(hubCompanyFor(input))}/memory/hosted/zones`);
      case "memoryHosted.zone":
        return hub(
          "PUT",
          `/v1/companies/${enc(hubCompanyFor(input))}/memory/hosted/zones/${enc(str(input, "ref", 120))}`,
          { restricted: input.restricted === true },
        );
      case "memoryPersonal.get":
        return hub("GET", "/v1/me/memory");
      case "memoryPersonal.activate":
        return afterSync(hub("POST", "/v1/me/memory/activate", {}));
      case "memoryPersonal.removeKey":
        return hub("DELETE", `/v1/me/memory/keys/${enc(str(input, "keyId", 80))}`);
      case "memoryPersonal.forgetCompany":
        return hub("POST", `/v1/me/memory/companies/${enc(hubCompanyFor(input))}/forget`, {});
      case "memoryPersonal.delete":
        return afterSync(
          hub("DELETE", "/v1/me/memory", { confirm: input.confirm === "sterge" ? "sterge" : "" }),
        );

      case "grants.list":
        return hub("GET", `/v1/companies/${enc(str(input, "companyId", 80))}/grants`);
      case "grants.set": {
        const companyId = str(input, "companyId", 80);
        const kind = input.kind === "install" ? "install" : "use";
        const member =
          kind === "use" ? await memberByEmail(companyId, str(input, "email", 254)) : null;
        return afterSync(
          signedGrant({
            companyId,
            packId: str(input, "packId", 80),
            kind,
            userId: member?.userId ?? null,
            userEmail: member?.email.toLowerCase() ?? null,
          }),
        );
      }
      case "grants.revoke":
        return afterSync(
          hub(
            "DELETE",
            `/v1/companies/${enc(str(input, "companyId", 80))}/grants/${enc(str(input, "grantId", 80))}`,
          ),
        );

      case "academy.progress.get":
        return hub("GET", `/v1/companies/${enc(hubCompanyFor(input))}/academy/progress`);
      case "academy.progress.set":
        return hub("PUT", `/v1/companies/${enc(hubCompanyFor(input))}/academy/progress`, {
          lessonId: str(input, "lessonId", 80),
          done: input.done === true,
        });
      case "academy.signals.get":
        return hub("GET", `/v1/companies/${enc(hubCompanyFor(input))}/academy/signals`);
      case "academy.signals.push":
        return hub("PUT", `/v1/companies/${enc(hubCompanyFor(input))}/academy/signals`, {
          topics: asInput(input.topics),
          searches: Array.isArray(input.searches) ? input.searches : [],
        });

      case "runner.aiAccount.get":
        return {
          aiAccount: companyAiStatus(optStr(input, "hubCompanyId", 80) ?? undefined),
          aiAccounts: companyAisStatus(),
        };
      case "runner.aiAccount.set":
        return setAiAccount(input);
      case "runner.set": {
        if (state.environment === null) throw fail("not-signed-in", "Sign in to a hub first.");
        // Hub v9: one machine serves several companies. `companyId` + `enabled` adds or removes
        // one; `companyId: null` stops serving every company.
        const companyId = optStr(input, "companyId", 80);
        const enabled = input.enabled !== false;
        if (companyId !== null && !managesCompany(companyId)) {
          throw fail("forbidden", "Only the company's owners and admins choose its server.");
        }
        // Review P0-6: a company is served only after the owner or admin saw and confirmed the
        // AI account and the connections colleagues get (nothing personal by default).
        const confirmation =
          companyId !== null && enabled && !isRunnerOf(state, companyId)
            ? requireConfirmation(input, companyId)
            : null;
        const next =
          companyId === null
            ? []
            : enabled
              ? [...state.runnerCompanyIds.filter((id) => id !== companyId), companyId]
              : state.runnerCompanyIds.filter((id) => id !== companyId);
        // `companyId` too, so a hub from before v9 keeps working (it serves only the first one).
        const answer = await hub<{ runnerCompanyIds?: ReadonlyArray<string> }>(
          "PUT",
          `/v1/environments/${enc(state.environment.id)}/runner`,
          { companyIds: next, companyId: next[0] ?? null },
        );
        const served = answer.runnerCompanyIds ?? next.slice(0, 1);
        const stopped = state.runnerCompanyIds.filter((id) => !served.includes(id));
        await update((current) => ({
          ...current,
          ...withRunnerCompanies(served),
          companyAis: Object.fromEntries(
            Object.entries(current.companyAis).filter(([id]) => served.includes(id)),
          ),
          // The hub ends a company's chats when the machine stops serving it; so does the list.
          shares: Object.fromEntries(
            Object.entries(current.shares).filter(
              ([, share]) => share.kind !== "company" || !stopped.includes(share.companyId),
            ),
          ),
        }));
        for (const id of stopped) vault.remove(COMPANY_AI_VAULT, id);
        if (stopped.length > 0) {
          setConsents(
            Object.fromEntries(Object.entries(consents).filter(([id]) => !stopped.includes(id))),
          );
        }
        if (confirmation !== null && companyId !== null && served.includes(companyId)) {
          await recordConfirmation(companyId, confirmation, input);
        }
        void syncFromHub();
        return { ok: true, runnerCompanyId: served[0] ?? null, runnerCompanyIds: served };
      }
      case "runner.consent.get": {
        // What each company this machine serves may use (null: not confirmed yet).
        return {
          consents: Object.fromEntries(
            state.runnerCompanyIds.map((id) => [id, consents[id] ?? null]),
          ),
        };
      }
      case "runner.consent.set": {
        // A machine that was a company server before the confirmation existed, or a change.
        const companyId = str(input, "companyId", 80);
        if (!isRunnerOf(state, companyId)) {
          throw fail("invalid-input", "Make this machine the company server first.");
        }
        const confirmation = requireConfirmation(input, companyId);
        await recordConfirmation(companyId, confirmation, input);
        return { ok: true, consent: consents[companyId] ?? null };
      }

      case "shares.list": {
        const listed = await hub<{ shares: ReadonlyArray<ZenHubShare> }>("GET", "/v1/shares");
        return {
          shares: await Promise.all(
            listed.shares.map(async (share) => ({ ...share, title: await titleFor(share) })),
          ),
        };
      }
      case "share.create":
        return createShare(input, null);
      case "handover.create":
        if (optStr(input, "audienceUserId", 80) === null) {
          throw fail("invalid-input", "Choose the colleague to hand the chat over to.");
        }
        return createShare(input, "handover");
      case "share.revoke": {
        const shareId = str(input, "shareId", 80);
        await hub("DELETE", `/v1/shares/${enc(shareId)}`);
        await update((current) => ({
          ...current,
          shares: Object.fromEntries(
            Object.entries(current.shares).filter(([key]) => key !== shareId),
          ),
        }));
        return { ok: true };
      }
      case "share.get": {
        const shareId = str(input, "shareId", 80);
        const detail = await hub<{
          share: ZenHubShare;
          comments: ReadonlyArray<ZenHubComment & { sealed?: boolean; body: string | null }>;
        }>("GET", `/v1/shares/${enc(shareId)}`);
        // Title and comments come from the owner's runner, sealed to this device.
        const opened = detail.share.online
          ? await meta(shareId, false, 20_000).catch(() => null)
          : null;
        const legacy = detail.comments.flatMap((comment): Array<ZenHubComment> =>
          comment.sealed === true || comment.body === null
            ? []
            : [{ ...comment, body: comment.body, legacy: true, verified: false }],
        );
        const comments = Array.isArray(opened?.comments)
          ? (opened.comments as ReadonlyArray<ZenHubComment>)
          : legacy;
        const title =
          typeof opened?.title === "string" && opened.title.trim() !== ""
            ? opened.title
            : await titleFor(detail.share);
        return {
          share: { ...detail.share, title },
          comments,
          unreadableComments: opened === null ? detail.comments.length - legacy.length : 0,
        };
      }
      case "share.view": {
        const shareId = str(input, "shareId", 80);
        const viewed = await relayCall(
          shareId,
          "thread.view",
          `/v1/shares/${enc(shareId)}/view`,
          { since: optStr(input, "since", 2000) },
          LONG_POLL_MS + 15_000,
        );
        rememberTitle(shareId, asInput(viewed).title);
        return viewed;
      }
      case "share.comment":
        return postComment(
          str(input, "shareId", 80),
          str(input, "body", 4000),
          optStr(input, "messageId", 200),
        );
      case "share.prompt": {
        const shareId = str(input, "shareId", 80);
        return relayCall(shareId, "thread.prompt", `/v1/shares/${enc(shareId)}/prompt`, {
          text: str(input, "text", 100_000),
        });
      }
      case "share.copy": {
        const shareId = str(input, "shareId", 80);
        const detail = await shareDetail(shareId);
        const exported = (await relayCall(
          shareId,
          "thread.export",
          `/v1/shares/${enc(shareId)}/export`,
          {},
        )) as ZenHubThreadSnapshot;
        return importSnapshot(input, shareId, exported, detail.share.ownerName, "copy");
      }
      case "handover.accept": {
        const shareId = str(input, "shareId", 80);
        const detail = await shareDetail(shareId);
        const exported = (await relayCall(
          shareId,
          "thread.export",
          `/v1/shares/${enc(shareId)}/handover/accept`,
          {},
        )) as ZenHubThreadSnapshot;
        const imported = await importSnapshot(
          input,
          shareId,
          exported,
          detail.share.ownerName,
          "handover",
        );
        await relayCall(
          shareId,
          "thread.handedOver",
          `/v1/shares/${enc(shareId)}/handover/complete`,
          {},
        );
        return imported;
      }
      case "handover.decline":
        return hub("POST", `/v1/shares/${enc(str(input, "shareId", 80))}/handover/decline`, {});
    }
  };

  const company = makeCompanyHub({
    file: NodePath.join(zenDir, "hub-company.json"),
    state: () => state,
    update,
    hub,
    ensureDevice,
    runnerIdentity,
    approveInstall: async (companyId, packId) => {
      await signedGrant({ companyId, packId, kind: "install", userId: null, userEmail: null });
    },
    log,
    serverBlock: companyServerBlock,
    // Hub v9 `staff.follow`: the same view as a shared chat, long-polled, read-only.
    snapshotThread: async (threadId, since) => {
      const deadline = Date.now() + LONG_POLL_MS;
      for (;;) {
        const current = await snapshot(threadId, VIEW_MESSAGE_LIMIT, "company", true);
        if (since === null || current.version !== since || Date.now() >= deadline) return current;
        await sleep(LONG_POLL_STEP_MS);
      }
    },
    // Hub v9: what happened on this runner goes to the company's audit log (ids only).
    reportAudit: (hubCompanyId, events) => {
      const environment = state.environment;
      if (state.hubUrl === null || environment === null || !isRunnerOf(state, hubCompanyId)) return;
      void runnerFetch(state.hubUrl, environment.credential, "/v1/runner/audit", {
        companyId: hubCompanyId,
        events: events.map((event) =>
          Object.fromEntries(Object.entries(event).filter(([, value]) => value !== null)),
        ),
      }).catch((error: unknown) => log(`zen hub: audit report failed: ${String(error)}`));
    },
  });
  setZenCompanyHubBridge({ ...company.bridge, syncNow: () => syncFromHub() });

  setZenHubBridge({
    library: {
      hubUrl: () => state.hubUrl ?? defaultHubUrl,
      token: () => state.session?.token ?? null,
      userId: () => state.session?.user.id ?? null,
      sign: async (message) => signText(await ensureDevice(), message),
    },
    advisoriesUrl: () =>
      state.hubUrl === null ? null : `${state.hubUrl.replace(/\/$/, "")}/v1/toolchains/advisories`,
    roleForLocalCompany: (localCompanyId) => {
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined || state.session === null) return undefined;
      return state.cache.roles[hubCompanyId] ?? null;
    },
    memorySettings: (localCompanyId) => {
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined || state.session === null) return null;
      return state.cache.settings[hubCompanyId] ?? null;
    },
    setMemorySettings: async (localCompanyId, settings) => {
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined) return;
      await hub("PUT", `/v1/companies/${enc(hubCompanyId)}/settings`, { memory: settings });
      await update((current) => ({
        ...current,
        cache: {
          ...current.cache,
          settings: { ...current.cache.settings, [hubCompanyId]: settings },
        },
      }));
    },
    hostedMemory: (localCompanyId) => {
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined || state.session === null) return null;
      return state.cache.hosted?.[hubCompanyId] ?? null;
    },
    activateHostedMemory: async (localCompanyId, saveConversations) => {
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined)
        throw new Error("This company is not linked to a hub company.");
      const answer = await hub<HostedMemoryStatus>(
        "POST",
        `/v1/companies/${enc(hubCompanyId)}/memory/hosted/activate`,
        { saveConversations },
      );
      const status: HostedMemoryStatus = {
        available: answer.available,
        activated: answer.activated,
        active: answer.active,
        url: answer.url,
      };
      await update((current) => ({
        ...current,
        cache: {
          ...current.cache,
          hosted: { ...current.cache.hosted, [hubCompanyId]: status },
          settings:
            status.url === null
              ? current.cache.settings
              : {
                  ...current.cache.settings,
                  [hubCompanyId]: { url: status.url, saveConversations },
                },
        },
      }));
    },
    personalMemory: () => (state.session === null ? null : (state.cache.personalMemory ?? null)),
    activatePersonalMemory: async () => {
      const answer = await hub<PersonalMemoryStatus>("POST", "/v1/me/memory/activate", {});
      const status = { available: answer.available, active: answer.active, url: answer.url };
      await update((current) => ({
        ...current,
        cache: { ...current.cache, personalMemory: status },
      }));
      return status;
    },
    issuePersonalMemoryKey: async () => {
      const machine = (state.environment?.name ?? NodeOS.hostname()).slice(0, 80) || "machine";
      return hub<{ url: string; apiKey: string; keyId: string }>("POST", "/v1/me/memory/keys", {
        machine,
      });
    },
    hubUserId: () => state.session?.user?.id ?? null,
    issueMemoryKey: async (localCompanyId) => {
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined)
        throw new Error("This company is not linked to a hub company.");
      const machine = (state.environment?.name ?? NodeOS.hostname()).slice(0, 80) || "machine";
      return hub<{ url: string; apiKey: string; keyId: string }>(
        "POST",
        `/v1/companies/${enc(hubCompanyId)}/memory/hosted/keys`,
        { machine },
      );
    },
    accessLedger: (localCompanyId) => runnerLedgerFor(state, localCompanyId),
    // Hub v9: each served company on its own (the Enterprise screen picks one).
    runnerRole: (hubCompanyId) => {
      const companyId = runnerCompanyFor(state, { hubCompanyId: hubCompanyId ?? null });
      return companyId === null ? null : (state.cache.roles[companyId] ?? null);
    },
    servedCompanies: () =>
      state.session === null
        ? []
        : state.runnerCompanyIds.map((id) => ({
            id,
            name: state.cache.names?.[id] ?? id,
            role: state.cache.roles[id] ?? null,
          })),
    ledgerOfHubCompany: (hubCompanyId) =>
      isRunnerOf(state, hubCompanyId) && state.session !== null
        ? runnerLedgerOfHub(state, hubCompanyId)
        : null,
    installApproved: (packId, scope) => runnerInstallApproved(state, packId, scope),
    grant: async ({ packId, user, companyId: wanted }) => {
      const companyId = requireRunnerCompany(wanted);
      const member = await memberByEmail(companyId, user);
      await signedGrant({
        companyId,
        packId,
        kind: "use",
        userId: member.userId,
        userEmail: member.email.toLowerCase(),
      });
      await syncFromHub();
    },
    revoke: async ({ packId, user, companyId: wanted }) => {
      const companyId = requireRunnerCompany(wanted);
      const listed = await hub<{ grants: ReadonlyArray<HubGrant> }>(
        "GET",
        `/v1/companies/${enc(companyId)}/grants`,
      );
      for (const grant of listed.grants) {
        if (
          grant.packId === packId &&
          grant.kind === "use" &&
          grant.userEmail?.toLowerCase() === user.toLowerCase()
        ) {
          await hub("DELETE", `/v1/companies/${enc(companyId)}/grants/${enc(grant.id)}`);
        }
      }
      await syncFromHub();
    },
    approveInstall: async ({ packId, companyId: wanted }) => {
      const companyId = requireRunnerCompany(wanted);
      await signedGrant({ companyId, packId, kind: "install", userId: null, userEmail: null });
      await syncFromHub();
    },
  });

  // A company runner that uses a company API key gives it to company chats only, in the agent's
  // process environment (never in the chat, the settings flag or the hub).
  setZenThreadEnvContributor("hub-company-ai", (_threadId, projectId) => {
    if (projectId === undefined) return null;
    // Each company's chats get that company's key only (hub v9: one runner, several companies).
    const { kind, hubCompanyId } = threadKind({
      projectId,
      projectCompanies: readProjectCompaniesSync(companiesFile),
      links: state.links,
      runnerCompanyIds: state.runnerCompanyIds,
    });
    if (kind !== "company" || hubCompanyId === null) return null;
    // The claude.ai connectors of the machine's account stay off unless one was shared (the
    // settings contributor below denies the rest by name; this one knows the project for sure).
    const connectors = companyChatMcpPolicy(consents[hubCompanyId], []).env;
    const account = state.companyAis[hubCompanyId];
    if (account === undefined || account.mode !== "api-key") return connectors;
    const keyEnv = companyKeyEnv(account, vault.get(COMPANY_AI_VAULT, hubCompanyId));
    return keyEnv === null ? connectors : { ...connectors, ...keyEnv };
  });

  // Review P0-6: company chats on this server see only the connections shared on purpose; the
  // machine's personal ones (claude.ai connectors, its own MCP servers) are denied by default.
  setZenThreadSettingsContributor("hub-company-connectors", (_threadId, cwd) => {
    const projectId = zenProjectIdForCwd(cwd);
    if (projectId === null || state.runnerCompanyIds.length === 0) return null;
    const { kind, hubCompanyId } = threadKind({
      projectId,
      projectCompanies: readProjectCompaniesSync(companiesFile),
      links: state.links,
      runnerCompanyIds: state.runnerCompanyIds,
    });
    if (kind !== "company" || hubCompanyId === null) return null;
    const policy = companyChatMcpPolicy(consents[hubCompanyId], readClaudeConfigServerNames(cwd));
    return { env: policy.env, deny: policy.deny };
  });

  if (state.session !== null) startRunner();
  const syncTimer = setInterval(() => {
    if (state.session !== null) void syncFromHub();
  }, SYNC_INTERVAL_MS);
  syncTimer.unref();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopRunner();
      clearInterval(syncTimer);
      setZenHubBridge(null);
      setZenCompanyHubBridge(null);
      setZenThreadEnvContributor("hub-company-ai", null);
      setZenThreadSettingsContributor("hub-company-connectors", null);
    }),
  );

  const call = (input: ZenHubCallInput) =>
    Effect.tryPromise({ try: () => run(input.op, input.input), catch: toZenHubError });

  return ZenHub.of({ call });
});

export const layer = Layer.effect(ZenHub, make);

/** RPC handler for ws.ts; the service is optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenHub["Service"]>) => ({
  [ZEN_HUB_WS_METHODS.call]: (input: ZenHubCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(fail("unavailable", "The hub is not available on this server.")),
});
