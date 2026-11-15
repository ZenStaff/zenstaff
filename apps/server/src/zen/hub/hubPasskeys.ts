// Zen Staff hub: passkeys. The WebAuthn ceremonies run on the hub's own pages (the hub is the
// relying party); this machine only asks the hub for a page address and opens it in the browser.
// See docs/zen-hub.md, "Auth".
import { normalizeHubUrl } from "./hubState.ts";

export type PasskeyLanguage = "en" | "ro";

export interface HubPasskey {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly transports: ReadonlyArray<string>;
  readonly backedUp: boolean;
  readonly deviceType: string;
}

export function passkeyLanguage(value: unknown): PasskeyLanguage {
  return value === "ro" ? "ro" : "en";
}

/** Passkey ids are the hub's own (`pk_` + base64url); anything else never reaches the hub path. */
export function passkeyId(value: unknown): string | null {
  return typeof value === "string" && /^pk_[A-Za-z0-9_-]{8,40}$/.test(value) ? value : null;
}

/** A short name for the passkey list; the hub stores up to 120 characters. */
export function passkeyLabel(value: unknown, machineName: string): string {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  return label !== "" ? label : `Passkey on ${machineName}`.slice(0, 120);
}

/**
 * The address the hub returned for a passkey page, before it is handed to the browser: only the
 * hub's own passkey pages (https, or http on this machine), never another scheme or site path.
 */
export function passkeyPageUrl(value: unknown, kind: "register" | "login"): string | null {
  if (typeof value !== "string" || value.length > 600) return null;
  if (normalizeHubUrl(value) === null) return null;
  const url = new URL(value);
  if (!url.pathname.endsWith(`/v1/passkeys/${kind}`)) return null;
  const token = url.searchParams.get("t");
  if (token === null || !/^pk[rl]_[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  return url.toString();
}

export function normalizePasskeys(value: unknown): ReadonlyArray<HubPasskey> {
  const list = (value as { passkeys?: unknown } | null)?.passkeys;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): Array<HubPasskey> => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const id = passkeyId(row.id);
    if (id === null || typeof row.label !== "string" || typeof row.createdAt !== "string")
      return [];
    return [
      {
        id,
        label: row.label,
        createdAt: row.createdAt,
        lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
        transports: Array.isArray(row.transports)
          ? row.transports.filter((entry): entry is string => typeof entry === "string")
          : [],
        backedUp: row.backedUp === true,
        deviceType: typeof row.deviceType === "string" ? row.deviceType : "singleDevice",
      },
    ];
  });
}
