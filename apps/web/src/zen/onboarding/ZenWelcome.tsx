// Zen Staff first run (/welcome): edition, who the work is for (me / clients / invited), the
// company, the AI account, the trust model (sets runtime mode "auto"), then the company folder,
// two AI colleagues and a first task. Code continues in upstream's Welcome page. ZEN.md, "First run".
import { RegistryContext } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { ZEN_CLI_NAME, ZEN_DOWNLOADS, ZEN_PRODUCT_URL } from "@t3tools/contracts/zen";
import {
  ONBOARDING_TIME_SINKS,
  ZEN_PERSONAL_COMPANY_ID,
  initialOnboarding,
  type OnboardingAnswers,
  type OnboardingTimeSink,
} from "@t3tools/contracts/zenCompanies";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  Building2Icon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CodeIcon,
  LinkIcon,
  LoaderIcon,
  MailOpenIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import { type ComponentProps, useContext, useState } from "react";

import { CommandBlock } from "../../components/CommandBlock";
import { ZenMarkTile } from "../../components/T3Wordmark";
import { NoProjectsHero } from "../../components/NoProjectsHero";
import { WelcomePage } from "../../components/onboarding/WelcomePage";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Dialog } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "../../components/ui/wizard";
import { connectPairing } from "../../connection/onboarding";
import { useUpdatePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { completeOnboarding } from "../../onboarding/firstRun";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { AiAccountList } from "../aiAccount/AiAccountPanel";
import { AiConnectPanel } from "../aiConnect/AiConnectPanel";
import { clientsText } from "../clients/clients.i18n";
import { FirstClientForm, type SavedClient } from "../clients/FirstClientForm";
import { useZenWorkMode } from "../clients/workMode";
import { rememberOfficeFolder, useEnsureCompanyFolder } from "../companies/companyFolder";
import {
  companiesListAtom,
  companyCreate,
  useSelectedCompanyStore,
} from "../companies/companiesState";
import { zenErrorMessage } from "../i18n/serverText";
import {
  ZEN_LOCALE_NAMES,
  setZenLocalePreference,
  useZenLocale,
  useZenText,
} from "../i18n/zenI18n";
import { setOfficePrefill } from "../office/officePrefill";
import { switchZenEdition } from "../office/officeState";
import { TelemetryChoice } from "../telemetry/TelemetryChoice";
import { FirstSteps } from "./FirstSteps";
import { InviteJoin } from "./InviteJoin";
import { onboardingText } from "./onboarding.i18n";
import { useOnboardingCall, useOnboardingDialog } from "./onboardingClient";
import { trustText } from "./trust.i18n";
import { ZenTrustModel } from "./TrustModel";
import { welcomeText } from "./welcome.i18n";

type WelcomeProps = ComponentProps<typeof WelcomePage> & {
  /** A ChatGPT sign-in that returns to upstream's agents section (#agents:<id>). */
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
};
type Step = "welcome" | "company" | "account" | "trust" | "start";
type Who = "self" | "clients" | "invited";

const STEPS: ReadonlyArray<Step> = ["welcome", "company", "account", "trust", "start"];
const MAX_SINKS = 3;
/** The fixed download links, named by system (the same names in every language). */
const DOWNLOAD_LINKS = [
  { href: ZEN_DOWNLOADS.windows, label: "Windows" },
  { href: ZEN_DOWNLOADS.linuxAppImage, label: "Linux (AppImage)" },
  { href: ZEN_DOWNLOADS.linuxDeb, label: "Linux (.deb)" },
] as const;

export function ZenWelcome({ resumeEnvironmentId, ...props }: WelcomeProps) {
  // Resuming upstream's agents section (#agents:<id>) or a choice of Code: upstream's page as is.
  const [chosen, setChosen] = useState<"office" | "code" | null>(
    resumeEnvironmentId ? "code" : null,
  );
  if (chosen === "code") return <WelcomePage {...props} />;
  return (
    <>
      <NoProjectsHero />
      <OfficeWelcome
        // Office first: the first run of a new install suggests Office; Code is one click away.
        initialEdition="office"
        onChooseCode={() => {
          switchZenEdition("code");
          setChosen("code");
        }}
        onDone={props.onDone}
      />
    </>
  );
}

function OfficeWelcome(props: {
  readonly initialEdition: "office" | "code";
  readonly onChooseCode: () => void;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const t = useZenText(welcomeText);
  const tt = useZenText(trustText);
  const tc = useZenText(clientsText);
  const sinkNames = useZenText(onboardingText).timeSinks;
  const locale = useZenLocale();
  const environmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const createCompany = useAtomCommand(companyCreate, { reportFailure: false });
  const updateSettings = useUpdatePrimarySettings();
  const ensureFolder = useEnsureCompanyFolder(environmentId);
  const interview = useOnboardingDialog();
  const [step, setStep] = useState<Step>("welcome");
  const [edition, setEdition] = useState<"office" | "code">(props.initialEdition);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workMode = useZenWorkMode();
  const onboarding = useOnboardingCall(environmentId);
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  const [who, setWho] = useState<Who | null>(null);
  // "Pentru mine / firma mea": the name and what takes the most time (for the two colleagues).
  const [companyName, setCompanyName] = useState("");
  const [sinks, setSinks] = useState<ReadonlyArray<OnboardingTimeSink>>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  // Freelancer path: the client form, then the clients added so far.
  const [clients, setClients] = useState<ReadonlyArray<SavedClient>>([]);
  const [addingClient, setAddingClient] = useState(true);
  // "Spune-mi despre client": that client's interview chat opens once the setup closes.
  const [interviewAfter, setInterviewAfter] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [folder, setFolder] = useState<EnvironmentProject | null>(null);
  const index = STEPS.indexOf(step);
  const answers: OnboardingAnswers = {
    ...(who === "clients" ? { who: "freelancer" as const } : {}),
    ...(companyName.trim() !== "" ? { companyName: companyName.trim() } : {}),
    ...(who === "clients" && clients[0] ? { companyName: clients[0].name } : {}),
    ...(sinks.length > 0 ? { timeSinks: sinks } : {}),
  };

  const fail = (message: string) => {
    setError(message);
    setBusy(false);
  };

  // Lands on the Office home. Promise chains instead of try/finally so the React Compiler can
  // optimise this component.
  const finish = () => {
    setBusy(true);
    setError(null);
    // The first run is done; the company's interview no longer pops up on its own (it waits in
    // Companies > Profilul companiei), except for a client the person asked to describe in a chat.
    const dismiss = onboarding(
      "dismissFirstRun",
      companyId === null || interviewAfter ? {} : { companyId },
    ).catch(() => undefined);
    return dismiss
      .then(() => completeOnboarding())
      .then(() => props.onDone())
      .then(() => setBusy(false))
      .catch(() => fail(t.finishFailed));
  };

  const chooseWho = (value: Who) => {
    setWho(value);
    setError(null);
    if (value !== "invited") workMode.setMode(value);
    if (value === "clients") setAddingClient(true);
  };

  // "Pentru mine / firma mea": the company is created right away, with the answers given so far
  // (the full interview can be opened later and starts from them).
  const saveCompany = async () => {
    if (environmentId === null || companyName.trim() === "") return;
    if (companyId !== null) {
      setStep("account");
      return;
    }
    setBusy(true);
    setError(null);
    const created = await createCompany({
      environmentId,
      input: { name: companyName.trim() },
    });
    if (created._tag === "Failure") {
      fail(zenErrorMessage(created.cause, t.companyFailed));
      return;
    }
    registry.refresh(companiesListAtom(environmentId));
    const id = created.value.id;
    const now = new Date().toISOString();
    await onboarding("save", {
      companyId: id,
      state: {
        ...initialOnboarding(id, now),
        step: "who",
        answers: { ...answers, language: locale },
      },
    }).catch(() => undefined);
    setCompanyId(id);
    setSelected(id);
    setBusy(false);
    setStep("account");
  };

  // "Am înțeles": agents work in "Automat" (auto: safe actions alone, risky ones checked), never
  // full access by default; then the company folder, so the first task just works.
  const acceptTrust = async () => {
    setBusy(true);
    setError(null);
    updateSettings({ defaultRuntimeMode: "auto" });
    if (who === "invited" || interviewAfter) {
      await finish();
      if (interviewAfter && companyId !== null) interview.open(companyId, "new-company");
      return;
    }
    const target = companyId ?? ZEN_PERSONAL_COMPANY_ID;
    const made = await ensureFolder(target).catch(() => null);
    setFolder(made);
    if (made === null) setError(tt.folderFailed);
    else rememberOfficeFolder(made);
    setBusy(false);
    setStep("start");
  };

  const startTask = (task: {
    readonly workflowId: string;
    readonly values: Readonly<Record<string, string>>;
  }) => {
    // The Office home opens this workflow's chat once, with these answers (sessionStorage).
    setOfficePrefill({ workflowId: task.workflowId, values: task.values });
    void finish();
  };

  const stepTitles = [t.stepWelcome, t.stepCompany, t.stepAccount, t.stepTrust, t.stepStart];
  const companyReady =
    who === "self"
      ? companyName.trim() !== ""
      : who === "clients"
        ? clients.length > 0
        : who === "invited"
          ? joined !== null
          : false;

  return (
    <Dialog open disablePointerDismissal>
      <WizardPopup size="wide" bottomStickOnMobile={false} showCloseButton={false}>
        <WizardHeader
          title={
            <span className="flex items-center gap-2.5">
              <ZenMarkTile className="size-7 shrink-0" aria-hidden />
              {t.setupTitle}
            </span>
          }
        >
          <WizardSteps
            steps={stepTitles}
            currentStep={index}
            isStepDisabled={(target) => target >= index || busy}
            onStepChange={(target) => {
              const next = STEPS[target];
              if (target < index && next !== undefined) setStep(next);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          {step === "welcome" ? (
            <div className="flex flex-col gap-5" data-zen-welcome="welcome">
              <div>
                <h1 className="font-semibold text-2xl tracking-tight">{t.welcomeTitle}</h1>
                <p className="mt-2 text-muted-foreground text-sm">{t.welcomeIntro}</p>
              </div>
              <LanguageChoice />
              <div className="flex flex-col gap-2">
                <span className="font-medium text-sm">{t.edition}</span>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t.edition}>
                  <EditionOption
                    selected={edition === "office"}
                    onSelect={() => setEdition("office")}
                    icon={<BriefcaseIcon className="size-5" aria-hidden />}
                    title={t.officeTitle}
                    body={t.officeBody}
                    value="office"
                  />
                  <EditionOption
                    selected={edition === "code"}
                    onSelect={() => setEdition("code")}
                    icon={<CodeIcon className="size-5" aria-hidden />}
                    title={t.codeTitle}
                    body={t.codeBody}
                    value="code"
                  />
                </div>
              </div>
              {/* Anonymous statistics: an explicit choice; nothing is sent before it. */}
              <TelemetryChoice environmentId={environmentId} asQuestion />
              <AdvancedPairing />
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    if (edition === "code") {
                      props.onChooseCode();
                      return;
                    }
                    switchZenEdition("office");
                    setStep("company");
                  }}
                  data-zen-welcome-continue
                >
                  {t.continue}
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : step === "company" && who === "clients" && addingClient && environmentId !== null ? (
            <FirstClientForm
              environmentId={environmentId}
              first={clients.length === 0}
              onBack={() => (clients.length === 0 ? setWho(null) : setAddingClient(false))}
              onSaved={(client) => {
                setClients((current) => [...current, client]);
                setCompanyId((current) => current ?? client.id);
                setSelected(client.id);
                setAddingClient(false);
              }}
              onTellMe={(client) => {
                setClients((current) => [...current, client]);
                setCompanyId(client.id);
                setSelected(client.id);
                setInterviewAfter(true);
                setAddingClient(false);
                setStep("account");
              }}
            />
          ) : step === "company" && who === "invited" && environmentId !== null && !joined ? (
            <div className="flex flex-col gap-4">
              <InviteJoin
                environmentId={environmentId}
                onJoined={(company) => {
                  setJoined(company.name);
                  setStep("account");
                }}
              />
              <div className="flex justify-start">
                <Button variant="ghost" onClick={() => setWho(null)}>
                  {t.back}
                </Button>
              </div>
            </div>
          ) : step === "company" ? (
            <div className="flex flex-col gap-4" data-zen-welcome="company">
              <div>
                <h1 className="font-semibold text-2xl tracking-tight">{tc.whoTitle}</h1>
                <p className="mt-2 text-muted-foreground text-sm">{tc.whoIntro}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={tc.whoTitle}>
                <EditionOption
                  selected={who === "self"}
                  onSelect={() => chooseWho("self")}
                  icon={<Building2Icon className="size-5" aria-hidden />}
                  title={tc.forMe}
                  body={tc.forMeBody}
                  value="self"
                />
                <EditionOption
                  selected={who === "clients"}
                  onSelect={() => chooseWho("clients")}
                  icon={<UsersIcon className="size-5" aria-hidden />}
                  title={tc.forClients}
                  body={tc.forClientsBody}
                  value="clients"
                />
                <EditionOption
                  selected={who === "invited"}
                  onSelect={() => chooseWho("invited")}
                  icon={<MailOpenIcon className="size-5" aria-hidden />}
                  title={t.invitedTitle}
                  body={t.invitedBody}
                  value="invited"
                />
              </div>
              {who === "self" ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveCompany();
                  }}
                  id="zen-welcome-company"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="zen-welcome-company-name">{t.companyNameLabel}</Label>
                    <Input
                      id="zen-welcome-company-name"
                      value={companyName}
                      placeholder={t.companyNamePlaceholder}
                      maxLength={80}
                      disabled={companyId !== null}
                      onChange={(event) => setCompanyName(event.target.value)}
                      data-zen-welcome-company-name
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium text-sm">{t.sinksLabel}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {ONBOARDING_TIME_SINKS.map((sink) => {
                        const on = sinks.includes(sink);
                        return (
                          <button
                            key={sink}
                            type="button"
                            aria-pressed={on}
                            disabled={!on && sinks.length >= MAX_SINKS}
                            onClick={() =>
                              setSinks((current) =>
                                on ? current.filter((item) => item !== sink) : [...current, sink],
                              )
                            }
                            className={cn(
                              "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent/50 disabled:opacity-50",
                              on && "border-primary bg-primary/10 text-foreground",
                            )}
                            data-zen-welcome-sink={sink}
                          >
                            {sinkNames[sink]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </form>
              ) : null}
              {who === "clients" && clients.length > 0 ? (
                <div className="flex flex-col gap-2" data-zen-welcome="clients">
                  <ul className="flex flex-col gap-2">
                    {clients.map((client) => (
                      <li
                        key={client.id}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <CheckCircle2Icon className="size-4 text-success-foreground" aria-hidden />
                        {tc.saved(client.name)}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="outline"
                    className="self-start"
                    onClick={() => setAddingClient(true)}
                    data-zen-welcome-add-client
                  >
                    <PlusIcon className="size-3.5" />
                    {tc.addAnother}
                  </Button>
                </div>
              ) : null}
              {error !== null ? (
                <Alert variant="error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("welcome")}>
                  {t.back}
                </Button>
                <Button
                  disabled={busy || !companyReady}
                  onClick={() => {
                    if (who === "self") void saveCompany();
                    else setStep("account");
                  }}
                  data-zen-welcome-company-continue
                >
                  {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
                  {t.continue}
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : step === "account" ? (
            <div className="flex flex-col gap-4" data-zen-welcome="account">
              <div>
                <h1 className="font-semibold text-2xl tracking-tight">{t.accountTitle}</h1>
                <p className="mt-2 text-muted-foreground text-sm">{t.accountIntro}</p>
              </div>
              {/* "Conectează-ți AI-ul": Claude, ChatGPT, Google, without a terminal (wave/ai-connect). */}
              <div className="flex flex-col gap-2" data-zen-welcome-ai-slot>
                <AiConnectPanel environmentId={environmentId} />
                <AiAccountList environmentId={environmentId} othersOnly />
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("company")}>
                  {t.back}
                </Button>
                <Button onClick={() => setStep("trust")} data-zen-welcome-continue>
                  {t.continue}
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : step === "trust" ? (
            <div className="flex flex-col gap-4" data-zen-welcome="trust">
              <div>
                <h1 className="font-semibold text-2xl tracking-tight">{tt.title}</h1>
                <p className="mt-2 text-muted-foreground text-sm">{tt.intro}</p>
              </div>
              <ZenTrustModel />
              {error !== null ? (
                <Alert variant="error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-between">
                <Button variant="ghost" disabled={busy} onClick={() => setStep("account")}>
                  {t.back}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void acceptTrust()}
                  data-zen-welcome-trust-continue
                >
                  {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
                  {busy ? tt.preparing : tt.understood}
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : environmentId !== null ? (
            <div className="flex flex-col gap-3">
              <FirstSteps
                environmentId={environmentId}
                companyId={companyId ?? ZEN_PERSONAL_COMPANY_ID}
                answers={answers}
                folder={folder}
                busy={busy}
                onStart={startTask}
                onLater={() => void finish()}
                onInterview={
                  companyId === null
                    ? null
                    : () => {
                        void finish().then(() => interview.open(companyId, "settings"));
                      }
                }
              />
              {error !== null ? (
                <Alert variant="error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </WizardPanel>
      </WizardPopup>
    </Dialog>
  );
}

function LanguageChoice() {
  const t = useZenText(welcomeText);
  const locale = useZenLocale();
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-sm">{t.language}</span>
      <ToggleGroup
        value={[locale]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "ro" || next === "en") setZenLocalePreference(next);
        }}
        aria-label={t.language}
        data-zen-no-translate
      >
        <ToggleGroupItem value="ro">{ZEN_LOCALE_NAMES.ro}</ToggleGroupItem>
        <ToggleGroupItem value="en">{ZEN_LOCALE_NAMES.en}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function EditionOption(props: {
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
  readonly value: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      onClick={props.onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-accent/50",
        props.selected && "border-primary ring-1 ring-primary",
      )}
      data-zen-welcome-edition={props.value}
      data-zen-no-translate
    >
      <span className="flex items-center gap-2 font-medium">
        {props.icon}
        {props.title}
      </span>
      <span className="text-muted-foreground text-sm">{props.body}</span>
    </button>
  );
}

/** Pairing, for people who run Zen on a server or several computers. */
function AdvancedPairing() {
  const t = useZenText(welcomeText);
  return (
    <Collapsible>
      <CollapsibleTrigger
        type="button"
        className="group flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        data-zen-welcome-advanced
      >
        <ChevronRightIcon className="size-3.5 group-data-panel-open:rotate-90" aria-hidden />
        {t.advanced}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ZenPairingForm />
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ZenPairingForm() {
  const t = useZenText(welcomeText);
  const connect = useAtomCommand(connectPairing, { reportFailure: false });
  const [link, setLink] = useState("");
  const [state, setState] = useState<
    | { readonly kind: "idle" | "pairing" }
    | { readonly kind: "paired"; readonly environmentId: EnvironmentId }
    | { readonly kind: "failed"; readonly message: string }
  >({ kind: "idle" });
  const empty = link.trim().length === 0;
  const submit = async () => {
    if (empty || state.kind === "pairing") return;
    setState({ kind: "pairing" });
    const result = await connect({ pairingUrl: link.trim() });
    if (result._tag === "Success") {
      setState({ kind: "paired", environmentId: result.value });
      setLink("");
      return;
    }
    if (isAtomCommandInterrupted(result)) {
      setState({ kind: "idle" });
      return;
    }
    const cause = squashAtomCommandFailure(result);
    setState({
      kind: "failed",
      message: cause instanceof Error && cause.message ? cause.message : t.pairFailed,
    });
  };
  return (
    <form
      className="mt-2 flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      data-zen-pairing
    >
      <span className="flex items-center gap-2 font-medium text-sm">
        <LinkIcon className="size-4 text-muted-foreground" aria-hidden />
        {t.pairTitle}
      </span>
      <div className="flex gap-2">
        <Input
          aria-label={t.pairLink}
          placeholder={t.pairPlaceholder}
          value={link}
          onChange={(event) => setLink(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" disabled={empty || state.kind === "pairing"} data-zen-pair-submit>
          {state.kind === "pairing" ? t.pairing : t.pair}
        </Button>
      </div>
      {state.kind === "failed" ? (
        <Alert variant="error">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.kind === "paired" ? <p className="text-sm">{t.pairPaired}</p> : null}
      <div className="flex flex-col gap-2 text-muted-foreground text-sm">
        <p>{t.pairStep1}</p>
        <CommandBlock command={`${ZEN_CLI_NAME} pair`} />
        <p>{t.pairStep2}</p>
        <p>{t.pairTailscale}</p>
        <CommandBlock command={`${ZEN_CLI_NAME} pair --tailscale`} />
        <p>
          {t.pairNoCli}{" "}
          <a
            href={ZEN_PRODUCT_URL}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline"
          >
            {t.pairDownloadPage}
          </a>
          {DOWNLOAD_LINKS.map((download) => (
            <span key={download.href}>
              {" · "}
              <a href={download.href} className="text-foreground underline">
                {download.label}
              </a>
            </span>
          ))}
        </p>
      </div>
    </form>
  );
}
