// Zen Staff onboarding interview: chat-style bubbles driven by the structured flow in
// contracts/zenOnboarding.ts. Every answer is saved (resumable), any question can be skipped and
// "Later" puts it aside. It saves the profile (preview first), hires staff, opens Connect cards,
// sets edition and language, and opens the first workflow with sample answers.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ONBOARDING_STEPS,
  ONBOARDING_TIME_SINKS,
  ONBOARDING_TONES,
  ONBOARDING_TOOLS,
  ZEN_PERSONAL_COMPANY_ID,
  answerStep,
  applyPrefill,
  buildCompanyProfile,
  goBack,
  onboardingProgress,
  reopenInterview,
  skipInterview,
  skipStep,
  stepAvailable,
  suggestConnectors,
  suggestFirstWorkflow,
  suggestStaffRoles,
  toolLabel,
  type OnboardingAnswers,
  type OnboardingPrefill,
  type OnboardingState,
  type OnboardingStep,
  type ZenCompany,
} from "@t3tools/contracts/zenCompanies";
import type { StaffOverview, StaffRoleTemplate } from "@t3tools/contracts/zenStaff";
import { localizeWorkflowManifest } from "@t3tools/contracts/zenOffice";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  BriefcaseIcon,
  CheckIcon,
  FileUpIcon,
  GlobeIcon,
  LoaderIcon,
  PlugIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { RegistryContext } from "@effect/atom-react";

import { Button } from "../../components/ui/button";
import { Dialog, DialogPopup } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { cn, newProjectId } from "../../lib/utils";
import { readProjects, useProjects, waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { companyOfProject } from "../companies/companiesModel";
import {
  companiesListAtom,
  companyAssignProject,
  companyCreate,
  useCompanyIndex,
  useSelectedCompanyStore,
} from "../companies/companiesState";
import { ConnectCard } from "../connectors/ConnectCard";
import {
  connectorsCardsAtom,
  connectorsCatalogAtom,
  useConnectorsCall,
} from "../connectors/connectorsClient";
import type { CardData } from "../connectors/connectState";
import { setZenLocalePreference, useZenLocale, useZenText, zenText } from "../i18n/zenI18n";
import { switchZenEdition } from "../office/officeState";
import { officeWorkflows, workflowsInput } from "../office/officeState";
import { setOfficePrefill } from "../office/officePrefill";
import { useStaffCall, useStaffCatalog, useStaffOverview } from "../staff/staffClient";
import { useStaffDefaults } from "../staff/staffShared";
import { onboardingText } from "./onboarding.i18n";
import {
  fileToBase64,
  onboardingErrorMessage,
  useOnboardingCall,
  type OnboardingGetResult,
} from "./onboardingClient";
import { Skeleton } from "../../components/ui/skeleton";
import { SkeletonCards } from "../ui/ZenSkeletons";
import { useIsInternalFolder } from "../office/useInternalFolders";

const OFFICE_PROJECT_KEY = "zen:office:project";
const nowIso = () => new Date().toISOString();

type T = (typeof onboardingText)["en"];

// Bubbles

function Bubble(props: { readonly from: "zen" | "you"; readonly children: ReactNode }) {
  return (
    <div className={cn("flex w-full", props.from === "you" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          props.from === "you"
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
        )}
        data-onboarding-bubble={props.from}
      >
        {props.children}
      </div>
    </div>
  );
}

function Chip(props: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
        props.selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {props.selected ? <CheckIcon className="size-3.5" /> : null}
      {props.children}
    </button>
  );
}

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-foreground">{props.label}</span>
      {props.children}
    </label>
  );
}

const toggle = <V extends string>(list: ReadonlyArray<V> | undefined, value: V, max = 99): V[] => {
  const current = [...(list ?? [])];
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : current.length >= max
      ? current
      : [...current, value];
};

// What the person said, as a bubble

