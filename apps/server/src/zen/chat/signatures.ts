// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off -- Plain crypto checks, called from the relay boundary outside the Effect runtime.
// Zen Staff chat integrations: proof that an inbound request really comes from the platform.
// Webhooks reach the runner through the hub relay, so the runner checks every signature itself
// with secrets only it holds: a compromised hub cannot forge platform events.
import * as NodeCrypto from "node:crypto";

const encoder = new TextEncoder();
const asBytes = (body: Uint8Array | string) =>
  typeof body === "string" ? encoder.encode(body) : body;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && NodeCrypto.timingSafeEqual(a, b);
}

export type SignatureResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };
const fail = (reason: string): SignatureResult => ({ ok: false, reason });
const OK: SignatureResult = { ok: true };

const header = (headers: Readonly<Record<string, string>>, name: string): string | null => {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === wanted) return value;
  return null;
};

/** Slack: `v0=HMAC_SHA256(signing secret, "v0:{timestamp}:{raw body}")`, at most 5 minutes old. */
export function verifySlackSignature(input: {
  readonly signingSecret: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | string;
  readonly nowSeconds: number;
}): SignatureResult {
  const timestamp = header(input.headers, "x-slack-request-timestamp");
  const signature = header(input.headers, "x-slack-signature");
  if (timestamp === null || signature === null) return fail("missing Slack signature headers");
  if (!/^\d+$/.test(timestamp) || Math.abs(input.nowSeconds - Number(timestamp)) > 300) {
    return fail("stale Slack request");
  }
  const hmac = NodeCrypto.createHmac("sha256", input.signingSecret);
  hmac.update(`v0:${timestamp}:`);
  hmac.update(asBytes(input.body));
  return safeEqual(`v0=${hmac.digest("hex")}`, signature) ? OK : fail("bad Slack signature");
}

/** WhatsApp Cloud API (Meta): `X-Hub-Signature-256: sha256=HMAC_SHA256(app secret, raw body)`. */
export function verifyMetaSignature(input: {
  readonly appSecret: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | string;
}): SignatureResult {
  const signature = header(input.headers, "x-hub-signature-256");
  if (signature === null) return fail("missing X-Hub-Signature-256");
  const digest = NodeCrypto.createHmac("sha256", input.appSecret)
    .update(asBytes(input.body))
    .digest("hex");
  return safeEqual(`sha256=${digest}`, signature) ? OK : fail("bad WhatsApp signature");
}

/** Telegram webhooks (not used with long polling): the secret token header, compared in constant time. */
export function verifyTelegramSecret(input: {
  readonly secretToken: string;
  readonly headers: Readonly<Record<string, string>>;
}): SignatureResult {
  const sent = header(input.headers, "x-telegram-bot-api-secret-token");
  if (sent === null) return fail("missing Telegram secret token");
  return safeEqual(sent, input.secretToken) ? OK : fail("bad Telegram secret token");
}

