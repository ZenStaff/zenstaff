// Zen Staff: /connections. What the assistant can reach, read from the person's own provider
// (`claude mcp list`), with test, sign in, disconnect and "used by"; the catalog; connect by
// address; requests to ZED-ZEN; Enterprise unlocks. Zen keeps no connector credential.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZenConnectionView,
  ZenConnectorEntry,
  ZenConnectorsOverview,
  ZenMcpHealth,
} from "@t3tools/contracts/zenConnectors";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  LoaderIcon,
  PlugIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useContext, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { OfficePageShell } from "../office/OfficePageShell";
import { ConnectCard, LocalMcpStep } from "./ConnectCard";
import {
  connectorsCardsAtom,
  connectorsCatalogAtom,
  connectorsErrorMessage,
  useConnectorsCall,
  useConnectorsQuery,
} from "./connectorsClient";
import { connectorsText } from "./connectors.i18n";
import { pick, type CardData } from "./connectState";
import { SkeletonRows } from "../ui/ZenSkeletons";

/** Cards opened from this page live under one pseudo thread id. */
const PAGE_THREAD = "zen-connections-page";

const HEALTH_VARIANT: Record<ZenMcpHealth, "success" | "warning" | "error" | "outline"> = {
  connected: "success",
  "needs-auth": "warning",
  failed: "error",
  pending: "outline",
  unknown: "outline",
};

export function ConnectionsPage() {
  const environmentId = usePrimaryEnvironmentId();
  const text = useZenText(connectorsText);
  return (
    <OfficePageShell title={text.pageTitle}>
      {environmentId === null ? null : <ConnectionsBody environmentId={environmentId} />}
    </OfficePageShell>
  );
}

