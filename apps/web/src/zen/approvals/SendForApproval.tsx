// Zen Staff: "Trimite clientului spre aprobare" in the file viewer: files (plus others from the
// folder, for a carousel), client, title, note, language, expiry; the server copies them to the hub
// (op `approval.create`) and the link is shown to copy. Answers return on the chat's card
// (ApprovalDock.tsx). Rendered by FilePreviewPanel (1 import + 8 lines).
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, SendIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useProjectEntriesQuery } from "../../components/files/projectFilesQueryState";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { toastManager } from "../../components/ui/toast";
import { useThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { companyOfProject } from "../companies/companiesModel";
import { useCompanyIndex } from "../companies/companiesState";
import { hubErrorMessage, useHubCall, useHubQuery } from "../hub/hubClient";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { approvalsText } from "./approvals.i18n";
import { approvalKindOf, pickHubWorkspace } from "./approvalsModel";
import { refreshThreadApprovals } from "./approvalsState";
import { ZenNativeSelect } from "../ui/ZenSelect";

const EXPIRY_CHOICES = [3, 7, 14, 30] as const;

export function useZenSendForApproval(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string | null;
  readonly available: boolean;
  readonly threadRef: ScopedThreadRef;
}): ReactNode {
  const t = useZenText(approvalsText);
  const primary = usePrimaryEnvironmentId();
  const [open, setOpen] = useState(false);
  const kind = input.relativePath === null ? null : approvalKindOf(input.relativePath);
  // The hub session lives on the primary machine, and the server reads the file there.
  if (
    !input.available ||
    kind === null ||
    primary !== input.environmentId ||
    input.relativePath === null
  ) {
    return null;
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        title={t.sendHint}
        onClick={() => setOpen(true)}
        data-zen-send-approval
      >
        <SendIcon className="size-3.5" />
        {t.sendShort}
      </Button>
      {open ? (
        <SendForApprovalDialog
          environmentId={input.environmentId}
          cwd={input.cwd}
          relativePath={input.relativePath}
          threadRef={input.threadRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const folderOf = (relativePath: string) => {
  const index = relativePath.lastIndexOf("/");
  return index < 0 ? "" : relativePath.slice(0, index);
};
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function SendForApprovalDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const t = useZenText(approvalsText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const { call } = useHubCall();
  const hub = useHubQuery<ZenHubStatus>(props.environmentId, "status");
  const index = useCompanyIndex();
  const shell = useThreadShell(props.threadRef);
  const localCompanyId =
    shell === null ? null : companyOfProject(index, props.environmentId, String(shell.projectId));
  const company = index.companies.find((item) => item.id === localCompanyId) ?? null;
  const isClient = company !== null && company.id !== ZEN_PERSONAL_COMPANY_ID;
  const folder = folderOf(props.relativePath);
  const entries = useProjectEntriesQuery(
    props.environmentId,
    props.cwd,
    folder === "" ? undefined : folder,
  );
  const siblings = (entries.data?.entries ?? [])
    .filter((entry) => entry.kind === "file" && entry.path !== props.relativePath)
    .filter((entry) => folderOf(entry.path) === folder && approvalKindOf(entry.path) !== null)
    .map((entry) => entry.path)
    .slice(0, 30);
  const [extra, setExtra] = useState<ReadonlyArray<string>>([]);
  const [clientName, setClientName] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [language, setLanguage] = useState<"ro" | "en">(locale === "en" ? "en" : "ro");
  const [days, setDays] = useState<number>(14);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const status = hub.data;
  const choice =
    status === null || !status.signedIn
      ? null
      : pickHubWorkspace({ localCompanyId, links: status.links, companies: status.companies });
  const chosenWorkspace =
    workspace ?? (choice !== null && choice.kind === "chosen" ? choice.id : null);
  const name = clientName ?? (isClient ? company.name : "");
  const files = [props.relativePath, ...extra];

  const createWorkspace = async () => {
    const owner = status?.user?.name || status?.user?.email || "Zen Staff";
    setBusy(true);
    setError(null);
    await call<{ id: string }>("company.create", { name: t.workspaceName(owner) })
      .then((created) => {
        setWorkspace(created.id);
        hub.refresh();
      })
      .catch((cause: unknown) => setError(hubErrorMessage(cause, t.tryAgain)));
    setBusy(false);
  };

  const submit = async () => {
    if (chosenWorkspace === null || name.trim() === "") return;
    setBusy(true);
    setError(null);
    // Promise chain, not try/finally: the React Compiler skips components with a finally.
    await call<{ record: { url: string } }>("approval.create", {
      cwd: props.cwd,
      relativePaths: files,
      threadId: props.threadRef.threadId,
      localCompanyId: isClient ? company.id : null,
      hubCompanyId: chosenWorkspace,
      clientName: name.trim(),
      title: title.trim() === "" ? undefined : title.trim(),
      note: note.trim(),
      language,
      expiresInDays: days,
    })
      .then((created) => {
        setLink(created.record.url);
        refreshThreadApprovals(props.environmentId, props.threadRef.threadId);
      })
      .catch((cause: unknown) => setError(hubErrorMessage(cause, t.tryAgain)));
    setBusy(false);
  };

  const copy = () => {
    if (link === null) return;
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        toastManager.add({ type: "success", title: t.copied });
      })
      .catch(() => undefined);
  };

  const twoFactor = (status?.twoFactor?.gate ?? "ok") !== "ok";

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-lg" data-zen-approval-dialog>
        <DialogHeader>
          <DialogTitle>{link === null ? t.dialogTitle : t.created}</DialogTitle>
          <DialogDescription>{link === null ? t.dialogIntro : t.createdHint}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {link !== null ? (
            <div className="flex flex-col gap-3" data-zen-approval-link>
              <Input
                readOnly
                value={link}
                aria-label={t.copy}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button onClick={copy} variant={copied ? "outline" : "default"}>
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                {copied ? t.copied : t.copy}
              </Button>
            </div>
          ) : status === null ? (
            <div className="flex flex-col gap-3" aria-busy>
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded bg-muted" />
              <div className="h-20 w-full animate-pulse rounded bg-muted" />
            </div>
          ) : !status.signedIn || twoFactor ? (
            <Alert>
              <AlertDescription>
                <span className="flex flex-col items-start">
                  {twoFactor ? t.twoFactor : t.notSignedIn}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => void navigate({ to: "/hub" })}
                  >
                    {t.openTeam}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <span className="font-medium text-sm">{t.files}</span>
                <ul className="flex flex-col gap-1.5 text-sm">
                  <li className="flex items-center gap-2">
                    <Checkbox checked disabled aria-label={baseName(props.relativePath)} />
                    <span className="min-w-0 truncate">{baseName(props.relativePath)}</span>
                  </li>
                </ul>
                {siblings.length > 0 ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      {t.alsoFromFolder}
                    </summary>
                    <ul className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                      {siblings.map((path) => (
                        <li key={path}>
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={extra.includes(path)}
                              onCheckedChange={(checked) =>
                                setExtra((current) =>
                                  checked === true
                                    ? [...current, path].slice(0, 9)
                                    : current.filter((item) => item !== path),
                                )
                              }
                            />
                            <span className="min-w-0 truncate">{baseName(path)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t.clientName}</span>
                <Input
                  value={name}
                  maxLength={80}
                  onChange={(event) => setClientName(event.currentTarget.value)}
                  data-zen-approval-client
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t.title}</span>
                <Input
                  value={title}
                  maxLength={160}
                  placeholder={t.titlePlaceholder}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t.note}</span>
                <Textarea
                  value={note}
                  maxLength={2000}
                  rows={3}
                  placeholder={t.notePlaceholder}
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t.language}</span>
                  <ZenNativeSelect
                    className="h-9 rounded-md border bg-background px-2"
                    value={language}
                    onChange={(event) =>
                      setLanguage(event.currentTarget.value === "en" ? "en" : "ro")
                    }
                    data-zen-no-translate
                  >
                    <option value="ro">Română</option>
                    <option value="en">English</option>
                  </ZenNativeSelect>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t.expires}</span>
                  <ZenNativeSelect
                    className="h-9 rounded-md border bg-background px-2"
                    value={days}
                    onChange={(event) => setDays(Number(event.currentTarget.value))}
                  >
                    {EXPIRY_CHOICES.map((count) => (
                      <option key={count} value={count}>
                        {t.days(count)}
                      </option>
                    ))}
                  </ZenNativeSelect>
                </label>
              </div>
              {choice !== null && choice.kind === "none" && workspace === null ? (
                <Button variant="outline" disabled={busy} onClick={() => void createWorkspace()}>
                  {t.createWorkspace}
                </Button>
              ) : choice !== null && choice.kind !== "none" && choice.options.length > 1 ? (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t.workspace}</span>
                  <ZenNativeSelect
                    className="h-9 rounded-md border bg-background px-2"
                    value={chosenWorkspace ?? ""}
                    onChange={(event) => setWorkspace(event.currentTarget.value || null)}
                  >
                    {chosenWorkspace === null ? <option value="">-</option> : null}
                    {choice.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </ZenNativeSelect>
                </label>
              ) : null}
              {error !== null ? (
                <Alert variant="error">
                  <AlertDescription>
                    {t.failed}: {error}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          {link !== null ? (
            <Button onClick={props.onClose}>{t.done}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={props.onClose}>
                {t.cancel}
              </Button>
              <Button
                disabled={
                  busy ||
                  chosenWorkspace === null ||
                  name.trim() === "" ||
                  status?.signedIn !== true
                }
                onClick={() => void submit()}
                data-zen-approval-create
              >
                <SendIcon className="size-4" />
                {busy ? t.creating : t.create}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
