// Zen Staff Office: "Adaugă un dosar". Two choices, no Git: a new folder for the company chosen in
// the switcher (`~/Zen Staff/<name>`), or a folder from this computer (the native picker on the
// desktop; a path field in the browser, where Enter adds it). The folder joins that company.
// Opened through `zenOpensAddFolder()` (addFolderStore.ts); mounted with the sidebar items.
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import { FolderOpenIcon, FolderPlusIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toastManager } from "../../components/ui/toast";
import { readLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  folderTitleOf,
  rememberOfficeFolder,
  siblingFolder,
  useAttachFolder,
  useCompanyFolderPath,
} from "../companies/companyFolder";
import { useZenText } from "../i18n/zenI18n";
import { addFolderText } from "./addFolder.i18n";
import { useZenAddFolder } from "./addFolderStore";
import { useOfficeCompany } from "./useOfficeCompany";

export function ZenAddFolderHost() {
  const open = useZenAddFolder((store) => store.open);
  return open ? <AddFolderDialog /> : null;
}

function AddFolderDialog() {
  const t = useZenText(addFolderText);
  const close = useZenAddFolder((store) => store.close);
  const environmentId = usePrimaryEnvironmentId();
  const { index, companyId } = useOfficeCompany();
  const target = companyId ?? ZEN_PERSONAL_COMPANY_ID;
  const company = index.companies.find((item) => item.id === target);
  const companyName =
    target === ZEN_PERSONAL_COMPANY_ID || company === undefined ? t.personal : company.name;
  const attach = useAttachFolder(environmentId);
  const folderPath = useCompanyFolderPath(environmentId);
  const [name, setName] = useState(
    target === ZEN_PERSONAL_COMPANY_ID || company === undefined ? "" : company.name,
  );
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = typeof window !== "undefined" && window.desktopBridge !== undefined;

  const done = (added: Awaited<ReturnType<typeof attach>>) => {
    setBusy(false);
    if (added === null) {
      setError(t.failed);
      return;
    }
    rememberOfficeFolder(added);
    toastManager.add({ type: "success", title: t.added(added.title, companyName) });
    close();
  };

  // Promise chains, not try/finally: the React Compiler skips components with a finally.
  const add = (folder: string, create: boolean) => {
    if (folder.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    void attach(folder.trim(), target, { create })
      .catch(() => null)
      .then(done);
  };

  const createNew = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void folderPath(target)
      .then((base) => {
        if (base === null) return null;
        const clean = name.trim();
        // The company's own folder, or a named folder next to it.
        const folder =
          clean === "" || clean === folderTitleOf(base) ? base : siblingFolder(base, clean);
        return attach(folder, target, { create: true });
      })
      .catch(() => null)
      .then(done);
  };

  const pick = () => {
    const api = readLocalApi();
    if (api === undefined || busy) return;
    void api.dialogs
      .pickFolder()
      .then((picked) => {
        if (picked) add(picked, false);
      })
      .catch(() => setError(t.failed));
  };

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogPopup className="sm:max-w-lg" data-zen-add-folder>
        <DialogHeader>
          <DialogTitle>{t.title(companyName)}</DialogTitle>
          <DialogDescription>{t.intro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <form
              className="flex flex-col gap-2 rounded-xl border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                createNew();
              }}
              data-zen-add-folder-new
            >
              <span className="flex items-center gap-2 font-medium text-sm">
                <FolderPlusIcon className="size-4" aria-hidden />
                {t.newFolder(companyName)}
              </span>
              <span className="text-muted-foreground text-xs">{t.newFolderBody}</span>
              <div className="flex gap-2">
                <Input
                  aria-label={t.newFolderName}
                  placeholder={t.newFolderName}
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  {busy ? <LoaderIcon className="animate-spin" /> : null}
                  {t.create}
                </Button>
              </div>
            </form>
            <div className="flex flex-col gap-2 rounded-xl border p-4" data-zen-add-folder-pick>
              <span className="flex items-center gap-2 font-medium text-sm">
                <FolderOpenIcon className="size-4" aria-hidden />
                {t.pick}
              </span>
              <span className="text-muted-foreground text-xs">{t.pickBody}</span>
              {desktop ? (
                <Button variant="outline" className="self-start" disabled={busy} onClick={pick}>
                  {t.pickButton}
                </Button>
              ) : (
                <form
                  className="flex flex-col gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    add(path, false);
                  }}
                >
                  <Label htmlFor="zen-add-folder-path" className="sr-only">
                    {t.pathLabel}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="zen-add-folder-path"
                      value={path}
                      placeholder={t.pathPlaceholder}
                      onChange={(event) => setPath(event.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <Button type="submit" variant="outline" disabled={busy || path.trim() === ""}>
                      {t.add}
                    </Button>
                  </div>
                </form>
              )}
            </div>
            {busy ? <p className="text-muted-foreground text-xs">{t.working}</p> : null}
            {error !== null ? (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
