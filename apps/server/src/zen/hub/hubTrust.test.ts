// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// Device signatures, runner-side trust, end-to-end sealing, hub grants and shared-view rows.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";

import {
  canonicalJson,
  deviceCertMessage,
  fingerprintOf,
  newDeviceIdentity,
  open,
  requestMessage,
  responseMessage,
  seal,
  sealContext,
  signRequest,
  signText,
  statementMessage,
  verifyText,
} from "./hubCrypto.ts";
import {
  checkRunnerKeys,
  emptyTrustStore,
  isApprovedPin,
  MAX_PENDING_PER_PERSON,
  PENDING_DEVICE_REFUSAL,
  pendingRefusal,
  trustDevice,
  verifyCommentSignature,
  verifyHubGrants,
  verifyRelayRequest,
  withApprovedDevice,
  withPinnedDevice,
  withRejectedDevice,
  withRevokedDevices,
  type HubGrant,
  type TrustStore,
} from "./relayTrust.ts";
import { buildRows, digestWork, MEDIA_TOTAL_MAX_BYTES } from "./richSnapshot.ts";

const NOW = 1_800_000_000_000;
const ISO = new Date(NOW).toISOString();

function frameFor(
  identity: ReturnType<typeof newDeviceIdentity>,
  input: {
    readonly op?: string;
    readonly shareId?: string;
    readonly userId?: string;
    readonly payload?: Record<string, unknown>;
    readonly now?: number;
    readonly certs?: ReadonlyArray<{
      signerKeyId: string;
      signerPublicKey: string;
      signature: string;
    }>;
  } = {},
) {
  const op = input.op ?? "thread.prompt";
  const shareId = input.shareId ?? "sh_1";
  const userId = input.userId ?? "usr_maria";
  const payload = input.payload ?? { sealed: "abc" };
  const sig = signRequest(identity, { op, shareId, userId, payload }, input.now ?? NOW);
  return {
    op,
    shareId,
    actor: { userId },
    input: payload,
    sig,
    device: {
      userId,
      keyId: identity.keyId,
      signPublicKey: identity.signPublicKey,
      boxPublicKey: identity.boxPublicKey,
      certs: input.certs ?? [],
    },
  };
}

const never = () => false;

describe("signed requests (shared format with the hub)", () => {
  it("matches the hub's test vector byte for byte", () => {
    // Same vector as zen-hub test/crypto.test.ts.
    expect(
      requestMessage({
        op: "thread.prompt",
        shareId: "sh_1",
        userId: "usr_1",
        keyId: "k1",
        ts: 1_700_000_000_000,
        nonce: "nonce-nonce-nonce-1",
        payload: { text: "Salut" },
      }),
    ).toBe(
      'zen-hub-request-v1\n{"body":"hL-zmRevZWgMIZXg8NsKC69TR1uR8Iz0_fUW4h7GKBg","keyId":"k1","nonce":"nonce-nonce-nonce-1","op":"thread.prompt","shareId":"sh_1","ts":1700000000000,"userId":"usr_1"}',
    );
    expect(canonicalJson({ b: [2, { d: 1, c: null }], a: "x" })).toBe(
      '{"a":"x","b":[2,{"c":null,"d":1}]}',
    );
  });

  it("signs and verifies with the device key; any change breaks it", () => {
    const device = newDeviceIdentity();
    const signature = signText(device, "hello");
    expect(verifyText(device.signPublicKey, "hello", signature)).toBe(true);
    expect(verifyText(device.signPublicKey, "hello!", signature)).toBe(false);
    expect(verifyText(newDeviceIdentity().signPublicKey, "hello", signature)).toBe(false);
  });
});