function ConnectionsBody({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const text = useZenText(connectorsText);
  const locale = useZenLocale();
  const registry = useContext(RegistryContext);
  const { call } = useConnectorsCall();
  const overview = useConnectorsQuery<ZenConnectorsOverview>(environmentId, "overview");
  const catalog = AsyncResult.getOrElse(
    useAtomValue(connectorsCatalogAtom(environmentId)),
    () => null,
  ) as {
    readonly entries: ReadonlyArray<ZenConnectorEntry>;
  } | null;
  const cardsAtom = connectorsCardsAtom(environmentId, PAGE_THREAD);
  const cards = (AsyncResult.getOrElse(useAtomValue(cardsAtom), () => null) ??
    []) as ReadonlyArray<CardData>;
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const entries = catalog?.entries ?? [];
  const data = overview.data;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await call("overview", { refresh: true });
    } catch {
      // shown by the query
    }
    overview.refresh();
    setRefreshing(false);
  };

  const openCard = (input: Record<string, unknown>) =>
    void call("requests.create", { threadId: PAGE_THREAD, source: "chat", ...input })
      .then(() => registry.refresh(cardsAtom))
      .catch((cause: unknown) => setMessage(connectorsErrorMessage(cause)));

  const openCards = cards.filter(
    (card) => card.request.state === "open" || card.request.state === "connected",
  );

  return (
    <div className="space-y-8" data-zen-no-translate>
      <section className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <p className="max-w-3xl flex-1 text-sm text-muted-foreground">{text.pageIntro}</p>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <LoaderIcon className="animate-spin" /> : <RefreshCwIcon />}
            {text.refresh}
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" />
          {text.storedNothing}
          {data ? (
            <span className="ms-2">
              · {data.isRunner ? text.companyServer : text.personalMachine}
              {data.provider.version ? ` · Claude Code ${data.provider.version}` : ""}
            </span>
          ) : null}
        </p>
        {overview.error ? (
          <p className="text-sm text-destructive-foreground">{overview.error}</p>
        ) : null}
        {message ? <p className="text-sm text-destructive-foreground">{message}</p> : null}
        {data === null ? (
          <SkeletonRows rows={3} />
        ) : !data.provider.claudeCli ? (
          <p className="text-sm">{text.noClaude}</p>
        ) : data.connections.length === 0 ? (
          <p className="text-sm">{text.empty}</p>
        ) : (
          <div className="divide-y divide-border/60 rounded-xl border border-border">
            {data.connections.map((connection) => (
              <ConnectionRow
                key={connection.name}
                connection={connection}
                locale={locale}
                onChanged={() => void refresh()}
              />
            ))}
          </div>
        )}
      </section>

      {openCards.length > 0 ? (
        <section className="space-y-2">
          {openCards.map((card) => (
            <ConnectCard
              key={card.request.id}
              environmentId={environmentId}
              data={card}
              entries={entries}
              call={call}
              onChanged={() => {
                registry.refresh(cardsAtom);
                overview.refresh();
              }}
            />
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">{text.catalogTitle}</h2>
        <p className="text-sm text-muted-foreground">{text.catalogIntro}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-start hover:bg-accent/50"
              onClick={() => openCard({ appId: entry.id })}
            >
              <PlugIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {entry.name}
                  {entry.tier === "enterprise" ? (
                    <Badge variant="warning">{text.enterpriseBadge}</Badge>
                  ) : null}
                  {data?.connections.some(
                    (connection) =>
                      connection.appId === entry.id && connection.health === "connected",
                  ) ? (
                    <CheckCircle2Icon className="size-3.5 text-success-foreground" />
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {pick(locale, entry.description)}
                </span>
              </span>
            </button>
          ))}
        </div>
        <form
          className="flex max-w-xl flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim() !== "") openCard({ customUrl: address.trim() });
            setAddress("");
          }}
        >
          <label className="w-full text-sm" htmlFor="zen-connect-address">
            {text.addByAddress}
          </label>
          <Input
            id="zen-connect-address"
            className="h-8 flex-1"
            value={address}
            placeholder={text.addressPlaceholder}
            onChange={(event) => setAddress(event.target.value)}
          />
          <Button size="sm" type="submit">
            {text.addAddress}
          </Button>
        </form>
      </section>

      {data && data.support.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">{text.supportTitle}</h2>
          <p className="text-xs text-muted-foreground">{text.supportLocal}</p>
          <ul className="space-y-1 text-sm">
            {data.support.map((request) => (
              <li key={request.id}>
                <span className="font-medium">{request.appName}</span>
                {request.note ? ` · ${request.note}` : ""}
                <span className="text-muted-foreground">
                  {" "}
                  · {formatZenRelativeTime(locale, request.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data?.isRunner ? (
        <EnterpriseSection entries={entries} overview={data} onChanged={() => overview.refresh()} />
      ) : null}
    </div>
  );
}

function ConnectionRow(props: {
  readonly connection: ZenConnectionView;
  readonly locale: "en" | "ro";
  readonly onChanged: () => void;
}) {
  const text = useZenText(connectorsText);
  const { call } = useConnectorsCall();
  const { connection } = props;
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  return (
    <div className="space-y-2 p-3" data-zen-connection={connection.name}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-48 flex-1">
          <p className="text-sm font-medium">{connection.appName ?? connection.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {connection.name} · {text.origin[connection.origin]} ·{" "}
            {connection.scope === "company" ? text.companyServer : text.personalMachine}
          </p>
        </div>
        <Badge variant={HEALTH_VARIANT[connection.health]}>{text.health[connection.health]}</Badge>
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void call<{ ok: boolean; message: string }>("connection.test", {
                name: connection.name,
              })
                .then((test) => setResult(test.ok ? text.testOk : text.testFailed(test.message)))
                .catch((cause: unknown) =>
                  setResult(text.testFailed(connectorsErrorMessage(cause))),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy ? <LoaderIcon className="animate-spin" /> : null}
            {text.test}
          </Button>
          {connection.health === "needs-auth" && connection.origin === "local" ? (
            <Button size="xs" variant="outline" onClick={() => setSigningIn(true)}>
              {text.signIn}
            </Button>
          ) : null}
          {connection.removable ? (
            <Button
              size="xs"
              variant="ghost-destructive"
              onClick={() => {
                if (!window.confirm(text.confirmDisconnect(connection.name))) return;
                void call("connection.remove", { name: connection.name })
                  .then(props.onChanged)
                  .catch((cause: unknown) => setResult(connectorsErrorMessage(cause)));
              }}
            >
              {text.disconnect}
            </Button>
          ) : connection.origin === "account" ? (
            <Button
              size="xs"
              variant="ghost"
              render={
                <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" />
              }
            >
              <ExternalLinkIcon />
              {text.disconnectAccount}
            </Button>
          ) : null}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="inline font-medium">{text.colAccess}: </dt>
          <dd className="inline">
            {connection.access ? pick(props.locale, connection.access) : connection.target}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">{text.colUsedBy}: </dt>
          <dd className="inline">
            {connection.usedBy.length > 0 ? connection.usedBy.join(", ") : text.usedByNone}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">{text.colChecked}: </dt>
          <dd className="inline">{formatZenRelativeTime(props.locale, connection.checkedAt)}</dd>
        </div>
      </dl>
      {result ? <p className="text-xs">{result}</p> : null}
      {signingIn ? (
        <LocalMcpStep
          call={call}
          request={null}
          server={connection.name}
          add={async () => ({
            login: await call("connect.loginStatus", { server: connection.name }),
          })}
          onChanged={props.onChanged}
        />
      ) : null}
    </div>
  );
}

function EnterpriseSection(props: {
  readonly entries: ReadonlyArray<ZenConnectorEntry>;
  readonly overview: ZenConnectorsOverview;
  readonly onChanged: () => void;
}) {
  const text = useZenText(connectorsText);
  const { call } = useConnectorsCall();
  const [user, setUser] = useState("");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enterprise = props.entries.filter((entry) => entry.tier === "enterprise");
  return (
    <section className="space-y-2">
      <h2 className="font-medium">{text.enterpriseTitle}</h2>
      <p className="text-sm text-muted-foreground">{text.enterpriseIntro}</p>
      {enterprise.map((entry) => (
        <div key={entry.id} className="space-y-1 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{entry.name}</p>
          <p className="text-xs text-muted-foreground">
            {props.overview.grants
              .filter((grant) => grant.appId === entry.id)
              .map((grant) => grant.user)
              .join(", ") || text.usedByNone}
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void call("grant", { appId: entry.id, user, adminConfirmed: admin })
                .then(props.onChanged)
                .catch((cause: unknown) => setError(connectorsErrorMessage(cause)));
            }}
          >
            <Input
              className="h-8 w-56"
              value={user}
              placeholder={text.grantPlaceholder}
              onChange={(event) => setUser(event.target.value)}
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={admin}
                onChange={(event) => setAdmin(event.target.checked)}
              />
              {text.adminConfirm}
            </label>
            <Button size="sm" type="submit" disabled={user.trim() === ""}>
              {text.grant}
            </Button>
          </form>
        </div>
      ))}
      {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
    </section>
  );
}
