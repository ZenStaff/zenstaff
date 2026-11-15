// @effect-diagnostics effectFnOpportunity:off nodeBuiltinImport:off processEnvInEffect:off - one-line delegations to ConnectorsManager; env and platform read once at start.
// Zen Staff connectors as an Effect service: one RPC (`zen.connectors.call {op, input}`), the
// `zen-connect` MCP server for agent threads, and the thread hook. ZEN.md, "Connectors".
import * as NodeOS from "node:os";

import {
  ZEN_CONNECTORS_WS_METHODS,
  ZenConnectorsError,
  type ZenConnectorsCallInput,
  type ZenConnectorCategory,
  type ZenConnectorPathKind,
  type ZenConnectionScope,
} from "@t3tools/contracts/zenConnectors";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import { resolveWorkflowAssetsDir } from "../workflows/workflowAssets.ts";
import { makeRunClaude } from "./claudeCli.ts";
import { startGateway, type Gateway, type GatewayTool } from "./gateway.ts";
import { ConnectorFailure, ConnectorsManager } from "./manager.ts";
import { CONECTARE_SKILL } from "./skill/skill.gen.ts";
import { setZenConnectorThreadResolver } from "./threadMcp.ts";
import { setZenConnectionsLister, zenGatewayExtraTools } from "./extraTools.ts";

type Run<A> = Effect.Effect<A, ZenConnectorsError>;

export class ZenConnectors extends Context.Service<
  ZenConnectors,
  { readonly call: (input: ZenConnectorsCallInput) => Run<unknown> }
>()("t3/zen/connectors/ZenConnectors") {}

const toError = (error: unknown): ZenConnectorsError =>
  error instanceof ConnectorFailure
    ? new ZenConnectorsError({ reason: error.reason, detail: error.message })
    : new ZenConnectorsError({
        reason: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });

const str = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConnectorFailure("invalid-input", `${name} is missing.`);
  }
  return value;
};
const opt = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;
const scopeOf = (value: unknown): ZenConnectionScope | null =>
  value === "personal" || value === "company" ? value : null;

/** Every RPC op; inputs are checked here (the RPC payload is `unknown`). */
export async function dispatch(
  manager: ConnectorsManager,
  op: ZenConnectorsCallInput["op"],
  raw: unknown,
): Promise<unknown> {
  const input = (raw ?? {}) as Record<string, unknown>;
  switch (op) {
    case "catalog":
      return { entries: manager.entries, problems: manager.catalogProblems };
    case "overview":
      return manager.overview(input.refresh === true);
    case "requests.list": {
      const threadId = str(input.threadId, "threadId");
      const requests = manager.listRequests(threadId);
      // Each open card carries what it needs to render: the path choice and current state.
      return Promise.all(
        requests.map(async (request) => {
          if (request.appId === null) return { request, apps: [] };
          const entry = manager.entry(request.appId);
          return { request, apps: [await manager.describe(entry, request.scope)] };
        }),
      );
    }
    case "requests.create":
      return manager.createRequest({
        threadId: str(input.threadId, "threadId"),
        appId: opt(input.appId),
        category: (opt(input.category) as ZenConnectorCategory | null) ?? null,
        candidates: Array.isArray(input.candidates)
          ? input.candidates.filter((id): id is string => typeof id === "string")
          : [],
        preferredKind: (opt(input.preferredKind) as ZenConnectorPathKind | null) ?? null,
        scope: scopeOf(input.scope),
        source: input.source === "agent" ? "agent" : "chat",
        messageId: opt(input.messageId),
        customUrl: opt(input.customUrl),
      });
    case "requests.dismiss":
      return manager.updateRequest(str(input.id, "id"), { state: "dismissed" });
    case "connect.add":
    case "connect.custom":
      return manager.add({
        appId: op === "connect.add" ? opt(input.appId) : null,
        customUrl: op === "connect.custom" ? str(input.url, "url") : null,
        scope: scopeOf(input.scope),
        requestId: opt(input.requestId),
      });
    case "connect.loginStatus":
      return typeof input.server === "string" && input.loginId === undefined
        ? manager.login(input.server)
        : manager.loginStatus(str(input.loginId, "loginId"));
    case "connect.finishLogin":
      return manager.finishLogin(
        str(input.loginId, "loginId"),
        str(input.redirectUrl, "redirectUrl"),
      );
    case "connect.sendLink": {
      // Seam: the hub will e-mail the link to the person's own address. Until then the client
      // opens a mailto: draft to themselves (nothing is sent by Zen, nothing is stored).
      const url = str(input.url, "url");
      if (!/^https:\/\//.test(url))
        throw new ConnectorFailure("invalid-input", "Only https links are sent.");
      const email = opt(input.email);
      const subject = encodeURIComponent("Zen Staff: finish connecting");
      const body = encodeURIComponent(`Open this link to finish connecting:\n\n${url}\n`);
      return {
        delivered: false,
        via: "mailto",
        mailto: `mailto:${email ?? ""}?subject=${subject}&body=${body}`,
      };
    }
    case "connect.verify":
      return manager.verify({
        appId: opt(input.appId),
        server: opt(input.server),
        requestId: opt(input.requestId),
      });
    case "connection.test":
      return manager.test(str(input.name, "name"));
    case "connection.remove":
      await manager.remove(str(input.name, "name"));
      return manager.overview();
    case "support.create": {
      const record = manager.createSupport({
        appId: str(input.appId, "appId"),
        note: opt(input.note) ?? "",
        contact: opt(input.contact),
        threadId: opt(input.threadId),
      });
      const requestId = opt(input.requestId);
      if (requestId) manager.updateRequest(requestId, { state: "support" });
      return record;
    }
    case "support.list":
      return manager.support();
    case "grant":
      manager.grant({
        appId: str(input.appId, "appId"),
        user: str(input.user, "user"),
        adminConfirmed: input.adminConfirmed === true,
      });
      return manager.overview();
    case "revoke":
      manager.revoke({ appId: str(input.appId, "appId"), user: str(input.user, "user") });
      return manager.overview();
  }
}

/** The zen-connect tools the agent sees. */
export function agentTools(manager: ConnectorsManager): ReadonlyArray<GatewayTool> {
  return [
    {
      name: "find_connector",
      description:
        "Find how an app can be connected (Gmail, SmartBill, HubSpot, 'CRM', 'facturare'...). Returns matching apps, whether each is already connected, and the best way to connect it on this computer.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "App name or kind, in any language." },
        },
        required: ["query"],
      },
      readOnly: true,
      run: async (_threadId, args) => {
        const query = typeof args.query === "string" ? args.query : "";
        const found = await manager.findForAgent(query);
        return found.length === 0
          ? "No app in the catalog matches. Offer the export (CSV) route or 'Ask ZED-ZEN to set this up'; or, for a public MCP server address, call start_connection with mcp_url."
          : JSON.stringify(found, null, 2);
      },
    },
    {
      name: "start_connection",
      description:
        "Show the person a 'Connect <app>' card in this chat. The card does the connecting (sign-in link, steps, check). Never ask for passwords or keys in chat.",
      inputSchema: {
        type: "object",
        properties: {
          app: {
            type: "string",
            description: "App id from find_connector. Leave out when using mcp_url.",
          },
          scope: {
            type: "string",
            enum: ["personal", "company"],
            description: "Default: the app's usual scope.",
          },
          mcp_url: {
            type: "string",
            description: "Only for a public MCP server not in the catalog (https).",
          },
        },
      },
      readOnly: false,
      run: async (threadId, args) => {
        const named =
          typeof args.app === "string" && args.app.trim() !== "" ? args.app.trim() : null;
        const mcpUrl =
          typeof args.mcp_url === "string" && args.mcp_url.trim() !== "" ? args.mcp_url : null;
        // With an address, a name that is not in the catalog is only a label.
        const app =
          named && (mcpUrl === null || manager.entries.some((entry) => entry.id === named))
            ? named
            : null;
        if (app === null && mcpUrl === null) {
          throw new Error(
            "Give an app id from find_connector, or mcp_url for a public MCP server.",
          );
        }
        const request = manager.createRequest({
          threadId,
          appId: app,
          scope: scopeOf(args.scope),
          source: "agent",
          customUrl: app === null ? mcpUrl : null,
        });
        const name = app ? manager.entry(app).name : (request.customUrl ?? "the server");
        return `A card to connect ${name} is now shown in the chat. Tell the person to press its button and wait; do not ask for keys or passwords.`;
      },
    },
    {
      name: "list_connections",
      description: "List the apps connected for this assistant (name, health). No secrets.",
      inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
      readOnly: true,
      run: async (_threadId, args) => {
        const connections = await manager.connections(args.refresh === true);
        return JSON.stringify(
          connections.map((connection) => ({
            name: connection.name,
            app: connection.appName,
            health: connection.health,
            where:
              connection.origin === "account"
                ? "AI account connector"
                : connection.origin === "plugin"
                  ? "plugin"
                  : "Claude Code",
          })),
          null,
          2,
        );
      },
    },
  ];
}

