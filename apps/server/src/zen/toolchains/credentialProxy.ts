// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - plain async code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: the credential proxy for an enterprise workflow thread, on the runner. It listens on
// 127.0.0.1, forwards `http://127.0.0.1:<port>/<secret id>/<path>` to https://<declared host>/<path>
// with the secret added as a header, and refuses every other host (the egress allowlist for API
// calls). The agent's environment holds only the proxy URL, never the secret value.
import * as NodeHttp from "node:http";

export interface ProxyRoute {
  readonly secretId: string;
  /** Allowed hosts; the first is the default target. */
  readonly hosts: ReadonlyArray<string>;
  /** "Authorization: Bearer {secret}" or "xi-api-key: {secret}". */
  readonly header: string;
  readonly value: () => string | null;
}

/** Which upstream URL a proxied request goes to, or a refusal. Pure. */
export function proxyTarget(
  routes: ReadonlyArray<ProxyRoute>,
  path: string,
): { readonly route: ProxyRoute; readonly url: string } | { readonly refused: string } {
  const match = /^\/([a-z][a-z0-9_]*)(?:\/@([a-z0-9.-]+))?(\/.*)?$/i.exec(path);
  if (!match) return { refused: "Use /<secret id>/<path>." };
  const route = routes.find((candidate) => candidate.secretId === match[1]);
  if (!route) return { refused: `No credential "${match[1]}" for this workflow.` };
  const host = match[2] ?? route.hosts[0];
  if (!host || !route.hosts.includes(host)) {
    return { refused: `${host ?? "That host"} is not one of the hosts this workflow declared.` };
  }
  return { route, url: `https://${host}${match[3] ?? "/"}` };
}

export function headerFor(template: string, value: string): [string, string] {
  const [name, ...rest] = template.split(":");
  return [name!.trim(), rest.join(":").trim().replaceAll("{secret}", value)];
}

const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "authorization"]);

export interface RunningProxy {
  readonly url: string;
  readonly close: () => Promise<void>;
}

export function startCredentialProxy(
  routes: ReadonlyArray<ProxyRoute>,
  onUse: (secretId: string, host: string) => void,
): Promise<RunningProxy> {
  const server = NodeHttp.createServer((request, response) => {
    const target = proxyTarget(routes, request.url ?? "/");
    if ("refused" in target) {
      response.writeHead(403, { "content-type": "text/plain" }).end(target.refused);
      return;
    }
    const value = target.route.value();
    if (value === null) {
      response
        .writeHead(424, { "content-type": "text/plain" })
        .end("The credential is missing on this server.");
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [name, raw] of Object.entries(request.headers)) {
        if (!HOP.has(name) && typeof raw === "string") headers[name] = raw;
      }
      const [name, header] = headerFor(target.route.header, value);
      headers[name] = header;
      onUse(target.route.secretId, new URL(target.url).host);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      fetch(target.url, {
        method: request.method ?? "GET",
        headers,
        ...(body && request.method !== "GET" && request.method !== "HEAD" ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      })
        .then(async (upstream) => {
          const out: Record<string, string> = {};
          upstream.headers.forEach((v, k) => {
            if (k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding")
              out[k] = v;
          });
          response.writeHead(upstream.status, out);
          response.end(Buffer.from(await upstream.arrayBuffer()));
        })
        .catch((error: unknown) => {
          response
            .writeHead(502, { "content-type": "text/plain" })
            .end(`Upstream failed: ${String(error)}`);
        });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