describe("runner trust: a forged or replayed prompt is refused", () => {
  const maria = newDeviceIdentity();
  const trusted: TrustStore = withPinnedDevice(emptyTrustStore(), "usr_maria", {
    keyId: maria.keyId,
    signPublicKey: maria.signPublicKey,
    boxPublicKey: maria.boxPublicKey,
    via: "first-use",
    at: ISO,
  });

  it("accepts a signed request from a pinned device", () => {
    const decision = verifyRelayRequest(trusted, frameFor(maria), NOW, never);
    expect(decision.ok).toBe(true);
  });

  it("pins the first device seen for a person (trust on first use), as pending", () => {
    const decision = verifyRelayRequest(emptyTrustStore(), frameFor(maria), NOW, never);
    expect(decision.ok && decision.pin?.via).toBe("first-use");
    expect(decision.ok && decision.pin?.state).toBe("pending");
  });

  it("refuses a request without a signature", () => {
    const frame = { ...frameFor(maria), sig: undefined };
    expect(verifyRelayRequest(trusted, frame, NOW, never)).toMatchObject({ ok: false });
  });

  it("refuses a hub that swaps the prompt text", () => {
    const frame = {
      ...frameFor(maria, { payload: { sealed: "pay 10" } }),
      input: { sealed: "pay 10000" },
    };
    expect(verifyRelayRequest(trusted, frame, NOW, never)).toMatchObject({
      ok: false,
      reason: "The request signature is not valid.",
    });
  });

  it("refuses a hub that signs with a key of its own for a person this runner knows", () => {
    const forger = newDeviceIdentity();
    const decision = verifyRelayRequest(trusted, frameFor(forger), NOW, never);
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.reason).toMatch(/new device/);
  });

  it("refuses a forged certificate, accepts one made by a pinned device", () => {
    const phone = newDeviceIdentity();
    const message = deviceCertMessage({
      userId: "usr_maria",
      keyId: phone.keyId,
      signPublicKey: phone.signPublicKey,
      boxPublicKey: phone.boxPublicKey,
    });
    const forged = frameFor(phone, {
      certs: [
        {
          signerKeyId: maria.keyId,
          signerPublicKey: maria.signPublicKey,
          signature: signText(newDeviceIdentity(), message),
        },
      ],
    });
    expect(verifyRelayRequest(trusted, forged, NOW, never).ok).toBe(false);
    // A hub cannot help by sending a different signer public key under Maria's key id.
    const attacker = newDeviceIdentity();
    const swapped = frameFor(phone, {
      certs: [
        {
          signerKeyId: maria.keyId,
          signerPublicKey: attacker.signPublicKey,
          signature: signText(attacker, message),
        },
      ],
    });
    expect(verifyRelayRequest(trusted, swapped, NOW, never).ok).toBe(false);
    const approved = frameFor(phone, {
      certs: [
        {
          signerKeyId: maria.keyId,
          signerPublicKey: maria.signPublicKey,
          signature: signText(maria, message),
        },
      ],
    });
    const decision = verifyRelayRequest(trusted, approved, NOW, never);
    expect(decision.ok && decision.pin?.via).toBe("approved");
  });

  it("refuses a signature by Maria's key presented as someone else", () => {
    const frame = frameFor(maria);
    const asOther = { ...frame, actor: { userId: "usr_alex" } };
    expect(verifyRelayRequest(trusted, asOther, NOW, never).ok).toBe(false);
  });

  it("refuses replays and stale requests", () => {
    const seen = new Set<string>();
    const check = (nonce: string) => (seen.has(nonce) ? true : (seen.add(nonce), false));
    const frame = frameFor(maria);
    expect(verifyRelayRequest(trusted, frame, NOW, check).ok).toBe(true);
    expect(verifyRelayRequest(trusted, frame, NOW, check)).toMatchObject({
      ok: false,
      reason: "This request was already used.",
    });
    const stale = frameFor(maria, { now: NOW - 6 * 60_000 });
    expect(verifyRelayRequest(trusted, stale, NOW, check)).toMatchObject({
      ok: false,
      reason: "The request is too old.",
    });
  });

  it("refuses a device signed out on the hub, even with a certificate", () => {
    const revoked = withRevokedDevices(trusted, "usr_maria", [maria.keyId]);
    expect(trustDevice(revoked, { userId: "usr_maria", ...maria }, ISO).ok).toBe(false);
  });

  it("refuses a pinned key id whose keys changed", () => {
    const other = newDeviceIdentity();
    const decision = trustDevice(
      trusted,
      {
        userId: "usr_maria",
        keyId: maria.keyId,
        signPublicKey: other.signPublicKey,
        boxPublicKey: other.boxPublicKey,
      },
      ISO,
    );
    expect(decision.ok).toBe(false);
  });
});