function answerSummary(step: OnboardingStep, answers: OnboardingAnswers, t: T): string | null {
  const join = (items: ReadonlyArray<string>) => items.join(", ");
  switch (step) {
    case "language":
      return answers.language === "en" ? "English" : answers.language === "ro" ? "Română" : null;
    case "who":
      return answers.who ? t.who[answers.who] : null;
    case "company":
      return [answers.companyName, answers.website].filter(Boolean).join(" · ") || null;
    case "offer":
      return (
        [answers.sells, answers.customers, answers.prices].filter(Boolean).join("\n\n") || null
      );
    case "voice":
      return (
        [
          answers.tones && answers.tones.length > 0
            ? join(answers.tones.map((tone) => t.tones[tone]))
            : null,
          answers.toneNotes,
          answers.competitors ? `${t.competitors}: ${answers.competitors}` : null,
        ]
          .filter(Boolean)
          .join("\n") || null
      );
    case "tools":
      return (
        [
          ...(answers.tools ?? []).map(toolLabel),
          ...(answers.toolsOther ? [answers.toolsOther] : []),
        ].join(", ") || null
      );
    case "timeSinks":
      return (
        [
          ...(answers.timeSinks ?? []).map((sink) => t.timeSinks[sink]),
          ...(answers.timeSinksOther ? [answers.timeSinksOther] : []),
        ].join(", ") || null
      );
    case "edition":
      return answers.edition === "office"
        ? t.editionOffice
        : answers.edition === "code"
          ? t.editionCode
          : null;
    default:
      return null;
  }
}

function questionOf(step: OnboardingStep, t: T): string {
  switch (step) {
    case "language":
      return t.askLanguage;
    case "who":
      return t.askWho;
    case "company":
      return t.askCompany;
    case "offer":
      return t.askOffer;
    case "voice":
      return t.askVoice;
    case "tools":
      return t.askTools;
    case "timeSinks":
      return t.askTimeSinks;
    case "review":
      return t.askReview;
    case "staff":
      return t.askStaff;
    case "connect":
      return t.askConnect;
    case "edition":
      return t.askEdition;
    case "workflow":
      return t.askWorkflow;
    default:
      return t.doneText;
  }
}

export function OnboardingDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly onClose: () => void;
}) {
  const t = useZenText(onboardingText);
  const call = useOnboardingCall(props.environmentId);
  const [companyId, setCompanyId] = useState(props.companyId);
  const [loaded, setLoaded] = useState<OnboardingGetResult | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the company's saved interview from the machine once per opened dialog (an RPC, then local edits).
  useEffect(() => {
    let cancelled = false;
    void call<OnboardingGetResult>("get", { companyId: props.companyId })
      .then((result) => {
        if (cancelled) return;
        setLoaded(result);
        // A finished or skipped interview opened again starts where the person wants to edit.
        const initial =
          result.state.status === "done" || result.state.status === "skipped"
            ? reopenInterview(
                result.state,
                result.state.status === "done" ? "company" : result.state.step,
                nowIso(),
              )
            : result.state;
        setState(initial);
      })
      .catch((cause: unknown) =>
        setError(onboardingErrorMessage(cause, zenText(onboardingText).prefillFailed)),
      );
    return () => {
      cancelled = true;
    };
  }, [call, props.companyId]);

  const persist = (next: OnboardingState) => {
    setState(next);
    void call("save", { companyId: next.companyId, state: next }).catch(() => undefined);
  };

  const later = () => {
    if (state !== null) persist(skipInterview(state, nowIso()));
    void call("dismissFirstRun", { companyId }).catch(() => undefined);
    props.onClose();
  };

  if (state === null) {
    return (
      <Dialog open onOpenChange={(open) => !open && props.onClose()}>
        <DialogPopup className="sm:max-w-2xl">
          {error ? (
            <p className="p-8 text-muted-foreground text-sm">{error}</p>
          ) : (
            <div className="flex flex-col gap-4 p-8" aria-label={t.saving}>
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
        </DialogPopup>
      </Dialog>
    );
  }

  const visited = ONBOARDING_STEPS.slice(0, ONBOARDING_STEPS.indexOf(state.step)).filter((step) =>
    stepAvailable(step, state.answers),
  );
  const percent = Math.round(onboardingProgress(state) * 100);

  return (
    <Dialog open onOpenChange={(open) => !open && later()}>
      <DialogPopup className="flex max-h-[92vh] flex-col sm:max-w-3xl" data-zen-onboarding>
        <header className="flex flex-col gap-2 border-b px-6 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-lg">{t.title}</h2>
              <p className="text-muted-foreground text-sm">{t.subtitle}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={later}>
              {t.later}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t.progress(percent)}
            </span>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-3">
            {visited.map((step) => {
              const said = answerSummary(step, state.answers, t);
              const skipped = state.skippedSteps.includes(step);
              return (
                <div key={step} className="flex flex-col gap-2">
                  <Bubble from="zen">{questionOf(step, t)}</Bubble>
                  {said !== null || skipped ? (
                    <Bubble from="you">{skipped && said === null ? t.skipped : said}</Bubble>
                  ) : null}
                </div>
              );
            })}
            <Bubble from="zen">{questionOf(state.step, t)}</Bubble>
            <div className="mt-1 rounded-2xl border bg-card p-4" data-onboarding-step={state.step}>
              <StepPanel
                environmentId={props.environmentId}
                companyId={companyId}
                loaded={loaded}
                state={state}
                t={t}
                call={call}
                onCompanyChange={(next) => {
                  setCompanyId(next);
                  // The new company has its own folders and memory: ask the machine again.
                  void call<OnboardingGetResult>("get", { companyId: next })
                    .then((result) => setLoaded(result))
                    .catch(() => undefined);
                }}
                persist={persist}
                onClose={props.onClose}
              />
            </div>
            <div
              key={state.step}
              ref={(node) => node?.scrollIntoView({ behavior: "smooth", block: "end" })}
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

interface StepProps {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly loaded: OnboardingGetResult | null;
  readonly state: OnboardingState;
  readonly t: T;
  readonly call: ReturnType<typeof useOnboardingCall>;
  readonly onCompanyChange: (companyId: string) => void;
  readonly persist: (state: OnboardingState) => void;
  readonly onClose: () => void;
}

function StepFooter(props: {
  readonly t: T;
  readonly state: OnboardingState;
  readonly persist: (state: OnboardingState) => void;
  readonly onNext: () => void;
  readonly nextLabel?: string;
  readonly busy?: boolean;
  readonly canSkip?: boolean;
}) {
  const { t, state } = props;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {state.step !== "who" ? (
        <Button size="sm" variant="ghost" onClick={() => props.persist(goBack(state, nowIso()))}>
          {t.back}
        </Button>
      ) : null}
      <div className="flex-1" />
      {props.canSkip !== false ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => props.persist(skipStep(state, state.step, nowIso()))}
        >
          {t.skipQuestion}
        </Button>
      ) : null}
      <Button size="sm" disabled={props.busy} onClick={props.onNext} data-onboarding-next>
        {props.busy ? <LoaderIcon className="animate-spin" /> : null}
        {props.nextLabel ?? t.continue}
      </Button>
    </div>
  );
}

