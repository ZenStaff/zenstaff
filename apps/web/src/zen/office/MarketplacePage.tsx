// Zen Staff: the Library ("Bibliotecă", route /library; /marketplace redirects here). Browse,
// search and filter Zen Staff's packs and the community's (from the hub, after review); install
// copies a pack into your workflows folder, uninstall removes it. Everything is free: no payments.
// Community parts (credit, share, report, publish): LibraryCommunity.tsx. ZEN.md, "Community library".
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  localizeRegistryEntry,
  type ZenMarketplaceEntry,
  type ZenWorkflowCategory,
} from "@t3tools/contracts/zenOffice";
import { CheckIcon, DownloadIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useSearch } from "@tanstack/react-router";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
import { Skeleton } from "../../components/ui/skeleton";
import { toastManager } from "../../components/ui/toast";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { showOfficeFailure } from "./officeFailures";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { CATEGORY_TEXT, officeText } from "./office.i18n";
import {
  CATEGORY_ORDER,
  NO_INPUT,
  installOfficePack,
  officeSettings,
  setOfficeRegistryUrl,
  matchesSearch,
  officeMarketplace,
  officeWorkflows,
  uninstallOfficePack,
} from "./officeState";
import { OfficePageShell } from "./OfficePageShell";
import { CompanyPackControls, CompanyPacksPanel, useCompanyPacks } from "./CompanyPacks";
import { companyPackControl } from "./companyPacksModel";
import { useOfficeCompany } from "./useOfficeCompany";
import { WorkflowIcon } from "./workflowIcons";
import { officeChatText } from "./officeChat.i18n";
import { UsePackButton } from "../intake/UsePackButton";
import { PackPinButton } from "../navigation/WorkflowPinButton";
import { ZenPackSample } from "./PackSample";
import { ZenPackGate, ZenShowBetaToggle } from "../toolchains/PackGate";
import { ZenPackRequirements } from "../toolchains/ToolchainBadge";
import { CustomPacksSection } from "./CustomPacks";
import { customPacksText } from "./customPacks.i18n";
import { isNewerVersion } from "./customPacksState";
import {
  LibraryBadges,
  LibraryCredit,
  LibraryShots,
  PublishSection,
  ReportButton,
  ShareButton,
  WithdrawnWarning,
} from "./LibraryCommunity";
import { libraryText } from "./library.i18n";
import { libraryOrder, matchesOrigin, type OriginFilter } from "./libraryModel";

type Filter = "all" | "installed" | ZenWorkflowCategory;

export function MarketplacePage() {
  const t = useZenText(officeText);
  const environmentId = usePrimaryEnvironmentId();
  return (
    <OfficePageShell title={t.marketplace}>
      {environmentId === null ? (
        <p className="text-muted-foreground text-sm">{t.waitingToConnect}</p>
      ) : (
        <Marketplace environmentId={environmentId} />
      )}
    </OfficePageShell>
  );
}