describe("end-to-end sealing", () => {
  it("only the recipient opens it, only in the same context, and tampering fails", () => {
    const runner = newDeviceIdentity();
    const context = sealContext("thread.prompt", "sh_1", "n1", "request");
    const box = seal(runner.boxPublicKey, '{"text":"Pret nou: 12 lei"}', context);
    expect(box).not.toContain("12 lei");
    expect(open(runner, box, context)).toBe('{"text":"Pret nou: 12 lei"}');
    expect(() => open(newDeviceIdentity(), box, context)).toThrow();
    expect(() =>
      open(runner, box, sealContext("thread.prompt", "sh_2", "n1", "request")),
    ).toThrow();
    const raw = Buffer.from(box, "base64url");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => open(runner, raw.toString("base64url"), context)).toThrow();
  });

  it("binds the runner's signature to the sealed answer and the request", () => {
    const runner = newDeviceIdentity();
    const box = seal(newDeviceIdentity().boxPublicKey, "{}", "ctx");
    const signature = signText(
      runner,
      responseMessage({ op: "thread.view", shareId: "s", nonce: "n", sealed: box }),
    );
    expect(
      verifyText(
        runner.signPublicKey,
        responseMessage({ op: "thread.view", shareId: "s", nonce: "n", sealed: box }),
        signature,
      ),
    ).toBe(true);
    expect(
      verifyText(
        runner.signPublicKey,
        responseMessage({ op: "thread.view", shareId: "s", nonce: "other", sealed: box }),
        signature,
      ),
    ).toBe(false);
  });

  it("pins runner keys on first use and refuses changed ones", () => {
    const keys = { signPublicKey: "a".repeat(43), boxPublicKey: "b".repeat(43) };
    const first = checkRunnerKeys(emptyTrustStore(), "env_1", keys, ISO);
    expect(first.ok && first.pin).toBeTruthy();
    const pinned: TrustStore = { ...emptyTrustStore(), runners: { env_1: { ...keys, at: ISO } } };
    expect(checkRunnerKeys(pinned, "env_1", keys, ISO)).toEqual({ ok: true, pin: null });
    expect(
      checkRunnerKeys(pinned, "env_1", { ...keys, boxPublicKey: "c".repeat(43) }, ISO).ok,
    ).toBe(false);
    expect(checkRunnerKeys(pinned, "env_1", null, ISO).ok).toBe(false);
  });
});

