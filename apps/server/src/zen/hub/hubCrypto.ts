// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Pure node:crypto helpers shared by the hub client and the runner.
// Zen Staff hub: device keys, signed requests and end-to-end encryption (relay v2).
//
// Every machine signed in to a hub has one device identity, created at sign-in: an Ed25519 key that
// signs requests and an X25519 key that receives encrypted payloads. The hub stores only the public
// halves. Relay requests are signed over the exact op, share and input (the same bytes as the
// hub's src/signing.ts; test vectors pin both), and their content is sealed to the runner's X25519
// key, so the hub routes and authorizes but cannot read or forge chat content.
import * as NodeCrypto from "node:crypto";

export const SIGNATURE_MAX_SKEW_MS = 5 * 60_000;
const E2E_INFO = "zen-hub-e2e-v1";

/** JSON with sorted keys and no whitespace: the bytes both sides sign and verify. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("not canonical");
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

const sha256b64 = (value: string | Buffer) =>
  NodeCrypto.createHash("sha256").update(value).digest("base64url");

export function keyIdOf(signPublicKey: string): string {
  return sha256b64(Buffer.from(signPublicKey, "base64url")).slice(0, 22);
}

/**
 * What people compare out of band when a runner asks to approve a new device: the first 16 bytes
 * of SHA-256 over the raw signing key, as 8 groups of 4 hex digits. Same as the hub's signing.ts.
 */
export function fingerprintOf(signPublicKey: string): string {
  const hex = NodeCrypto.createHash("sha256")
    .update(Buffer.from(signPublicKey, "base64url"))
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  return (hex.match(/.{4}/g) ?? []).join(" ");
}

export function requestMessage(input: {
  readonly op: string;
  readonly shareId: string;
  readonly userId: string;
  readonly keyId: string;
  readonly ts: number;
  readonly nonce: string;
  readonly payload: unknown;
}): string {
  return `zen-hub-request-v1\n${canonicalJson({
    op: input.op,
    shareId: input.shareId,
    userId: input.userId,
    keyId: input.keyId,
    ts: input.ts,
    nonce: input.nonce,
    body: sha256b64(canonicalJson(input.payload ?? null)),
  })}`;
}

export function deviceCertMessage(input: {
  readonly userId: string;
  readonly keyId: string;
  readonly signPublicKey: string;
  readonly boxPublicKey: string;
}): string {
  return `zen-hub-device-v1\n${canonicalJson(input)}`;
}

export function statementMessage(statement: Record<string, unknown>): string {
  return `zen-hub-statement-v1\n${canonicalJson(statement)}`;
}

/** What a runner signs over its sealed answer, bound to the request it answers. */
export function responseMessage(input: {
  readonly op: string;
  readonly shareId: string;
  readonly nonce: string;
  readonly sealed: string;
}): string {
  return `zen-hub-response-v1\n${canonicalJson({ ...input, sealed: sha256b64(input.sealed) })}`;
}

export interface DeviceIdentity {
  readonly keyId: string;
  readonly signPublicKey: string;
  /** PKCS#8 DER, base64url. Kept only in hub.json (mode 0600). */
  readonly signPrivateKey: string;
  readonly boxPublicKey: string;
  readonly boxPrivateKey: string;
}

export function newDeviceIdentity(): DeviceIdentity {
  const signing = NodeCrypto.generateKeyPairSync("ed25519");
  const box = NodeCrypto.generateKeyPairSync("x25519");
  const signPublicKey = signing.publicKey.export({ format: "jwk" }).x!;
  return {
    keyId: keyIdOf(signPublicKey),
    signPublicKey,
    signPrivateKey: signing.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    boxPublicKey: box.publicKey.export({ format: "jwk" }).x!,
    boxPrivateKey: box.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  };
}

const privateKeyOf = (der: string) =>
  NodeCrypto.createPrivateKey({ key: Buffer.from(der, "base64url"), format: "der", type: "pkcs8" });

export function signText(identity: DeviceIdentity, message: string): string {
  return NodeCrypto.sign(
    null,
    Buffer.from(message, "utf8"),
    privateKeyOf(identity.signPrivateKey),
  ).toString("base64url");
}

export function verifyText(publicKey: string, message: string, signature: string): boolean {
  try {
    const key = NodeCrypto.createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: publicKey },
      format: "jwk",
    });
    return NodeCrypto.verify(
      null,
      Buffer.from(message, "utf8"),
      key,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export const newNonce = () => NodeCrypto.randomBytes(16).toString("base64url");

export interface RequestSignature {
  readonly keyId: string;
  readonly ts: number;
  readonly nonce: string;
  readonly signature: string;
}

export function signRequest(
  identity: DeviceIdentity,
  input: {
    readonly op: string;
    readonly shareId: string;
    readonly userId: string;
    readonly payload: unknown;
  },
  now = Date.now(),
  nonce = newNonce(),
): RequestSignature {
  const message = requestMessage({ ...input, keyId: identity.keyId, ts: now, nonce });
  return { keyId: identity.keyId, ts: now, nonce, signature: signText(identity, message) };
}

function sharedKey(privateKey: NodeCrypto.KeyObject, publicKey: string, salt: Buffer): Buffer {
  const secret = NodeCrypto.diffieHellman({
    privateKey,
    publicKey: NodeCrypto.createPublicKey({
      key: { kty: "OKP", crv: "X25519", x: publicKey },
      format: "jwk",
    }),
  });
  return Buffer.from(NodeCrypto.hkdfSync("sha256", secret, salt, E2E_INFO, 32));
}

/** Encrypts to a recipient's X25519 key with a fresh ephemeral key; `context` is bound as AAD. */
export function seal(recipientBoxPublicKey: string, plaintext: string, context: string): string {
  const ephemeral = NodeCrypto.generateKeyPairSync("x25519");
  const ephemeralPublic = Buffer.from(
    ephemeral.publicKey.export({ format: "jwk" }).x!,
    "base64url",
  );
  const salt = Buffer.concat([ephemeralPublic, Buffer.from(recipientBoxPublicKey, "base64url")]);
  const key = sharedKey(ephemeral.privateKey, recipientBoxPublicKey, salt);
  const iv = NodeCrypto.randomBytes(12);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([ephemeralPublic, iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Throws when the box was not made for this key or this context, or was changed. */
export function open(identity: DeviceIdentity, sealed: string, context: string): string {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length < 60) throw new Error("sealed payload too short");
  const ephemeralPublic = raw.subarray(0, 32);
  const salt = Buffer.concat([ephemeralPublic, Buffer.from(identity.boxPublicKey, "base64url")]);
  const key = sharedKey(
    privateKeyOf(identity.boxPrivateKey),
    ephemeralPublic.toString("base64url"),
    salt,
  );
  const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, raw.subarray(32, 44));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(raw.subarray(44, 60));
  return Buffer.concat([decipher.update(raw.subarray(60)), decipher.final()]).toString("utf8");
}

/** The AAD of a relay payload: which request, which way. */
export function sealContext(
  op: string,
  shareId: string,
  nonce: string,
  direction: "request" | "response",
) {
  return `${E2E_INFO}|${direction}|${op}|${shareId}|${nonce}`;
}
