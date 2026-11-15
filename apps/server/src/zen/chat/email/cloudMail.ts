// @effect-diagnostics globalDate:off -- Plain HTTP clients called from the adapter's poll loop.
// Zen Staff e-mail channel: Gmail API and Microsoft Graph, each with OAuth in the customer's own
// Google Cloud project or Entra tenant. Zen holds only what the admin pasted into the runner's
// vault (client secret + refresh token); access tokens live in memory for their lifetime.
// Both read the raw MIME of each message, so one parser (mime.ts) serves every provider.

export interface CloudMailDeps {
  readonly fetch: typeof globalThis.fetch;
  /** Dev/tests: replaces the provider's API and token origins. */
  readonly apiBase: string | null;
  readonly now: () => number;
}

export interface CloudCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** Microsoft only. */
  readonly tenantId?: string;
}

export interface CloudMessage {
  readonly id: string;
  readonly threadId: string | null;
  readonly raw: Uint8Array;
  readonly labels: ReadonlyArray<string>;
}

export interface CloudMailbox {
  /** Unread mail in the inbox and in each label / folder, raw MIME. */
  list(labels: ReadonlyArray<string>, max: number): Promise<CloudMessage[]>;
  markRead(id: string): Promise<void>;
  /** Sends a built RFC 5322 message; threadId keeps Gmail's conversation. */
  send(raw: string, threadId: string | null): Promise<string>;
  test(): Promise<string>;
}

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text === "" ? null : JSON.parse(text);
  } catch {
    return text;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function errorText(body: unknown, status: number): string {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === "string") return `${status}: ${error.message}`;
    if (typeof body.error_description === "string") return `${status}: ${body.error_description}`;
    if (typeof error === "string") return `${status}: ${error}`;
  }
  return `HTTP ${status}`;
}

class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;
  private readonly refresh: () => Promise<{ token: string; expiresIn: number }>;
  private readonly now: () => number;

  constructor(refresh: () => Promise<{ token: string; expiresIn: number }>, now: () => number) {
    this.refresh = refresh;
    this.now = now;
  }

  async get(): Promise<string> {
    if (this.token !== null && this.now() < this.expiresAt - 60_000) return this.token;
    const next = await this.refresh();
    this.token = next.token;
    this.expiresAt = this.now() + next.expiresIn * 1000;
    return next.token;
  }
}

async function refreshToken(
  deps: CloudMailDeps,
  url: string,
  form: Record<string, string>,
): Promise<{ token: string; expiresIn: number }> {
  const response = await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await json(response);
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string")
    throw new Error(
      `Sign-in refresh failed (${errorText(body, response.status)}). Check the client secret and refresh token.`,
    );
  return { token: body.access_token, expiresIn: Number(body.expires_in ?? 3600) || 3600 };
}