function StepPanel(props: StepProps) {
  switch (props.state.step) {
    case "language":
      return <LanguageStep {...props} />;
    case "who":
      return <WhoStep {...props} />;
    case "company":
      return <CompanyStep {...props} />;
    case "offer":
    case "voice":
    case "tools":
    case "timeSinks":
      return <AnswerStep {...props} />;
    case "review":
      return <ReviewStep {...props} />;
    case "staff":
      return <StaffStep {...props} />;
    case "connect":
      return <ConnectStep {...props} />;
    case "edition":
      return <EditionStep {...props} />;
    case "workflow":
      return <WorkflowStep {...props} />;
    default:
      return <DoneStep {...props} />;
  }
}

function LanguageStep({ state, persist, t }: StepProps) {
  const pick = (language: "en" | "ro") => {
    setZenLocalePreference(language);
    persist(answerStep(state, "language", { language }, nowIso()));
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Chip selected={state.answers.language === "ro"} onClick={() => pick("ro")}>
        Română
      </Chip>
      <Chip selected={state.answers.language === "en"} onClick={() => pick("en")}>
        English
      </Chip>
      <span className="sr-only">{t.next}</span>
    </div>
  );
}

function WhoStep({ state, persist, t }: StepProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {(["freelancer", "small-team", "company"] as const).map((who) => (
          <Chip
            key={who}
            selected={state.answers.who === who}
            onClick={() => persist(answerStep(state, "who", { who }, nowIso()))}
          >
            {t.who[who]}
          </Chip>
        ))}
      </div>
      <StepFooter
        t={t}
        state={state}
        persist={persist}
        onNext={() => persist(skipStep(state, "who", nowIso()))}
      />
    </div>
  );
}

