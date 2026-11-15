// Zen Staff community library ("Bibliotecă"): origin and "Verificat de Zen" badges, credit,
// images, share, report, the taken-down warning, publishing and its status. Data: the merged
// catalog (ZenOffice.registry) and `zen.office.library` (libraryClient.ts). ZEN.md, "Community library".
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_WORKFLOW_CATEGORIES,
  type ZenRegistryEntry,
  type ZenWorkflowCategory,
} from "@t3tools/contracts/zenOffice";
import {
  BadgeCheckIcon,
  FlagIcon,
  ImagePlusIcon,
  SendIcon,
  Share2Icon,
  SparklesIcon,
  TriangleAlertIcon,
  UploadIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
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
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { toastManager } from "../../components/ui/toast";
import { zenServerText } from "../i18n/serverText";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { CATEGORY_TEXT } from "./office.i18n";
import { libraryText } from "./library.i18n";
import { useLibraryCall } from "./libraryClient";
import {
  creditParts,
  type LibraryCheck,
  type LibraryMine,
  type LibrarySource,
  latestVersion,
  nextVersion,
  originOf,
  PACK_ID_PATTERN,
  packIdFromTitle,
  publishedVersion,
  screenshotProblem,
  statusTone,
  VERSION_PATTERN,
} from "./libraryModel";
import { WorkflowIcon } from "./workflowIcons";
import { ZenNativeSelect } from "../ui/ZenSelect";

/** "Zen Staff" or "Comunitate", "Verificat de Zen", "Recomandat" and "Gratuit" on a card. */
export function LibraryBadges({ entry }: { readonly entry: ZenRegistryEntry }) {
  const t = useZenText(libraryText);
  const origin = originOf(entry);
  return (
    <div className="flex flex-wrap items-center gap-1" data-zen-library-origin={origin}>
      {origin === "zen" ? (
        <Badge variant="secondary">
          <SparklesIcon />
          {t.originZen}
        </Badge>
      ) : (
        <Badge variant="outline">
          <UsersRoundIcon />
          {t.originCommunity}
        </Badge>
      )}
      {entry.community?.verified ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="success" data-zen-library-verified>
                <BadgeCheckIcon />
                {t.verified}
              </Badge>
            }
          />
          <TooltipPopup className="max-w-64">{t.verifiedHint}</TooltipPopup>
        </Tooltip>
      ) : null}
      {entry.community?.featured ? <Badge variant="warning">{t.featured}</Badge> : null}
      {entry.kind === "pack" ? <Badge variant="outline">{t.free}</Badge> : null}
    </div>
  );
}

/** "de Ana Pop · Bistro Ana · 120 instalări", linking to the author's page. */
export function LibraryCredit({ entry }: { readonly entry: ZenRegistryEntry }) {
  const t = useZenText(libraryText);
  const credit = creditParts(entry);
  if (credit === null) return null;
  const url = entry.community?.author?.url;
  return (
    <p className="truncate text-muted-foreground text-xs" data-zen-library-credit>
      {url ? (
        <a
          className="underline-offset-2 hover:underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {t.by(credit.author)}
        </a>
      ) : (
        t.by(credit.author)
      )}
      {credit.company ? ` · ${credit.company}` : ""} · {t.installs(credit.installs)}
    </p>
  );
}

/** The author's images of the result; one that does not load is hidden. */
export function LibraryShots({ entry }: { readonly entry: ZenRegistryEntry }) {
  const shots = entry.community?.screenshots ?? [];
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const visible = shots.filter((src) => !broken.has(src)).slice(0, 2);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {visible.map((src) => (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          className="aspect-[16/10] w-full rounded-md border object-cover"
          onError={() => setBroken((current) => new Set([...current, src]))}
        />
      ))}
    </div>
  );
}

/** "Trimite unui coleg": copies the pack's public page. */
export function ShareButton({ entry }: { readonly entry: ZenRegistryEntry }) {
  const t = useZenText(libraryText);
  const url = entry.community?.shareUrl;
  if (!url) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      data-zen-library-share
      onClick={() =>
        void navigator.clipboard
          ?.writeText(url)
          .then(() => toastManager.add({ type: "success", title: t.shareCopied, description: url }))
          .catch(() => toastManager.add({ type: "error", title: t.shareFailed, description: url }))
      }
    >
      <Share2Icon />
      {t.share}
    </Button>
  );
}