/** Discord HTTP interactions (not used over the gateway): Ed25519 over timestamp + body. */
export function verifyDiscordSignature(input: {
  readonly publicKeyHex: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | string;
}): SignatureResult {
  const signature = header(input.headers, "x-signature-ed25519");
  const timestamp = header(input.headers, "x-signature-timestamp");
  if (signature === null || timestamp === null) return fail("missing Discord signature headers");
  try {
    const key = NodeCrypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(input.publicKeyHex, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    const message = Buffer.concat([Buffer.from(timestamp), Buffer.from(asBytes(input.body))]);
    return NodeCrypto.verify(null, message, key, Buffer.from(signature, "hex"))
      ? OK
      : fail("bad Discord signature");
  } catch {
    return fail("bad Discord signature");
  }
}

// JWT (Microsoft Bot Framework, Google Chat)

export interface Jwk {
  readonly kid?: string;
  readonly kty: string;
  readonly n?: string;
  readonly e?: string;
  readonly x5c?: ReadonlyArray<string>;
  readonly endorsements?: ReadonlyArray<string>;
  readonly [key: string]: unknown;
}

export interface JwtClaims {
  readonly iss?: string;
  readonly aud?: string | ReadonlyArray<string>;
  readonly exp?: number;
  readonly nbf?: number;
  readonly serviceurl?: string;
  readonly serviceUrl?: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

const base64UrlJson = (part: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * RS256 JWT check against a key set: signature, issuer, audience, expiry (5 minutes of clock
 * skew). `keys` is the platform's published JWKS (fetched and cached by `JwksCache`).
 */
export function verifyJwt(input: {
  readonly token: string;
  readonly keys: ReadonlyArray<Jwk>;
  readonly issuers: ReadonlyArray<string>;
  readonly audience: string;
  readonly nowSeconds: number;
  /** Bot Framework: the key must endorse this channel ("msteams"). */
  readonly endorsement?: string;
}):
  | { readonly ok: true; readonly claims: JwtClaims }
  | { readonly ok: false; readonly reason: string } {
  const parts = input.token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const head = base64UrlJson(parts[0]!);
  const claims = base64UrlJson(parts[1]!) as JwtClaims | null;
  if (head === null || claims === null) return { ok: false, reason: "malformed token" };
  if (head.alg !== "RS256") return { ok: false, reason: "unexpected algorithm" };
  const jwk = input.keys.find((key) => key.kid === head.kid);
  if (jwk === undefined) return { ok: false, reason: "unknown signing key" };
  if (
    input.endorsement !== undefined &&
    jwk.endorsements !== undefined &&
    !jwk.endorsements.includes(input.endorsement)
  ) {
    return { ok: false, reason: "key not endorsed for this channel" };
  }
  try {
    const key = NodeCrypto.createPublicKey({ key: jwk as NodeCrypto.JsonWebKey, format: "jwk" });
    const valid = NodeCrypto.verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2]!, "base64url"),
    );
    if (!valid) return { ok: false, reason: "bad token signature" };
  } catch {
    return { ok: false, reason: "bad token signature" };
  }
  if (typeof claims.iss !== "string" || !input.issuers.includes(claims.iss)) {
    return { ok: false, reason: "unexpected issuer" };
  }
  const audiences = typeof claims.aud === "string" ? [claims.aud] : (claims.aud ?? []);
  if (!audiences.includes(input.audience)) return { ok: false, reason: "token not for this bot" };
  const skew = 300;
  if (typeof claims.exp !== "number" || claims.exp + skew < input.nowSeconds) {
    return { ok: false, reason: "expired token" };
  }
  if (typeof claims.nbf === "number" && claims.nbf - skew > input.nowSeconds) {
    return { ok: false, reason: "token not valid yet" };
  }
  return { ok: true, claims };
}

export const BOT_FRAMEWORK_ISSUERS = ["https://api.botframework.com"] as const;
export const BOT_FRAMEWORK_OPENID =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";
export const GOOGLE_CHAT_ISSUERS = ["chat@system.gserviceaccount.com"] as const;
export const GOOGLE_CHAT_JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com";

export type JsonFetch = (url: string) => Promise<unknown>;

/** Published signing keys, refreshed every 12 hours or when an unknown key id appears. */
export class JwksCache {
  private keys: ReadonlyArray<Jwk> = [];
  private fetchedAt = 0;
  private readonly source: { readonly jwksUrl?: string; readonly openIdUrl?: string };
  private readonly fetchJson: JsonFetch;

  constructor(
    source: { readonly jwksUrl?: string; readonly openIdUrl?: string },
    fetchJson: JsonFetch,
  ) {
    this.source = source;
    this.fetchJson = fetchJson;
  }

  async get(kid: string | null, now = Date.now()): Promise<ReadonlyArray<Jwk>> {
    const stale = now - this.fetchedAt > 12 * 60 * 60 * 1000;
    const missing = kid !== null && !this.keys.some((key) => key.kid === kid);
    if (stale || (missing && now - this.fetchedAt > 60_000)) {
      let jwksUrl = this.source.jwksUrl ?? null;
      if (jwksUrl === null && this.source.openIdUrl) {
        const config = (await this.fetchJson(this.source.openIdUrl)) as { jwks_uri?: unknown };
        jwksUrl = typeof config.jwks_uri === "string" ? config.jwks_uri : null;
      }
      if (jwksUrl !== null) {
        const set = (await this.fetchJson(jwksUrl)) as { keys?: unknown };
        this.keys = Array.isArray(set.keys) ? (set.keys as Jwk[]) : [];
        this.fetchedAt = now;
      }
    }
    return this.keys;
  }
}

export const jwtKeyId = (token: string): string | null => {
  const head = base64UrlJson(token.split(".")[0] ?? "");
  return typeof head?.kid === "string" ? head.kid : null;
};

export const bearerToken = (headers: Readonly<Record<string, string>>): string | null => {
  const value = header(headers, "authorization");
  const match = value === null ? null : /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1]!.trim() : null;
};