function PrefillNote({ prefill, t }: { readonly prefill: OnboardingPrefill; readonly t: T }) {
  return (
    <p
      className="flex items-center gap-1.5 text-muted-foreground text-xs"
      data-onboarding-prefill={prefill.source}
    >
      <SparklesIcon className="size-3.5 text-primary" />
      {t.prefilled(prefill.label)}
    </p>
  );
}

function CompanyStep(props: StepProps) {
  const { state, persist, t, call, environmentId } = props;
  const registry = useContext(RegistryContext);
  const create = useAtomCommand(companyCreate, { reportFailure: false });
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  const locale = useZenLocale();
  const [name, setName] = useState(state.answers.companyName ?? "");
  const [website, setWebsite] = useState(state.answers.website ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const latest = state.prefills.at(-1) ?? null;

  const withPrefill = (prefill: OnboardingPrefill, extra: OnboardingAnswers) => {
    const next = applyPrefill({ ...state, answers: { ...state.answers, ...extra } }, prefill);
    persist(next);
    if (prefill.fields.companyName && name.trim() === "") setName(prefill.fields.companyName);
  };

  const readSite = async () => {
    setBusy("website");
    setFailure(null);
    setNote(null);
    try {
      const result = await call<{
        prefill: OnboardingPrefill;
        usedModel: boolean;
        pages: ReadonlyArray<unknown>;
      }>("prefill.website", { url: website, locale });
      withPrefill(result.prefill, {
        website: website.trim(),
        ...(name.trim() ? { companyName: name.trim() } : {}),
      });
      setNote(
        `${t.pagesRead(result.pages.length)}${result.usedModel ? "" : ` · ${t.prefillBasic}`}`,
      );
    } catch (cause) {
      setFailure(`${t.prefillFailed}: ${onboardingErrorMessage(cause, "")}`);
    }
    setBusy(null);
  };

  const readDocument = async (file: File) => {
    setBusy(file.name);
    setFailure(null);
    try {
      const result = await call<{ prefill: OnboardingPrefill; usedModel: boolean }>(
        "prefill.document",
        {
          companyId: props.companyId,
          name: file.name,
          base64: await fileToBase64(file),
          locale,
        },
      );
      const next = applyPrefill(
        { ...state, documents: [...new Set([...state.documents, file.name])] },
        result.prefill,
      );
      persist(next);
      if (result.prefill.fields.companyName && name.trim() === "")
        setName(result.prefill.fields.companyName);
    } catch (cause) {
      setFailure(`${t.prefillFailed}: ${onboardingErrorMessage(cause, "")}`);
    }
    setBusy(null);
  };

  const next = async () => {
    const trimmed = name.trim();
    let current = state;
    // On first run in Personal, naming the company creates it and the interview moves there.
    if (props.companyId === ZEN_PERSONAL_COMPANY_ID && trimmed !== "") {
      setBusy("create");
      const created = await create({ environmentId, input: { name: trimmed } });
      setBusy(null);
      if (created._tag === "Failure") {
        const cause = squashAtomCommandFailure(created);
        setFailure(onboardingErrorMessage(cause, t.profileSaveFailed));
        return;
      }
      const company = created.value as ZenCompany;
      registry.refresh(companiesListAtom(environmentId));
      setSelected(company.id);
      props.onCompanyChange(company.id);
      current = { ...state, companyId: company.id };
      void call("dismissFirstRun", { companyId: company.id }).catch(() => undefined);
    }
    persist(
      answerStep(current, "company", { companyName: trimmed, website: website.trim() }, nowIso()),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.companyName}>
          <Input
            value={name}
            placeholder={t.companyNamePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t.website}>
          <Input
            value={website}
            placeholder={t.websitePlaceholder}
            onChange={(event) => setWebsite(event.target.value)}
            inputMode="url"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={website.trim() === "" || busy !== null}
          onClick={() => void readSite()}
          data-onboarding-read-website
        >
          {busy === "website" ? <LoaderIcon className="animate-spin" /> : <GlobeIcon />}
          {busy === "website" ? t.readingWebsite : t.readWebsite}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          {busy !== null && busy !== "website" && busy !== "create" ? (
            <LoaderIcon className="animate-spin" />
          ) : (
            <FileUpIcon />
          )}
          {busy !== null && busy !== "website" && busy !== "create"
            ? t.readingDocument(busy)
            : t.uploadDocs}
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.txt,.md,.csv,.html,.htm,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readDocument(file);
          }}
        />
        <span className="text-muted-foreground text-xs">{t.uploadHint}</span>
      </div>
      {latest ? <PrefillNote prefill={latest} t={t} /> : null}
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
      {state.documents.length > 0 ? (
        <p className="text-muted-foreground text-xs">{state.documents.join(", ")}</p>
      ) : null}
      {props.companyId === ZEN_PERSONAL_COMPANY_ID ? (
        <p className="text-muted-foreground text-xs">{t.newCompanyHint}</p>
      ) : null}
      {failure ? <p className="text-destructive-foreground text-sm">{failure}</p> : null}
      <StepFooter
        t={t}
        state={state}
        persist={persist}
        busy={busy === "create"}
        onNext={() => void next()}
      />
    </div>
  );
}