const base64UrlToBytes = (value: string) =>
  Uint8Array.from(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
const toBase64Url = (value: string) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Gmail API (scopes gmail.modify + gmail.send)

export function gmailMailbox(credentials: CloudCredentials, deps: CloudMailDeps): CloudMailbox {
  const api = deps.apiBase ?? "https://gmail.googleapis.com";
  const tokenUrl = deps.apiBase ? `${deps.apiBase}/token` : "https://oauth2.googleapis.com/token";
  const tokens = new TokenCache(
    () =>
      refreshToken(deps, tokenUrl, {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    deps.now,
  );
  let labelNames: Map<string, string> | null = null;
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await deps.fetch(`${api}/gmail/v1/users/me${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await tokens.get()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await json(response);
    if (!response.ok) throw new Error(`Gmail ${errorText(body, response.status)}`);
    return body;
  };
  const labelsById = async () => {
    if (labelNames !== null) return labelNames;
    const body = await call("/labels");
    labelNames = new Map(
      (isRecord(body) && Array.isArray(body.labels) ? body.labels : [])
        .filter(isRecord)
        .map((label) => [String(label.id), String(label.name)] as const),
    );
    return labelNames;
  };
  return {
    async list(labels, max) {
      const queries = [
        "in:inbox is:unread",
        ...labels.map((label) => `label:"${label.replace(/"/g, "")}" is:unread`),
      ];
      const seen = new Set<string>();
      const names = await labelsById();
      const out: CloudMessage[] = [];
      for (const query of queries) {
        const body = await call(`/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
        const items =
          isRecord(body) && Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
        for (const item of items) {
          const id = String(item.id);
          if (seen.has(id)) continue;
          seen.add(id);
          const full = await call(`/messages/${encodeURIComponent(id)}?format=raw`);
          if (!isRecord(full) || typeof full.raw !== "string") continue;
          out.push({
            id,
            threadId: typeof full.threadId === "string" ? full.threadId : null,
            raw: base64UrlToBytes(full.raw),
            labels: (Array.isArray(full.labelIds) ? full.labelIds : []).map(
              (labelId) => names.get(String(labelId)) ?? String(labelId),
            ),
          });
        }
      }
      return out;
    },
    async markRead(id) {
      await call(`/messages/${encodeURIComponent(id)}/modify`, {
        method: "POST",
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      });
    },
    async send(raw, threadId) {
      const body = await call("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: toBase64Url(raw), ...(threadId ? { threadId } : {}) }),
      });
      return isRecord(body) && typeof body.id === "string" ? body.id : "sent";
    },
    async test() {
      const body = await call("/profile");
      return isRecord(body) && typeof body.emailAddress === "string" ? body.emailAddress : "ok";
    },
  };
}

// Microsoft Graph (delegated Mail.ReadWrite + Mail.Send + offline_access)

export function graphMailbox(credentials: CloudCredentials, deps: CloudMailDeps): CloudMailbox {
  const api = deps.apiBase ? `${deps.apiBase}/v1.0` : "https://graph.microsoft.com/v1.0";
  const tenant = encodeURIComponent(credentials.tenantId || "organizations");
  const tokenUrl = deps.apiBase
    ? `${deps.apiBase}/token`
    : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const tokens = new TokenCache(
    () =>
      refreshToken(deps, tokenUrl, {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
        scope:
          "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access",
      }),
    deps.now,
  );
  const call = async (
    path: string,
    init: RequestInit & { raw?: boolean; contentType?: string } = {},
  ) => {
    const response = await deps.fetch(`${api}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await tokens.get()}`,
        ...(init.body ? { "Content-Type": init.contentType ?? "application/json" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (init.raw && response.ok) return new Uint8Array(await response.arrayBuffer());
    const body = await json(response);
    if (!response.ok) throw new Error(`Microsoft Graph ${errorText(body, response.status)}`);
    return body;
  };
  const folderIds = new Map<string, string>();
  const folderId = async (name: string): Promise<string | null> => {
    if (folderIds.has(name)) return folderIds.get(name)!;
    // A label "Zen/Ana" is the folder "Ana" under "Zen" (or a top-level folder named "Zen/Ana").
    const parts = name.split("/").filter((part) => part.trim() !== "");
    let parent: string | null = null;
    for (const part of parts) {
      const path: string =
        parent === null ? "/me/mailFolders" : `/me/mailFolders/${parent}/childFolders`;
      const body = await call(
        `${path}?$filter=${encodeURIComponent(`displayName eq '${part.replace(/'/g, "''")}'`)}`,
      );
      const found =
        isRecord(body) && Array.isArray(body.value) ? body.value.find(isRecord) : undefined;
      if (found === undefined) {
        parent = null;
        break;
      }
      parent = String(found.id);
    }
    if (parent !== null) folderIds.set(name, parent);
    return parent;
  };
  return {
    async list(labels, max) {
      const folders: Array<{ label: string; id: string }> = [{ label: "INBOX", id: "inbox" }];
      for (const label of labels) {
        const id = await folderId(label).catch(() => null);
        if (id !== null) folders.push({ label, id });
      }
      const out: CloudMessage[] = [];
      for (const folder of folders) {
        const body = await call(
          `/me/mailFolders/${folder.id}/messages?$filter=isRead eq false&$top=${max}&$select=id,conversationId,categories`,
        );
        const items =
          isRecord(body) && Array.isArray(body.value) ? body.value.filter(isRecord) : [];
        for (const item of items) {
          const id = String(item.id);
          const raw = (await call(`/me/messages/${encodeURIComponent(id)}/$value`, {
            raw: true,
          })) as Uint8Array;
          out.push({
            id,
            threadId: typeof item.conversationId === "string" ? item.conversationId : null,
            raw,
            labels: [
              folder.label,
              ...(Array.isArray(item.categories) ? item.categories.map(String) : []),
            ],
          });
        }
      }
      return out;
    },
    async markRead(id) {
      await call(`/me/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
      });
    },
    async send(raw) {
      // sendMail accepts the whole MIME message, base64, as text/plain; In-Reply-To keeps the thread.
      await call("/me/sendMail", {
        method: "POST",
        body: Buffer.from(raw, "utf8").toString("base64"),
        contentType: "text/plain",
      });
      return "sent";
    },
    async test() {
      const body = await call("/me?$select=mail,userPrincipalName");
      return isRecord(body) ? String(body.mail ?? body.userPrincipalName ?? "ok") : "ok";
    },
  };
}
