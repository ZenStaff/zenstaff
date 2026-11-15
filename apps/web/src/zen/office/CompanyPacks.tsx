// Zen Staff hub v6: packs installed for the whole company. On a marketplace card: "Install for the
// company" (owners/admins), or "Installed for the company" with Hide/Show (members cannot
// uninstall it). Below the cards, for admins: each company pack with every computer's status.
import type { EnvironmentId } from "@t3tools/contracts";
import { BuildingIcon, EyeIcon, EyeOffIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { hubErrorMessage, useHubCall, useHubQuery } from "../hub/hubClient";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { formatWhen } from "../staff/staffShared";
import { companyPacksText } from "./companyPacks.i18n";
import {
  companyPackControl,
  companyPackRows,
  companyPackSummary,
  isCompanyAdmin,
  type CompanyPacksView,
} from "./companyPacksModel";
import { useOfficeCompany } from "./useOfficeCompany";

/** The company packs of the company chosen in the sidebar (null when it is not on a hub). */
export function useCompanyPacks(environmentId: EnvironmentId) {
  const { companyId, index } = useOfficeCompany();
  const linked = companyId !== null && companyId !== "personal";
  const query = useHubQuery<CompanyPacksView>(
    environmentId,
    "companyPacks.list",
    linked ? { localCompanyId: companyId } : { localCompanyId: "" },
  );
  const companyName = index.companies.find((company) => company.id === companyId)?.name ?? "";
  return {
    view: linked && query.error === null ? query.data : null,
    companyName,
    refresh: query.refresh,
  };
}

const failure = (error: unknown) =>
  toastManager.add({ type: "error", title: hubErrorMessage(error) });

/** The company part of one marketplace card. */
export function CompanyPackControls(props: {
  readonly view: CompanyPacksView | null;
  readonly companyName: string;
  readonly packId: string;
  readonly packName: string;
  readonly onChanged: () => void;
}) {
  const t = useZenText(companyPacksText);
  const { call } = useHubCall();
  const [busy, setBusy] = useState(false);
  const control = companyPackControl(props.view, props.packId);
  if (props.view === null) return null;
  const run = async (action: () => Promise<unknown>, toast: string) => {
    setBusy(true);
    // No try/finally here: the React Compiler skips components that use it.
    await action()
      .then(() => {
        toastManager.add({ type: "success", title: toast });
        props.onChanged();
      })
      .catch((error: unknown) => failure(error));
    setBusy(false);
  };
  if (control.managed) {
    return (
      <div className="flex flex-col gap-1.5" data-zen-company-pack={props.packId}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="info">
            <BuildingIcon />
            {t.installedForCompany}
          </Badge>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () => call("companyPacks.hide", { packId: props.packId, hidden: !control.hidden }),
                control.hidden ? t.shownToast(props.packName) : t.hiddenToast(props.packName),
              )
            }
          >
            {control.hidden ? <EyeIcon /> : <EyeOffIcon />}
            {control.hidden ? t.show : t.hide}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {control.enterprise ? t.enterpriseNote : t.managedNote}
        </p>
      </div>
    );
  }
  if (!control.canInstall) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      data-zen-install-for-company={props.packId}
      onClick={() => {
        if (!globalThis.confirm(t.installForCompanyConfirm(props.packName, props.companyName)))
          return;
        void run(
          () =>
            call("companyPacks.install", {
              companyId: props.view!.companyId,
              packId: props.packId,
            }),
          t.installedForCompanyToast(props.packName),
        );
      }}
    >
      <BuildingIcon />
      {t.installForCompany}
    </Button>
  );
}

/** Admins: every company pack and how far it got on each computer. */
export function CompanyPacksPanel(props: {
  readonly view: CompanyPacksView | null;
  readonly names: Readonly<Record<string, string>>;
  readonly onChanged: () => void;
}) {
  const t = useZenText(companyPacksText);
  const locale = useZenLocale();
  const { call } = useHubCall();
  const [checking, setChecking] = useState(false);
  const { view, onChanged } = props;
  const admin = isCompanyAdmin(view);
  // Installs happen on everyone's next sync: look again while the panel is open.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: other computers report their installs to the hub while this panel is open.
  useEffect(() => {
    if (!admin) return;
    const timer = setInterval(onChanged, 10_000);
    return () => clearInterval(timer);
  }, [admin, onChanged]);
  if (view === null || !admin) return null;
  const nameOf = (packId: string) => props.names[packId] ?? packId;
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4" data-zen-company-packs>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">{t.panelTitle}</h2>
          <p className="text-muted-foreground text-sm">{t.panelIntro}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void call("companyPacks.sync")
              .catch(failure)
              .finally(() => {
                setChecking(false);
                onChanged();
              });
          }}
        >
          <RefreshCwIcon />
          {t.checkNow}
        </Button>
      </div>
      {view.refused.length > 0 ? (
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
          {t.refused(view.refused.length)}
        </p>
      ) : null}
      {view.packs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.nothingYet}</p>
      ) : null}
      {view.packs.map((pack) => {
        const rows = companyPackRows(view, pack.packId);
        const summary = companyPackSummary(view, pack.packId);
        return (
          <div key={pack.packId} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{nameOf(pack.packId)}</span>
              <Badge variant="outline" size="sm">
                {pack.version}
              </Badge>
              {pack.enterprise ? (
                <Badge variant="warning" size="sm">
                  {t.enterprise}
                </Badge>
              ) : null}
              <span className="text-muted-foreground text-xs">
                {t.by(pack.updatedByName, formatWhen(pack.updatedAt, locale))}
                {summary.total > 0 ? ` · ${summary.installed}/${summary.total}` : ""}
              </span>
              <span className="flex-1" />
              <Button
                size="xs"
                variant="ghost-destructive"
                onClick={() => {
                  if (!globalThis.confirm(t.removeConfirm(nameOf(pack.packId)))) return;
                  void call("companyPacks.remove", {
                    companyId: view.companyId,
                    packId: pack.packId,
                  })
                    .then(() => {
                      toastManager.add({
                        type: "success",
                        title: t.removedToast(nameOf(pack.packId)),
                      });
                      onChanged();
                    })
                    .catch(failure);
                }}
              >
                <Trash2Icon />
                {t.remove}
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t.nobodyYet}</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-normal">{t.columns.person}</th>
                    <th className="py-1 pr-2 font-normal">{t.columns.machine}</th>
                    <th className="py-1 pr-2 font-normal">{t.columns.state}</th>
                    <th className="py-1 pr-2 font-normal">{t.columns.version}</th>
                    <th className="py-1 font-normal">{t.columns.updated}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t" data-zen-pack-status={row.state}>
                      <td className="py-1 pr-2">{row.person}</td>
                      <td className="py-1 pr-2">
                        {row.machine}
                        {row.runner ? ` (${t.companyServer})` : ""}
                      </td>
                      <td className="py-1 pr-2">
                        <Badge
                          size="sm"
                          variant={
                            row.state === "failed"
                              ? "error"
                              : row.state === "installed"
                                ? "success"
                                : "secondary"
                          }
                        >
                          {t.states[row.state]}
                        </Badge>
                        {row.error ? (
                          <span className="ml-2 text-destructive-foreground">{row.error}</span>
                        ) : null}
                        {row.hidden ? (
                          <span className="ml-2 text-muted-foreground">{t.hiddenByPerson}</span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-2">
                        {row.behind !== null
                          ? t.olderVersion(row.behind, pack.version)
                          : (row.version ?? "")}
                      </td>
                      <td className="py-1">{formatWhen(row.updatedAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}