/** offer, voice, tools and timeSinks: fields bound to the answers (prefilled ones included). */
function AnswerStep({ state, persist, t }: StepProps) {
  const [draft, setDraft] = useState<OnboardingAnswers>(state.answers);
  const set = (patch: OnboardingAnswers) => setDraft((current) => ({ ...current, ...patch }));
  const next = () => persist(answerStep(state, state.step, draft, nowIso()));
  const fromPrefill = state.prefills.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {state.step === "offer" ? (
        <>
          <Field label={t.sells}>
            <Textarea
              rows={3}
              value={draft.sells ?? ""}
              placeholder={t.sellsPlaceholder}
              onChange={(event) => set({ sells: event.target.value })}
            />
          </Field>
          <Field label={t.customers}>
            <Textarea
              rows={2}
              value={draft.customers ?? ""}
              placeholder={t.customersPlaceholder}
              onChange={(event) => set({ customers: event.target.value })}
            />
          </Field>
          <Field label={t.prices}>
            <Textarea
              rows={4}
              value={draft.prices ?? ""}
              placeholder={t.pricesPlaceholder}
              onChange={(event) => set({ prices: event.target.value })}
            />
          </Field>
          {fromPrefill ? <PrefillNote prefill={fromPrefill} t={t} /> : null}
        </>
      ) : null}
      {state.step === "voice" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {ONBOARDING_TONES.map((tone) => (
              <Chip
                key={tone}
                selected={(draft.tones ?? []).includes(tone)}
                onClick={() => set({ tones: toggle(draft.tones, tone, 4) })}
              >
                {t.tones[tone]}
              </Chip>
            ))}
          </div>
          <Field label={t.toneNotes}>
            <Input
              value={draft.toneNotes ?? ""}
              placeholder={t.toneNotesPlaceholder}
              onChange={(event) => set({ toneNotes: event.target.value })}
            />
          </Field>
          <Field label={t.competitors}>
            <Input
              value={draft.competitors ?? ""}
              placeholder={t.competitorsPlaceholder}
              onChange={(event) => set({ competitors: event.target.value })}
            />
          </Field>
        </>
      ) : null}
      {state.step === "tools" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {ONBOARDING_TOOLS.map((tool) => (
              <Chip
                key={tool.id}
                selected={(draft.tools ?? []).includes(tool.id)}
                onClick={() => set({ tools: toggle(draft.tools, tool.id) })}
              >
                {toolLabel(tool.id)}
              </Chip>
            ))}
          </div>
          <Field label={t.toolsOther}>
            <Input
              value={draft.toolsOther ?? ""}
              placeholder={t.toolsOtherPlaceholder}
              onChange={(event) => set({ toolsOther: event.target.value })}
            />
          </Field>
        </>
      ) : null}
      {state.step === "timeSinks" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {ONBOARDING_TIME_SINKS.map((sink) => (
              <Chip
                key={sink}
                selected={(draft.timeSinks ?? []).includes(sink)}
                onClick={() => set({ timeSinks: toggle(draft.timeSinks, sink) })}
              >
                {t.timeSinks[sink]}
              </Chip>
            ))}
          </div>
          <Field label={t.timeSinksOther}>
            <Input
              value={draft.timeSinksOther ?? ""}
              onChange={(event) => set({ timeSinksOther: event.target.value })}
            />
          </Field>
        </>
      ) : null}
      <StepFooter t={t} state={state} persist={persist} onNext={next} />
    </div>
  );
}