const REASONS = ["unsafe", "broken", "secrets", "spam", "copyright", "other"] as const;

export function ReportButton(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: ZenRegistryEntry;
}) {
  const t = useZenText(libraryText);
  const [open, setOpen] = useState(false);
  if (!props.entry.community) return null;
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t.report}
        title={t.report}
        onClick={() => setOpen(true)}
      >
        <FlagIcon />
      </Button>
      {open ? (
        <ReportDialog
          environmentId={props.environmentId}
          entry={props.entry}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ReportDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: ZenRegistryEntry;
  readonly onClose: () => void;
}) {
  const t = useZenText(libraryText);
  const locale = useZenLocale();
  const call = useLibraryCall();
  const [reason, setReason] = useState<(typeof REASONS)[number]>("broken");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(props.environmentId, "report", {
        slug: props.entry.community!.slug,
        reason,
        detail,
      });
      toastManager.add({ type: "success", title: t.reportSent });
      props.onClose();
    } catch (failure) {
      setError(zenServerText(failure instanceof Error ? failure.message : String(failure), locale));
    }
    // No `finally`: React Compiler skips components that use one.
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.reportTitle(props.entry.name)}</DialogTitle>
          <DialogDescription>{t.reportIntro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 font-medium text-sm">{t.reportReason}</legend>
            {REASONS.map((item) => (
              <label key={item} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="zen-library-report"
                  checked={reason === item}
                  onChange={() => setReason(item)}
                />
                {t.reasons[item]}
              </label>
            ))}
          </fieldset>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="zen-library-report-detail">{t.reportDetail}</Label>
            <Textarea
              id="zen-library-report-detail"
              rows={3}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-destructive-foreground text-sm">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button onClick={() => void send()} disabled={busy}>
            <FlagIcon />
            {t.reportSend}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** On an installed community pack the library took down. */
export function WithdrawnWarning({ reason }: { readonly reason: string }) {
  const t = useZenText(libraryText);
  return (
    <p
      role="status"
      className="flex gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs"
      data-zen-library-withdrawn
    >
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {t.withdrawn(reason)}
    </p>
  );
}

interface PublishState {
  readonly sources: ReadonlyArray<LibrarySource>;
  readonly mine: LibraryMine;
}

/** "Pachetele tale în bibliotecă": what the person can publish, and the status of what they sent. */
export function PublishSection(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string | null;
  /** Preview mode for screenshots and tests: fixed data instead of the server. */
  readonly preview?: PublishState;
}) {
  const t = useZenText(libraryText);
  const locale = useZenLocale();
  const call = useLibraryCall();
  const [data, setData] = useState<PublishState | null>(props.preview ?? null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<LibrarySource | null>(null);
  const [revision, setRevision] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the person's publishable workflows and their submissions from the server (and again after a publish)
  useEffect(() => {
    if (props.preview || revision < 0) return;
    let live = true;
    void Promise.all([
      call<{ sources: ReadonlyArray<LibrarySource> }>(props.environmentId, "sources", {
        companyId: props.companyId,
      }),
      call<LibraryMine>(props.environmentId, "mine", {}),
    ])
      .then(([sources, mine]) => live && setData({ sources: sources.sources, mine }))
      .catch(
        (failure: unknown) =>
          live &&
          setError(
            zenServerText(failure instanceof Error ? failure.message : String(failure), locale),
          ),
      );
    return () => {
      live = false;
    };
  }, [call, props.environmentId, props.companyId, props.preview, revision, locale]);

  const packs = data?.mine.packs ?? [];
  const publishedTitle = (source: LibrarySource) =>
    packs.find(
      (pack) =>
        latestVersion(pack)?.title === source.name || pack.packId === packIdFromTitle(source.name),
    );
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      aria-label={t.publishSection}
      data-zen-library-publish
    >
      <div className="flex items-center gap-2">
        <UploadIcon className="size-4 text-primary" aria-hidden />
        <h2 className="font-medium">{t.publishSection}</h2>
      </div>
      <p className="text-muted-foreground text-sm">{t.publishIntro}</p>
      {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      {data !== null && !data.mine.signedIn ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">{t.publishSignIn}</p>
      ) : null}
      {data !== null && data.mine.signedIn && data.sources.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.publishNothing}</p>
      ) : null}
      {data !== null && data.sources.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.sources.map((source) => {
            const existing = publishedTitle(source);
            return (
              <li
                key={`${source.workflowId}:${source.companyId ?? ""}`}
                className="flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2"
              >
                <WorkflowIcon name={source.icon} className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{source.name}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {source.kind === "own" ? t.publishKindOwn : t.publishKindCustomized}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={existing ? "outline" : "default"}
                  disabled={!data.mine.signedIn}
                  onClick={() => setPublishing(source)}
                  data-zen-library-publish-button
                >
                  <SendIcon />
                  {existing ? t.sendUpdate : t.publish}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {packs.length > 0 ? <SubmissionStatus mine={data!.mine} /> : null}
      {publishing !== null ? (
        <PublishDialog
          environmentId={props.environmentId}
          companyId={props.companyId}
          source={publishing}
          author={data?.mine.author ?? null}
          existing={publishedTitle(publishing) ?? null}
          onClose={() => setPublishing(null)}
          onSent={() => setRevision((value) => value + 1)}
        />
      ) : null}
    </section>
  );
}

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  waiting: "bg-muted text-foreground",
  action: "bg-warning/15 text-warning-foreground",
  done: "bg-success/15 text-success-foreground",
  refused: "bg-destructive/10 text-destructive-foreground",
  old: "bg-muted text-muted-foreground",
};

function SubmissionStatus({ mine }: { readonly mine: LibraryMine }) {
  const t = useZenText(libraryText);
  return (
    <div className="flex flex-col gap-2" data-zen-library-status>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">{t.statusTitle}</h3>
        {mine.author?.url ? (
          <a
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            href={mine.author.url}
            target="_blank"
            rel="noreferrer"
          >
            {t.authorPage}
          </a>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2">
        {mine.packs.map((pack) => {
          const latest = latestVersion(pack);
          if (latest === null) return null;
          const live = publishedVersion(pack);
          return (
            <li key={pack.slug} className="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-sm">{latest.title}</span>
                <span className="font-mono text-muted-foreground text-xs">{latest.version}</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium text-xs ${TONE_CLASS[statusTone(latest.status)]}`}
                  data-zen-library-status-chip={latest.status}
                >
                  {t.status[latest.status]}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {live !== null
                  ? `${t.status.published} ${live} · ${t.installs(pack.installs)}`
                  : null}
                {pack.featured ? ` · ${t.featured}` : null}
              </p>
              {pack.state === "unpublished" && pack.unpublishedReason ? (
                <p className="text-destructive-foreground text-xs">
                  {t.takenDown(pack.unpublishedReason)}
                </p>
              ) : null}
              {latest.reviewNote ? (
                <p className="rounded-md border-warning border-l-2 bg-warning/5 px-2 py-1.5 text-xs">
                  <span className="font-medium">{t.reviewerNote}: </span>
                  {latest.reviewNote}
                </p>
              ) : null}
              {pack.shareUrl ? (
                <div>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(pack.shareUrl!)
                        .then(() => toastManager.add({ type: "success", title: t.shareCopied }))
                    }
                  >
                    <Share2Icon />
                    {t.share}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const LICENCES = ["MIT", "CC-BY-4.0", "Apache-2.0", "CC0-1.0"] as const;
const LANGUAGES = ["ro", "en", "ro+en"] as const;

interface ChosenImage {
  readonly name: string;
  readonly mime: string;
  readonly data: string;
}

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function PublishDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string | null;
  readonly source: LibrarySource;
  readonly author: LibraryMine["author"];
  readonly existing: LibraryMine["packs"][number] | null;
  readonly onClose: () => void;
  readonly onSent: () => void;
  /** Screenshots: open with these values (and checks) without calling the server. */
  readonly preview?: { readonly checks?: ReadonlyArray<LibraryCheck> };
}) {
  const t = useZenText(libraryText);
  const locale = useZenLocale();
  const categories = useZenText(CATEGORY_TEXT);
  const call = useLibraryCall();
  const [title, setTitle] = useState(props.source.name);
  const [description, setDescription] = useState(props.source.description);
  const [category, setCategory] = useState<ZenWorkflowCategory>(
    (ZEN_WORKFLOW_CATEGORIES as ReadonlyArray<string>).includes(props.source.category)
      ? (props.source.category as ZenWorkflowCategory)
      : "admin",
  );
  const [packId, setPackId] = useState(
    props.existing?.packId ?? packIdFromTitle(props.source.name),
  );
  // A published pack gets the next version; one still under review keeps its version (resubmitted).
  const [version, setVersion] = useState(() => {
    if (props.existing === null) return "1.0.0";
    const live = publishedVersion(props.existing);
    return live !== null ? nextVersion(live) : (latestVersion(props.existing)?.version ?? "1.0.0");
  });
  const [licence, setLicence] = useState<(typeof LICENCES)[number]>("MIT");
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("ro");
  const [changelog, setChangelog] = useState(props.existing ? "" : "Prima versiune.");
  const [sampleOutput, setSampleOutput] = useState("");
  const [images, setImages] = useState<ReadonlyArray<ChosenImage>>([]);
  const [authorName, setAuthorName] = useState(props.author?.name ?? "");
  const [authorCompany, setAuthorCompany] = useState(props.author?.company ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReadonlyArray<LibraryCheck> | null>(
    props.preview?.checks ?? null,
  );

  const addImages = async (files: FileList | null) => {
    if (files === null) return;
    const next = [...images];
    for (const file of Array.from(files)) {
      const problem = screenshotProblem(file, next.length);
      if (problem !== null) {
        setError(t.imageProblem[problem]!);
        continue;
      }
      next.push({ name: file.name, mime: file.type, data: await readAsBase64(file) });
    }
    setImages(next);
  };

  const send = async () => {
    if (!PACK_ID_PATTERN.test(packId)) return setError(t.invalidPackId);
    if (!VERSION_PATTERN.test(version)) return setError(t.invalidVersion);
    setBusy(true);
    setError(null);
    setChecks(null);
    try {
      const result = await call<{
        refused: boolean;
        error?: string;
        checks?: ReadonlyArray<LibraryCheck>;
      }>(props.environmentId, "publish", {
        workflowId: props.source.workflowId,
        companyId: props.companyId,
        packId,
        version,
        authorName: authorName.trim(),
        authorCompany: authorCompany.trim(),
        meta: {
          title,
          description,
          category,
          icon: props.source.icon,
          licence,
          language,
          changelog,
          sampleOutput,
        },
        screenshots: images,
      });
      if (result.refused) {
        setChecks(result.checks ?? []);
        setError(t.refused);
      } else {
        toastManager.add({ type: "success", title: t.sent });
        props.onSent();
        props.onClose();
      }
    } catch (failure) {
      setError(zenServerText(failure instanceof Error ? failure.message : String(failure), locale));
    }
    // No `finally`: React Compiler skips components that use one.
    setBusy(false);
  };

  const field = (id: string, label: string, control: ReactNode, help?: string) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {help ? <p className="text-muted-foreground text-xs">{help}</p> : null}
    </div>
  );
  const select = <T extends string>(
    id: string,
    value: T,
    options: ReadonlyArray<readonly [T, string]>,
    onChange: (value: T) => void,
  ) => (
    <ZenNativeSelect
      id={id}
      className="h-9 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map(([option, label]) => (
        <option key={option} value={option}>
          {label}
        </option>
      ))}
    </ZenNativeSelect>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup className="sm:max-w-2xl" data-zen-library-publish-dialog>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <UploadIcon className="size-4.5 text-primary" />
              {t.dialogTitle(props.source.name)}
            </span>
          </DialogTitle>
          <DialogDescription>{t.dialogIntro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-3 sm:grid-cols-2">
            {field(
              "zen-lib-title",
              t.fieldTitle,
              <Input
                id="zen-lib-title"
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
              />,
            )}
            {field(
              "zen-lib-category",
              t.fieldCategory,
              select(
                "zen-lib-category",
                category,
                ZEN_WORKFLOW_CATEGORIES.map((item) => [item, categories[item]] as const),
                setCategory,
              ),
            )}
            <div className="sm:col-span-2">
              {field(
                "zen-lib-description",
                t.fieldDescription,
                <Textarea
                  id="zen-lib-description"
                  rows={2}
                  value={description}
                  maxLength={600}
                  onChange={(event) => setDescription(event.target.value)}
                />,
              )}
            </div>
            {/* Id, version and licence are filled in for you (review P1-23); change them only here. */}
            <details className="sm:col-span-2" data-zen-library-advanced>
              <summary className="cursor-pointer text-muted-foreground text-sm">
                {t.advanced}
              </summary>
              <p className="mt-1 text-muted-foreground text-xs">
                {t.advancedSummary(packId, version, t.licenceNames[licence] ?? licence)}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {field(
                  "zen-lib-id",
                  t.fieldPackId,
                  <Input
                    id="zen-lib-id"
                    value={packId}
                    disabled={props.existing !== null}
                    onChange={(event) => setPackId(event.target.value.trim())}
                  />,
                  t.fieldPackIdHelp,
                )}
                {field(
                  "zen-lib-version",
                  t.fieldVersion,
                  <Input
                    id="zen-lib-version"
                    value={version}
                    onChange={(event) => setVersion(event.target.value.trim())}
                  />,
                )}
                {field(
                  "zen-lib-licence",
                  t.fieldLicence,
                  select(
                    "zen-lib-licence",
                    licence,
                    LICENCES.map((item) => [item, t.licenceNames[item] ?? item] as const),
                    setLicence,
                  ),
                  t.licenceHelp,
                )}
              </div>
            </details>
            {field(
              "zen-lib-language",
              t.fieldLanguage,
              select(
                "zen-lib-language",
                language,
                LANGUAGES.map((item) => [item, t.languages[item]!] as const),
                setLanguage,
              ),
            )}
            <div className="sm:col-span-2">
              {field(
                "zen-lib-sample",
                t.fieldSampleOutput,
                <Input
                  id="zen-lib-sample"
                  value={sampleOutput}
                  placeholder={t.fieldSampleOutputPlaceholder}
                  maxLength={1000}
                  onChange={(event) => setSampleOutput(event.target.value)}
                />,
              )}
            </div>
            <div className="sm:col-span-2">
              {field(
                "zen-lib-changelog",
                t.fieldChangelog,
                <Textarea
                  id="zen-lib-changelog"
                  rows={2}
                  value={changelog}
                  maxLength={2000}
                  onChange={(event) => setChangelog(event.target.value)}
                />,
              )}
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="font-medium text-sm">{t.fieldImages}</span>
              <div className="flex flex-wrap items-center gap-2">
                {images.map((image) => (
                  <span key={image.name} className="relative">
                    <img
                      src={`data:${image.mime};base64,${image.data}`}
                      alt={image.name}
                      className="h-16 w-24 rounded-md border object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t.removeImage(image.name)}
                      className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5"
                      onClick={() => setImages(images.filter((item) => item !== image))}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
                {images.length < 4 ? (
                  <label className="flex h-16 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground text-xs">
                    <ImagePlusIcon className="size-4" aria-hidden />
                    {t.addImages}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="sr-only"
                      onChange={(event) => void addImages(event.target.files)}
                    />
                  </label>
                ) : null}
              </div>
            </div>
            {field(
              "zen-lib-author",
              t.fieldAuthor,
              <Input
                id="zen-lib-author"
                value={authorName}
                maxLength={80}
                onChange={(event) => setAuthorName(event.target.value)}
              />,
            )}
            {field(
              "zen-lib-company",
              t.fieldCompany,
              <Input
                id="zen-lib-company"
                value={authorCompany}
                maxLength={80}
                onChange={(event) => setAuthorCompany(event.target.value)}
              />,
            )}
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-destructive-foreground text-sm">
              {error}
            </p>
          ) : null}
          {checks !== null && checks.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm" data-zen-library-checks>
              {checks
                .filter((check) => check.level !== "pass")
                .flatMap((check) =>
                  check.findings.map((finding) => ({ level: check.level, finding })),
                )
                .map(({ level, finding }) => (
                  <li
                    key={finding}
                    className={
                      level === "fail" ? "text-destructive-foreground" : "text-muted-foreground"
                    }
                  >
                    {finding}
                  </li>
                ))}
            </ul>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button
            onClick={() => void send()}
            disabled={busy || title.trim() === ""}
            data-zen-library-send
          >
            <SendIcon />
            {busy ? t.sending : t.send}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