function Marketplace({ environmentId }: { environmentId: EnvironmentId }) {
  const t = useZenText(officeText);
  const categories = useZenText(CATEGORY_TEXT);
  const locale = useZenLocale();
  const registry = useContext(RegistryContext);
  const result = useAtomValue(officeMarketplace({ environmentId, input: NO_INPUT }));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [showBeta, setShowBeta] = useState(false);
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const l = useZenText(libraryText);
  // A share page's install link (zen://library?install=<slug>) opens the library on that pack.
  const focusSlug = useSearch({
    strict: false,
    select: (search) => (search as { install?: string }).install ?? null,
  });
  const focusRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the pack from a share link into view once the list has loaded
  useEffect(() => {
    if (focusSlug !== null && AsyncResult.isSuccess(result))
      focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusSlug, result]);
  const install = useAtomCommand(installOfficePack, { label: t.installWorkflow });
  const uninstall = useAtomCommand(uninstallOfficePack, { label: t.uninstallWorkflow });
  const { workflowsInput, companyId } = useOfficeCompany();
  // Hub v6: packs installed for the whole company (CompanyPacks.tsx).
  const companyPacks = useCompanyPacks(environmentId);

  const refresh = () => {
    registry.refresh(officeMarketplace({ environmentId, input: NO_INPUT }));
    registry.refresh(officeWorkflows({ environmentId, input: workflowsInput }));
    companyPacks.refresh();
  };
  const act = async (item: ZenMarketplaceEntry, action: "install" | "uninstall") => {
    setBusy(item.entry.id);
    // An Enterprise pack's install approval is the active company's (a server may serve several).
    const outcome =
      action === "install"
        ? await install({
            environmentId,
            input: { id: item.entry.id, ...(companyId ? { companyId } : {}) },
          })
        : await uninstall({ environmentId, input: { id: item.entry.id } });
    setBusy(null);
    refresh();
    if (outcome._tag === "Success") {
      toastManager.add({
        type: "success",
        title:
          action === "install" ? t.readyOnHome(item.entry.name) : t.removedNamed(item.entry.name),
      });
    } else if (outcome._tag === "Failure") showOfficeFailure(action, outcome.cause);
  };

  if (result._tag === "Failure") {
    return <p className="text-destructive-foreground text-sm">{t.marketplaceLoadFailed}</p>;
  }
  if (!AsyncResult.isSuccess(result)) {
    return (
      <div className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    );
  }
  const entries = libraryOrder(result.value.entries, focusSlug)
    .map((item) => ({ ...item, entry: localizeRegistryEntry(item.entry, locale) }))
    .filter((item) => {
      if (item.entry.community?.slug === focusSlug) return true;
      if (!matchesOrigin(item, origin)) return false;
      if (filter === "installed" && !item.installed) return false;
      if (filter !== "all" && filter !== "installed" && item.entry.category !== filter)
        return false;
      return matchesSearch(query, [
        item.entry.name,
        item.entry.description,
        item.entry.author,
        categories[item.entry.category],
        ...(item.entry.tags ?? []),
      ]);
    });
  const filters: ReadonlyArray<{ id: Filter; label: string }> = [
    { id: "all", label: t.filterAll },
    { id: "installed", label: t.filterInstalled },
    ...CATEGORY_ORDER.map((category) => ({ id: category, label: categories[category] })),
  ];

  return (
    <div className="flex flex-col gap-5 pt-4 pb-10">
      <p className="text-muted-foreground text-sm">{t.marketplaceIntro}</p>
      <CustomPacksSection environmentId={environmentId} />
      {result.value.notice ? (
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
          {result.value.sourceKind === "cache" ? t.registryCacheNotice : t.registryLocalNotice}
        </p>
      ) : null}
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchWorkflows}
          aria-label={t.searchWorkflows}
        />
      </InputGroup>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.filter}>
        {filters.map((item) => (
          <Button
            key={item.id}
            size="xs"
            variant={filter === item.id ? "default" : "outline"}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </Button>
        ))}
        <ZenShowBetaToggle value={showBeta} onChange={setShowBeta} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={l.originFilter}>
        <span className="text-muted-foreground text-xs">{l.originFilter}:</span>
        {(
          [
            ["all", l.originAll],
            ["zen", l.originZen],
            ["community", l.originCommunity],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            size="xs"
            variant={origin === id ? "default" : "outline"}
            aria-pressed={origin === id}
            onClick={() => setOrigin(id)}
            data-zen-library-origin-filter={id}
          >
            {label}
          </Button>
        ))}
      </div>
      {result.value.community?.notice ? (
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
          {l.communityNotice}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.nothingMatches}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((item) => (
          <div
            key={item.entry.id}
            className="contents"
            ref={item.entry.community?.slug === focusSlug ? focusRef : undefined}
          >
            <ZenPackGate
              environmentId={environmentId}
              item={item}
              showBeta={showBeta}
              onInstall={() => void act(item, "install")}
            >
              {(onInstall) => (
                <MarketplaceCard
                  environmentId={environmentId}
                  item={item}
                  busy={busy === item.entry.id}
                  onInstall={onInstall}
                  onUninstall={() => void act(item, "uninstall")}
                  managed={companyPackControl(companyPacks.view, item.entry.id).managed}
                  company={
                    item.entry.kind === "pack" ? (
                      <CompanyPackControls
                        view={companyPacks.view}
                        companyName={companyPacks.companyName}
                        packId={item.entry.id}
                        packName={item.entry.name}
                        onChanged={refresh}
                      />
                    ) : null
                  }
                  focused={
                    item.entry.community !== undefined && item.entry.community.slug === focusSlug
                  }
                />
              )}
            </ZenPackGate>
          </div>
        ))}
      </div>
      <PublishSection environmentId={environmentId} companyId={companyId ?? null} />
      <CompanyPacksPanel
        view={companyPacks.view}
        names={Object.fromEntries(
          result.value.entries.map((item) => [
            item.entry.id,
            localizeRegistryEntry(item.entry, locale).name,
          ]),
        )}
        onChanged={companyPacks.refresh}
      />
      <RegistrySource
        environmentId={environmentId}
        sourceKind={result.value.sourceKind}
        source={result.value.source}
        onChanged={refresh}
      />
    </div>
  );
}