function ReviewStep(props: StepProps) {
  const { state, persist, t, call, loaded } = props;
  const locale = useZenLocale();
  const [toMemory, setToMemory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const profile = buildCompanyProfile(state.answers, locale, nowIso().slice(0, 10));
  const target = loaded?.memoryConnected
    ? t.memoryHosted
    : loaded?.localMemory
      ? t.memoryLocal
      : t.memoryFile;
  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await call<{ path: string; memory: OnboardingState["memory"] }>(
        "profile.save",
        {
          companyId: props.companyId,
          answers: state.answers,
          locale,
          toMemory,
        },
      );
      persist(
        answerStep(
          { ...state, profileSavedAt: nowIso(), memory: result.memory },
          "review",
          {},
          nowIso(),
        ),
      );
    } catch (cause) {
      setFailure(`${t.profileSaveFailed}: ${onboardingErrorMessage(cause, "")}`);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-sm">{t.previewTitle}</p>
      <pre
        className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 font-sans text-sm leading-relaxed"
        data-onboarding-preview
      >
        {profile.markdown}
      </pre>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={toMemory} onCheckedChange={setToMemory} />
        {t.saveToMemory}
      </label>
      <p className="text-muted-foreground text-xs">{toMemory ? target : t.memoryFile}</p>
      {failure ? <p className="text-destructive-foreground text-sm">{failure}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => persist({ ...state, step: "offer", updatedAt: nowIso() })}
        >
          {t.editAnswers}
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => persist(skipStep(state, "review", nowIso()))}
        >
          {t.skipQuestion}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void save()} data-onboarding-save-profile>
          {busy ? <LoaderIcon className="animate-spin" /> : <CheckIcon />}
          {t.saveProfile}
        </Button>
      </div>
    </div>
  );
}

/** The company's folders; a new company gets one in its own folder (for the first task). */
function useCompanyProject(environmentId: EnvironmentId, companyId: string) {
  const index = useCompanyIndex();
  const isInternal = useIsInternalFolder();
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId &&
      project.archivedAt == null &&
      !isInternal(project) &&
      companyOfProject(index, environmentId, project.id) === companyId,
  );
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const assign = useAtomCommand(companyAssignProject, { reportFailure: false });
  const registry = useContext(RegistryContext);
  const ensure = async (workFolder: string | null, title: string) => {
    if (projects[0]) return projects[0];
    if (workFolder === null) return null;
    const existing = findProjectByPath(
      readProjects().filter((project) => project.environmentId === environmentId),
      workFolder,
    );
    let project = existing;
    if (!project) {
      const projectId = newProjectId();
      const created = await createProject({
        environmentId,
        input: {
          projectId,
          title,
          workspaceRoot: workFolder,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      });
      if (created._tag === "Failure") return null;
      project = await waitForProject(scopeProjectRef(environmentId, projectId));
    }
    if (companyId !== ZEN_PERSONAL_COMPANY_ID) {
      await assign({ environmentId, input: { projectId: project.id, companyId } });
      registry.refresh(companiesListAtom(environmentId));
    }
    return project;
  };
  return { projects, ensure };
}