describe("Enterprise grants from the hub, verified on the runner", () => {
  const admin = newDeviceIdentity();
  const grantOf = (
    {
      statement: statementOverride,
      ...overrides
    }: Partial<Omit<HubGrant, "statement">> & { statement?: Record<string, unknown> } = {},
    signer = admin,
  ): HubGrant => {
    const statement = statementOverride ?? {
      action: "grant",
      companyId: "co_acme",
      packId: "meta-ads-report",
      kind: "use",
      userId: "usr_maria",
      userEmail: "maria@acme.example",
      grantedBy: "usr_admin",
      ts: NOW,
    };
    return {
      id: "gr_1",
      packId: "meta-ads-report",
      kind: "use",
      userId: "usr_maria",
      userEmail: "maria@acme.example",
      grantedBy: "usr_admin",
      grantedByName: "Ana Admin",
      statement: canonicalJson(statement),
      signerKeyId: signer.keyId,
      signature: signText(signer, statementMessage(statement)),
      signerPublicKey: signer.signPublicKey,
      signerCerts: [],
      createdAt: ISO,
      ...overrides,
    };
  };
  // The admin's device, approved on this runner.
  const approvedAdmin = withPinnedDevice(emptyTrustStore(), "usr_admin", {
    keyId: admin.keyId,
    signPublicKey: admin.signPublicKey,
    boxPublicKey: admin.boxPublicKey,
    via: "first-use",
    at: ISO,
  });
  const base = {
    companyId: "co_acme",
    managers: new Set(["usr_admin"]),
    trust: approvedAdmin,
    nowIso: ISO,
  };

  it("keeps a grant signed by an admin's approved device", () => {
    const result = verifyHubGrants({ ...base, grants: [grantOf()] });
    expect(result.grants).toEqual([
      { packId: "meta-ads-report", user: "maria@acme.example", grantedBy: "Ana Admin", at: ISO },
    ]);
    expect(result.refused).toEqual([]);
  });

  it("refuses a grant from an admin device seen for the first time, and pins it as pending", () => {
    const result = verifyHubGrants({ ...base, trust: emptyTrustStore(), grants: [grantOf()] });
    expect(result.grants).toEqual([]);
    expect(result.refused[0]?.reason).toMatch(/waiting for approval/);
    expect(result.pins.map((pin) => [pin.userId, pin.device.state])).toEqual([
      ["usr_admin", "pending"],
    ]);
    // Once the runner's owner approves that device, the same grant counts.
    let trust = emptyTrustStore();
    for (const pin of result.pins) trust = withPinnedDevice(trust, pin.userId, pin.device);
    const approved = withApprovedDevice(trust, "usr_admin", admin.keyId, "alex@acme.example", ISO)!;
    expect(verifyHubGrants({ ...base, trust: approved, grants: [grantOf()] }).grants).toHaveLength(
      1,
    );
  });

  it("drops grants from non-admins, for another company, re-labelled, or badly signed", () => {
    expect(verifyHubGrants({ ...base, managers: new Set(), grants: [grantOf()] }).grants).toEqual(
      [],
    );
    expect(verifyHubGrants({ ...base, companyId: "co_other", grants: [grantOf()] }).grants).toEqual(
      [],
    );
    expect(
      verifyHubGrants({ ...base, grants: [grantOf({ userEmail: "olga@acme.example" })] }).grants,
    ).toEqual([]);
    expect(
      verifyHubGrants({
        ...base,
        grants: [grantOf({ signature: grantOf({}, newDeviceIdentity()).signature })],
      }).grants,
    ).toEqual([]);
  });

  it("drops a grant signed by an unknown key once the admin's real device is pinned", () => {
    const trust = approvedAdmin;
    const forged = grantOf({}, newDeviceIdentity());
    const result = verifyHubGrants({ ...base, trust, grants: [forged] });
    expect(result.grants).toEqual([]);
    expect(result.refused[0]?.reason).toMatch(/new device/);
  });

  it("turns install approvals into the approvals list", () => {
    const statement = {
      action: "grant",
      companyId: "co_acme",
      packId: "meta-ads-report",
      kind: "install",
      userId: null,
      userEmail: null,
      grantedBy: "usr_admin",
      ts: NOW,
    };
    const result = verifyHubGrants({
      ...base,
      grants: [grantOf({ kind: "install", userId: null, userEmail: null, statement })],
    });
    expect(result.approvals).toEqual([
      { packId: "meta-ads-report", approvedBy: "Ana Admin", at: ISO },
    ]);
  });
});