const make = Effect.fn("ZenConnectors.make")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const workflowsAssetsDir = yield* resolveWorkflowAssetsDir(config.baseDir).pipe(
    Effect.orElseSucceed(() => path.join(import.meta.dirname, "..", "workflows")),
  );
  const platform = yield* HostProcess.Platform;
  const cli = {
    bin: process.env.ZEN_CONNECT_CLAUDE_BIN ?? "claude",
    env: process.env,
    platform,
  };
  let gateway: Gateway | null = null;
  const manager: ConnectorsManager = new ConnectorsManager({
    zenHome: config.baseDir,
    stateDir: config.stateDir,
    workflowsAssetsDir,
    cli,
    run: makeRunClaude(cli),
    cwd: process.env.ZEN_CONNECT_CWD ?? NodeOS.homedir(),
    mcpScope: process.env.ZEN_CONNECT_MCP_SCOPE === "local" ? "local" : "user",
  });
  const ownTools = agentTools(manager);
  gateway = yield* Effect.promise(() =>
    startGateway(() => [...ownTools, ...zenGatewayExtraTools()], CONECTARE_SKILL),
  );
  const live = gateway;
  setZenConnectionsLister(async () =>
    (await manager.connections()).map((connection) => ({
      name: connection.name,
      app: connection.appName,
      origin: connection.origin,
      health: connection.health,
    })),
  );
  setZenConnectorThreadResolver((threadId) => ({
    url: `${live.url}?v=${manager.version}`,
    authorization: `Bearer ${live.tokenFor(threadId)}`,
  }));
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      setZenConnectorThreadResolver(null);
      setZenConnectionsLister(null);
      manager.dispose();
      await live.close();
    }),
  );
  return ZenConnectors.of({
    call: (input) =>
      Effect.tryPromise({ try: () => dispatch(manager, input.op, input.input), catch: toError }),
  });
});

export const layer = Layer.effect(ZenConnectors, make());

/** RPC handlers for ws.ts, kept here so the upstream file only spreads them in. */
export const wsHandlers = (service: Option.Option<ZenConnectors["Service"]>) => ({
  [ZEN_CONNECTORS_WS_METHODS.call]: (input: ZenConnectorsCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(
          new ZenConnectorsError({
            reason: "unavailable",
            detail: "Connectors are not available on this server.",
          }),
        ),
});