function StaffStep(props: StepProps) {
  const { state, persist, t, environmentId, companyId } = props;
  const locale = useZenLocale();
  const catalog = useStaffCatalog<{ roles: ReadonlyArray<StaffRoleTemplate> }>(environmentId);
  const overview = useStaffOverview(environmentId, companyId, locale).data as StaffOverview | null;
  const staffCall = useStaffCall(environmentId, companyId);
  const defaultsFor = useStaffDefaults(environmentId);
  const { projects } = useCompanyProject(environmentId, companyId);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const roles = suggestStaffRoles(state.answers)
    .map((id) => catalog?.roles.find((role) => role.id === id))
    .filter((role): role is StaffRoleTemplate => role !== undefined);
  const hire = async (role: StaffRoleTemplate) => {
    setBusy(role.id);
    const project = projects[0] ?? null;
    const placementOk =
      overview?.companyPlacement.ok === true && companyId !== ZEN_PERSONAL_COMPANY_ID;
    const kind = role.suggestedKind === "company" && placementOk ? "company" : "personal";
    try {
      await staffCall("agent.hire", {
        templateId: role.id,
        kind,
        name: role.name[locale],
        managerId: overview?.humans[0]?.id ?? null,
        projectId: project?.id ?? null,
        defaults: defaultsFor(project),
      });
      persist({ ...state, hired: [...new Set([...state.hired, role.id])], updatedAt: nowIso() });
      if (kind !== role.suggestedKind)
        setMessages((current) => ({ ...current, [role.id]: t.hiredAsPersonal }));
    } catch (cause) {
      setMessages((current) => ({
        ...current,
        [role.id]: `${t.hireFailed}: ${onboardingErrorMessage(cause, "")}`,
      }));
    }
    setBusy(null);
  };
  return (
    <div className="flex flex-col gap-3">
      {catalog === null ? <SkeletonCards count={4} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((role) => {
          const hired = state.hired.includes(role.id);
          return (
            <div
              key={role.id}
              className="flex flex-col gap-2 rounded-xl border p-3"
              data-onboarding-role={role.id}
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-white text-xs"
                  style={{ backgroundColor: role.color }}
                >
                  <BriefcaseIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{role.name[locale]}</p>
                  <p className="truncate text-muted-foreground text-xs">{role.role[locale]}</p>
                </div>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {role.summary[locale]}
              </p>
              {messages[role.id] ? (
                <p className="text-muted-foreground text-xs">{messages[role.id]}</p>
              ) : null}
              <Button
                size="sm"
                variant={hired ? "secondary" : "outline"}
                disabled={hired || busy !== null}
                onClick={() => void hire(role)}
              >
                {busy === role.id ? (
                  <LoaderIcon className="animate-spin" />
                ) : hired ? (
                  <CheckIcon />
                ) : (
                  <UserPlusIcon />
                )}
                {busy === role.id ? t.hiring : hired ? t.hired : t.hire}
              </Button>
            </div>
          );
        })}
      </div>
      {state.hired.length > 0 ? (
        <Button
          size="sm"
          variant="link"
          className="self-start"
          onClick={() =>
            void navigate({ to: "/staff", search: { tab: "team", company: companyId } as never })
          }
        >
          {t.openStaff}
        </Button>
      ) : null}
      <StepFooter
        t={t}
        state={state}
        persist={persist}
        onNext={() => persist(answerStep(state, "staff", {}, nowIso()))}
      />
    </div>
  );
}

function ConnectStep(props: StepProps) {
  const { state, persist, t, environmentId, companyId } = props;
  const registry = useContext(RegistryContext);
  const { call } = useConnectorsCall();
  const threadId = `zen-onboarding-${companyId}`;
  const cardsAtom = connectorsCardsAtom(environmentId, threadId);
  const cards = (AsyncResult.getOrElse(useAtomValue(cardsAtom), () => null) ??
    []) as ReadonlyArray<CardData>;
  const catalog = AsyncResult.getOrElse(
    useAtomValue(connectorsCatalogAtom(environmentId)),
    () => null,
  ) as {
    readonly entries: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  } | null;
  const suggested = suggestConnectors(state.answers);
  const open = async (appId: string) => {
    try {
      await call("requests.create", { threadId, appId, source: "chat" });
      registry.refresh(cardsAtom);
      persist({
        ...state,
        connectorsOpened: [...new Set([...state.connectorsOpened, appId])],
        updatedAt: nowIso(),
      });
    } catch {
      // The card shows its own errors.
    }
  };
  const openCards = cards.filter(
    (card) => card.request.state === "open" || card.request.state === "connected",
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {suggested.map((appId) => {
          const name = catalog?.entries.find((entry) => entry.id === appId)?.name ?? appId;
          const opened = state.connectorsOpened.includes(appId);
          return (
            <Button
              key={appId}
              size="sm"
              variant={opened ? "secondary" : "outline"}
              onClick={() => void open(appId)}
              data-onboarding-connect={appId}
            >
              <PlugIcon />
              {t.connect} {name}
              {opened ? ` · ${t.connectOpened}` : ""}
            </Button>
          );
        })}
      </div>
      {openCards.length > 0 && catalog ? (
        <div className="flex flex-col gap-2">
          {openCards.map((card) => (
            <ConnectCard
              key={card.request.id}
              environmentId={environmentId}
              data={card}
              entries={catalog.entries as never}
              call={call}
              onChanged={() => registry.refresh(cardsAtom)}
            />
          ))}
        </div>
      ) : null}
      <StepFooter
        t={t}
        state={state}
        persist={persist}
        onNext={() => persist(answerStep(state, "connect", {}, nowIso()))}
      />
    </div>
  );
}