describe("shared view rows", () => {
  it("folds tool work between messages with the Office digest", () => {
    const rows = buildRows({
      messages: [
        {
          id: "m1",
          role: "user",
          text: "Fa raportul",
          streaming: false,
          createdAt: 1,
          attachments: [],
        },
        {
          id: "m2",
          role: "assistant",
          text: "Gata",
          streaming: false,
          createdAt: 10,
          attachments: [],
        },
      ],
      items: [
        {
          id: "t1",
          type: "dynamic_tool",
          status: "completed",
          title: "Read",
          at: 2,
          toolName: "Read",
          input: { file_path: "/w/preturi.xlsx" },
        },
        {
          id: "t2",
          type: "file_change",
          status: "completed",
          title: null,
          at: 3,
          fileName: "/w/raport.docx",
        },
        { id: "t3", type: "command_execution", status: "failed", title: "pandoc", at: 4 },
        { id: "t4", type: "web_search", status: "completed", title: "search", at: 5 },
        { id: "t5", type: "assistant_message", status: "completed", title: null, at: 6 },
      ],
      media: () => null,
    });
    expect(rows.map((row) => row.kind)).toEqual(["message", "work", "message"]);
    const work = rows[1]!;
    expect(work.kind === "work" && work.digest).toEqual({
      changedFiles: ["raport.docx"],
      readFiles: ["preturi.xlsx"],
      webSearches: 1,
      otherSteps: 1,
      active: false,
      failed: 1,
    });
    expect(work.kind === "work" && work.steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "failed",
      "done",
    ]);
  });

  it("inlines images, audio and video within the budget, newest first; files never", () => {
    const big = MEDIA_TOTAL_MAX_BYTES - 1000;
    const rows = buildRows({
      messages: [
        {
          id: "m1",
          role: "user",
          text: "",
          streaming: false,
          createdAt: 1,
          attachments: [
            {
              type: "image",
              id: "old",
              name: "old.png",
              mimeType: "image/png",
              sizeBytes: 2_000_000,
            },
          ],
        },
        {
          id: "m2",
          role: "user",
          text: "Uite",
          streaming: false,
          createdAt: 2,
          attachments: [
            { type: "file", id: "clip", name: "voce.m4a", mimeType: "audio/mp4", sizeBytes: 1000 },
            {
              type: "file",
              id: "doc",
              name: "oferta.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1000,
            },
            { type: "file", id: "huge", name: "film.mp4", mimeType: "video/mp4", sizeBytes: big },
          ],
        },
      ],
      items: [],
      media: (attachment) => `data:${attachment.mimeType};base64,AA==`,
    });
    const attachments = rows.flatMap((row) => (row.kind === "message" ? row.attachments : []));
    const byId = Object.fromEntries(attachments.map((item) => [item.id, item]));
    expect(byId.clip?.kind).toBe("audio");
    expect(byId.clip?.dataUrl).toMatch(/^data:audio/);
    expect(byId.doc?.dataUrl).toBeNull();
    expect(byId.huge?.dataUrl).toBeNull();
    expect(byId.old?.dataUrl).toMatch(/^data:image/);
  });

  it("marks running work as active", () => {
    expect(
      digestWork([{ id: "a", type: "command_execution", status: "running", title: "x", at: 1 }])
        .active,
    ).toBe(true);
  });
});