/** Where the marketplace list comes from: the built-in file, or an online registry (hub later). */
function RegistrySource(props: {
  readonly environmentId: EnvironmentId;
  readonly sourceKind: "local" | "remote" | "cache";
  readonly source: string;
  readonly onChanged: () => void;
}) {
  const t = useZenText(officeText);
  const registry = useContext(RegistryContext);
  const settings = useAtomValue(
    officeSettings({ environmentId: props.environmentId, input: NO_INPUT }),
  );
  const current = AsyncResult.isSuccess(settings) ? settings.value.registryUrl : null;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(setOfficeRegistryUrl, { label: t.registryUrlSave });
  const value = draft ?? current ?? "";
  const apply = async (url: string | null) => {
    if (url !== null && !/^https?:\/\/\S+$/i.test(url)) {
      setError(t.registryUrlInvalid);
      return;
    }
    setError(null);
    const outcome = await save({ environmentId: props.environmentId, input: { url } });
    if (outcome._tag !== "Success") return;
    setDraft(null);
    registry.refresh(officeSettings({ environmentId: props.environmentId, input: NO_INPUT }));
    props.onChanged();
    toastManager.add({ type: "success", title: t.registryUrlSaved });
  };
  const sourceLabel =
    props.sourceKind === "remote"
      ? t.registrySourceRemote(props.source)
      : props.sourceKind === "cache"
        ? t.registrySourceCache(props.source)
        : t.registrySourceLocal;
  return (
    <details className="rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {t.registrySource}: {sourceLabel}
      </summary>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void apply(value.trim() || null);
        }}
      >
        <label className="font-medium" htmlFor="zen-registry-url">
          {t.registryUrlLabel}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="zen-registry-url"
            className="min-w-64 flex-1"
            value={value}
            placeholder={t.registryUrlPlaceholder}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm">
            {t.registryUrlSave}
          </Button>
          {current ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void apply(null)}>
              {t.registryUrlClear}
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{t.registryUrlHelp}</p>
        {error ? (
          <p role="alert" className="text-destructive-foreground text-xs">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

function MarketplaceCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ZenMarketplaceEntry;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
  /** Installed for the whole company: members hide it instead of uninstalling it. */
  readonly managed?: boolean;
  readonly company?: ReactNode;
  /** The pack a share link pointed at: highlighted. */
  readonly focused?: boolean;
}) {
  const t = useZenText(officeText);
  const c = useZenText(officeChatText);
  const k = useZenText(customPacksText);
  const categories = useZenText(CATEGORY_TEXT);
  const { entry, installed, installedVersion } = props.item;
  // An installed pack with a newer version: install again updates it (customized copies stay).
  const updatable =
    installed && installedVersion !== null && isNewerVersion(entry.version, installedVersion);
  const comingSoon = entry.kind === "coming_soon";
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${comingSoon ? "opacity-70" : ""} ${props.focused ? "ring-2 ring-primary" : ""}`}
      aria-label={entry.name}
      data-zen-library-card={entry.id}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <WorkflowIcon name={entry.icon} className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{entry.name}</p>
          <p className="truncate text-muted-foreground text-xs">
            {t.versionLine(
              entry.author,
              installedVersion ?? entry.version,
              categories[entry.category],
            )}
          </p>
        </div>
        <PackPinButton environmentId={props.environmentId} entry={entry} />
      </div>
      {entry.community ? <LibraryCredit entry={entry} /> : null}
      <LibraryBadges entry={entry} />
      <p className="line-clamp-3 flex-1 text-muted-foreground text-sm">{entry.description}</p>
      <LibraryShots entry={entry} />
      {props.item.withdrawn !== undefined && props.item.withdrawn !== null ? (
        <WithdrawnWarning reason={props.item.withdrawn} />
      ) : null}
      {entry.sample ? <ZenPackSample environmentId={props.environmentId} id={entry.id} /> : null}
      {entry.workflows && entry.workflows.length > 1 ? (
        <p
          className="text-muted-foreground text-xs"
          data-zen-pack-workflows={entry.workflows.length}
        >
          {c.packWorkflows(entry.workflows.length)}
        </p>
      ) : null}
      {entry.kind === "pack" ? <ZenPackRequirements packId={entry.id} /> : null}
      {/* Wraps on narrow cards: "Update to 1.1.0" never covers "Installed" or "Uninstall". */}
      <div className="flex flex-wrap items-center justify-between gap-2" data-zen-library-actions>
        {comingSoon ? (
          <Badge variant="outline">{t.comingSoon}</Badge>
        ) : entry.kind === "builtin" ? (
          <Badge variant="secondary">
            <CheckIcon />
            {t.included}
          </Badge>
        ) : installed ? (
          <Badge variant="success">
            <CheckIcon />
            {t.installed}
          </Badge>
        ) : (
          // Every pack is free: LibraryBadges says so above.
          <span />
        )}
        {entry.kind === "builtin" ? (
          <UsePackButton environmentId={props.environmentId} entry={entry} />
        ) : null}
        {entry.kind === "pack" ? (
          installed && props.managed === true ? (
            <UsePackButton environmentId={props.environmentId} entry={entry} />
          ) : installed ? (
            <span className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
              <UsePackButton environmentId={props.environmentId} entry={entry} />
              {updatable ? (
                <Button size="sm" disabled={props.busy} onClick={props.onInstall}>
                  <DownloadIcon />
                  {k.updatePack(entry.version)}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onUninstall}>
                <Trash2Icon />
                {t.uninstall}
              </Button>
            </span>
          ) : (
            <Button size="sm" disabled={props.busy} onClick={props.onInstall}>
              <DownloadIcon />
              {props.busy ? t.installing : t.install}
            </Button>
          )
        ) : null}
      </div>
      {entry.community ? (
        <div className="flex items-center justify-between gap-1 border-t pt-2">
          <ShareButton entry={entry} />
          <ReportButton environmentId={props.environmentId} entry={entry} />
        </div>
      ) : null}
      {props.company}
    </article>
  );
}