function EditionStep({ state, persist, t }: StepProps) {
  const pick = (edition: "office" | "code") => {
    switchZenEdition(edition);
    persist(answerStep(state, "edition", { edition }, nowIso()));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(["office", "code"] as const).map((edition) => (
          <button
            key={edition}
            type="button"
            onClick={() => pick(edition)}
            aria-pressed={state.answers.edition === edition}
            className={cn(
              "flex flex-col items-start gap-1 rounded-xl border p-4 text-start transition-colors hover:bg-accent/50",
              state.answers.edition === edition && "border-primary bg-primary/5",
            )}
            data-onboarding-edition={edition}
          >
            <span className="font-medium">
              {edition === "office" ? t.editionOffice : t.editionCode}
            </span>
            <span className="text-muted-foreground text-xs">
              {edition === "office" ? t.editionOfficeHint : t.editionCodeHint}
            </span>
          </button>
        ))}
      </div>
      <StepFooter
        t={t}
        state={state}
        persist={persist}
        onNext={() => persist(skipStep(state, "edition", nowIso()))}
        canSkip={false}
        nextLabel={t.skipQuestion}
      />
    </div>
  );
}

function WorkflowStep(props: StepProps) {
  const { state, persist, t, environmentId, companyId, loaded } = props;
  const locale = useZenLocale();
  const navigate = useNavigate();
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  const { ensure } = useCompanyProject(environmentId, companyId);
  const [busy, setBusy] = useState(false);
  const suggestion = suggestFirstWorkflow(state.answers, locale);
  const workflows = AsyncResult.getOrElse(
    useAtomValue(officeWorkflows({ environmentId, input: workflowsInput(null) })),
    () => null,
  );
  const workflow = workflows?.workflows.find((item) => item.manifest.id === suggestion.workflowId);
  const manifest = workflow ? localizeWorkflowManifest(workflow.manifest, locale) : null;
  const finish = (next: OnboardingState) => {
    persist({ ...next, status: "done", step: "done", updatedAt: nowIso() });
  };
  const tryIt = async () => {
    setBusy(true);
    const project = await ensure(
      loaded?.workFolder ?? null,
      state.answers.companyName || manifest?.name || "Zen",
    );
    setBusy(false);
    if (companyId !== ZEN_PERSONAL_COMPANY_ID) setSelected(companyId);
    if (project) {
      try {
        globalThis.localStorage?.setItem(OFFICE_PROJECT_KEY, `${environmentId}:${project.id}`);
      } catch {
        // The Office home falls back to the first folder.
      }
    }
    setOfficePrefill({ workflowId: suggestion.workflowId, values: suggestion.values });
    if (state.answers.edition !== "code") switchZenEdition("office");
    finish(answerStep(state, "workflow", {}, nowIso()));
    props.onClose();
    void navigate({ to: "/office" });
  };
  return (
    <div className="flex flex-col gap-3">
      {manifest ? (
        <div className="rounded-xl border p-3" data-onboarding-workflow={manifest.id}>
          <p className="font-medium text-sm">{manifest.name}</p>
          <p className="text-muted-foreground text-xs">{manifest.description}</p>
          <dl className="mt-2 grid gap-1 text-xs">
            {manifest.inputs
              .filter((input) => suggestion.values[input.id])
              .map((input) => (
                <div key={input.id} className="flex gap-2">
                  <dt className="shrink-0 text-muted-foreground">{input.label}:</dt>
                  <dd className="min-w-0 truncate">{suggestion.values[input.id]}</dd>
                </div>
              ))}
          </dl>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => persist(goBack(state, nowIso()))}>
          {t.back}
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => finish(skipStep(state, "workflow", nowIso()))}
        >
          {t.finish}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void tryIt()} data-onboarding-try-workflow>
          {busy ? <LoaderIcon className="animate-spin" /> : <SparklesIcon />}
          {manifest ? t.tryWorkflow : t.workflowFallback}
        </Button>
      </div>
    </div>
  );
}

function DoneStep({ t, onClose }: StepProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="font-medium">{t.doneTitle}</p>
      <Button size="sm" onClick={onClose}>
        {t.close}
      </Button>
    </div>
  );
}