describe("device identity", () => {
  it("creates distinct keys and keeps private halves out of the public fields", () => {
    const one = newDeviceIdentity();
    const two = newDeviceIdentity();
    expect(one.keyId).not.toBe(two.keyId);
    expect(one.signPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      NodeCrypto.createPrivateKey({
        key: Buffer.from(one.signPrivateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      }).asymmetricKeyType,
    ).toBe("ed25519");
  });
});

describe("first-device trust: read-only until approved on the runner", () => {
  const maria = newDeviceIdentity();
  const pinFirst = (trust: TrustStore, identity = maria, userId = "usr_maria") => {
    const decision = verifyRelayRequest(trust, frameFor(identity, { userId }), NOW, never);
    if (!decision.ok || decision.pin === null) throw new Error("expected a new pin");
    return { decision, trust: withPinnedDevice(trust, userId, decision.pin) };
  };
  const certFrom = (signer: ReturnType<typeof newDeviceIdentity>, target: typeof maria) => ({
    signerKeyId: signer.keyId,
    signerPublicKey: signer.signPublicKey,
    signature: signText(
      signer,
      deviceCertMessage({
        userId: "usr_maria",
        keyId: target.keyId,
        signPublicKey: target.signPublicKey,
        boxPublicKey: target.boxPublicKey,
      }),
    ),
  });

  it("a pending device may view (and read title and comments) but not prompt or copy", () => {
    const { decision } = pinFirst(emptyTrustStore());
    if (!decision.ok) throw new Error("expected ok");
    expect(pendingRefusal(decision.device, "thread.view")).toBeNull();
    expect(pendingRefusal(decision.device, "thread.meta")).toBeNull();
    expect(pendingRefusal(decision.device, "thread.prompt")).toBe(PENDING_DEVICE_REFUSAL);
    expect(PENDING_DEVICE_REFUSAL).toMatch(/waiting for approval of this device on the runner/i);
    // Copies carry the whole history and files, and a hand-over archives the original: both wait.
    expect(pendingRefusal(decision.device, "thread.export")).toBe(PENDING_DEVICE_REFUSAL);
    expect(pendingRefusal(decision.device, "thread.attachment")).toBe(PENDING_DEVICE_REFUSAL);
    expect(pendingRefusal(decision.device, "thread.handedOver")).toBe(PENDING_DEVICE_REFUSAL);
  });

  it("stays pending on its next requests, and is approved by the runner's owner", () => {
    const { trust } = pinFirst(emptyTrustStore());
    const again = verifyRelayRequest(trust, frameFor(maria), NOW, never);
    expect(again.ok && again.pin).toBeNull();
    expect(again.ok && pendingRefusal(again.device, "thread.prompt")).toBe(PENDING_DEVICE_REFUSAL);
    const approved = withApprovedDevice(trust, "usr_maria", maria.keyId, "alex@acme.example", ISO)!;
    const after = verifyRelayRequest(approved, frameFor(maria), NOW, never);
    expect(after.ok && isApprovedPin(after.device)).toBe(true);
    expect(after.ok && pendingRefusal(after.device, "thread.prompt")).toBeNull();
    expect(after.ok && after.device.approvedBy).toBe("alex@acme.example");
    expect(withApprovedDevice(trust, "usr_maria", "unknown", "x", ISO)).toBeNull();
  });

  it("a rejected device is unpinned and never pinned again on this runner", () => {
    const { trust } = pinFirst(emptyTrustStore());
    const rejected = withRejectedDevice(trust, "usr_maria", maria.keyId);
    expect(rejected.devices.usr_maria).toEqual([]);
    expect(verifyRelayRequest(rejected, frameFor(maria), NOW, never)).toMatchObject({
      ok: false,
      reason: "This device was rejected on the runner.",
    });
    // A different device of the same person can still ask (pending again).
    const laptop = newDeviceIdentity();
    const next = verifyRelayRequest(rejected, frameFor(laptop), NOW, never);
    expect(next.ok && next.pin?.state).toBe("pending");
  });

  it("a device cross-signed by an approved device is approved at once", () => {
    const { trust } = pinFirst(emptyTrustStore());
    const approved = withApprovedDevice(trust, "usr_maria", maria.keyId, "alex", ISO)!;
    const phone = newDeviceIdentity();
    const decision = verifyRelayRequest(
      approved,
      frameFor(phone, { certs: [certFrom(maria, phone)] }),
      NOW,
      never,
    );
    expect(decision.ok && decision.pin?.via).toBe("approved");
    expect(decision.ok && isApprovedPin(decision.device)).toBe(true);
  });

  it("a device cross-signed only by a pending device stays pending", () => {
    const { trust } = pinFirst(emptyTrustStore());
    const phone = newDeviceIdentity();
    const decision = verifyRelayRequest(
      trust,
      frameFor(phone, { certs: [certFrom(maria, phone)] }),
      NOW,
      never,
    );
    expect(decision.ok && decision.pin?.state).toBe("pending");
    // ...until that signer is approved: the next request upgrades it.
    const withPhone = withPinnedDevice(
      trust,
      "usr_maria",
      decision.ok ? decision.pin! : (null as never),
    );
    const approvedSigner = withApprovedDevice(withPhone, "usr_maria", maria.keyId, "alex", ISO)!;
    const later = verifyRelayRequest(
      approvedSigner,
      frameFor(phone, { certs: [certFrom(maria, phone)] }),
      NOW,
      never,
    );
    expect(later.ok && later.pin?.via).toBe("approved");
    expect(later.ok && isApprovedPin(later.device)).toBe(true);
  });

  it("once a person has an approved device, an unvouched new one is refused, not pended", () => {
    const { trust } = pinFirst(emptyTrustStore());
    const approved = withApprovedDevice(trust, "usr_maria", maria.keyId, "alex", ISO)!;
    const forger = newDeviceIdentity();
    const decision = verifyRelayRequest(approved, frameFor(forger), NOW, never);
    expect(!decision.ok && decision.reason).toMatch(/new device/);
  });

  it("caps how many devices of one person wait for approval", () => {
    let trust = emptyTrustStore();
    for (let index = 0; index < MAX_PENDING_PER_PERSON; index += 1) {
      trust = pinFirst(trust, newDeviceIdentity()).trust;
    }
    const decision = verifyRelayRequest(trust, frameFor(newDeviceIdentity()), NOW, never);
    expect(!decision.ok && decision.reason).toMatch(/Too many devices/);
  });

  it("pins from before this rule (no state) count as approved", () => {
    const old = trustDevice(
      withPinnedDevice(emptyTrustStore(), "usr_maria", {
        keyId: maria.keyId,
        signPublicKey: maria.signPublicKey,
        boxPublicKey: maria.boxPublicKey,
        via: "first-use",
        at: ISO,
      }),
      { userId: "usr_maria", ...maria },
      ISO,
    );
    expect(old.ok && isApprovedPin(old.device)).toBe(true);
  });

  it("shows the same fingerprint as the hub (shared test vector)", () => {
    expect(fingerprintOf(Buffer.alloc(32, 7).toString("base64url"))).toBe(
      "4BB0 6F8E 4E3A 7715 D201 D573 D0AA 4237",
    );
  });
});

describe("end-to-end comments", () => {
  const maria = newDeviceIdentity();
  const runner = newDeviceIdentity();
  const approved = withPinnedDevice(emptyTrustStore(), "usr_maria", {
    keyId: maria.keyId,
    signPublicKey: maria.signPublicKey,
    boxPublicKey: maria.boxPublicKey,
    via: "first-use",
    at: ISO,
  });
  const comment = (body: string, signer = maria) => {
    const nonce = "nonce-of-a-comment-1";
    const sealed = seal(
      runner.boxPublicKey,
      JSON.stringify({ body, messageId: "m1" }),
      sealContext("comment", "sh_1", nonce, "request"),
    );
    const sig = signRequest(
      signer,
      { op: "comment.add", shareId: "sh_1", userId: "usr_maria", payload: { sealed } },
      NOW,
      nonce,
    );
    return {
      shareId: "sh_1",
      authorId: "usr_maria",
      sealed,
      sig,
      device: {
        userId: "usr_maria",
        keyId: signer.keyId,
        signPublicKey: signer.signPublicKey,
        boxPublicKey: signer.boxPublicKey,
        certs: [],
      },
    };
  };

  it("only the runner opens a comment, bound to its share and nonce", () => {
    const made = comment("Looks good");
    expect(
      JSON.parse(
        open(runner, made.sealed, sealContext("comment", "sh_1", made.sig.nonce, "request")),
      ),
    ).toEqual({ body: "Looks good", messageId: "m1" });
    expect(() =>
      open(runner, made.sealed, sealContext("comment", "sh_2", made.sig.nonce, "request")),
    ).toThrow();
    expect(() =>
      open(maria, made.sealed, sealContext("comment", "sh_1", made.sig.nonce, "request")),
    ).toThrow();
  });

  it("is verified for an approved device, unverified for a pending one, dropped when forged", () => {
    expect(verifyCommentSignature(approved, comment("ok"), ISO)).toEqual({
      ok: true,
      verified: true,
    });
    expect(verifyCommentSignature(emptyTrustStore(), comment("ok"), ISO)).toEqual({
      ok: true,
      verified: false,
    });
    // The hub swaps the ciphertext of another comment in: the signature no longer holds.
    const swapped = { ...comment("ok"), sealed: comment("pay 1000").sealed };
    expect(verifyCommentSignature(approved, swapped, ISO)).toEqual({ ok: false });
    // Or claims someone else wrote it.
    expect(
      verifyCommentSignature(approved, { ...comment("ok"), authorId: "usr_olga" }, ISO),
    ).toEqual({
      ok: false,
    });
  });
});
