// Zen Staff AI staff: hiring. From the catalog of ready roles, from a short HR conversation that
// drafts the profile for approval, or from scratch.
import type { StaffRoleTemplate } from "@t3tools/contracts/zenStaff";
import { ArrowRightIcon, MessagesSquareIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

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
import { Textarea } from "../../components/ui/textarea";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { toastManager } from "../../components/ui/toast";
import { intakeText } from "../intake/intake.i18n";
import { Spinner } from "../../components/ui/spinner";
import { useHireRole } from "./useHireRole";
import { AgentProfileDialog, type AgentDraft } from "./AgentProfileDialog";
import { staffHomeText } from "./staffHome.i18n";
import { StaffRoleIcon } from "./staffIcons";
import { Bone, SectionHeading, Tag } from "../ui/Registru";
import { staffText } from "./staff.i18n";
import { attempt, Field, type StaffContext } from "./staffShared";

export interface StaffCatalog {
  readonly roles: ReadonlyArray<StaffRoleTemplate>;
  readonly questions: Readonly<
    Record<"en" | "ro", ReadonlyArray<{ readonly id: string; readonly question: string }>>
  >;
}

export function StaffHireTab(props: {
  readonly context: StaffContext;
  readonly catalog: StaffCatalog | null;
  readonly preselect?: string | null;
}) {
  const t = useZenText(staffText);
  const locale = useZenLocale();
  // A role click goes straight into its setup chat (useHireRole); no dialog.
  const hireRole = useHireRole(props.context.environmentId);
  const i = useZenText(intakeText);
  const [hiring, setHiring] = useState<string | null>(null);
  const hire = async (role: StaffRoleTemplate) => {
    if (hiring !== null) return;
    setHiring(role.id);
    const failure = await hireRole({
      role,
      companyId: props.context.companyId,
      companyName: props.context.overview.companyName,
      overview: props.context.overview,
    });
    setHiring(null);
    props.context.refresh();
    if (failure !== null) {
      toastManager.add({ type: "error", title: i.couldNotStart, description: failure });
    }
  };
  // A link that names a role ("Angajează" from elsewhere) starts its setup chat once.
  const preselected = useRef(false);
  const preselectRole = props.catalog?.roles.find((role) => role.id === props.preselect) ?? null;
  const startPreselected = useEffectEvent((role: StaffRoleTemplate) => void hire(role));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the preselected role's setup chat once, when the catalog arrives.
  useEffect(() => {
    if (preselectRole === null || preselected.current) return;
    preselected.current = true;
    startPreselected(preselectRole);
  }, [preselectRole]);
  const [interview, setInterview] = useState(false);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const roles = props.catalog?.roles ?? [];
  const h = useZenText(staffHomeText);
  return (
    <div className="flex flex-col gap-10">
      <p className="zr-soft max-w-3xl">{h.hireIntro}</p>
      <section className="flex flex-col gap-4" aria-label={h.rolesTitle}>
        <SectionHeading
          title={h.rolesTitle}
          detail={<span className="hidden md:inline">{t.catalogIntro}</span>}
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-staff-catalog>
          {roles.length === 0
            ? Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="zr-card flex flex-col gap-3 p-5">
                  <Bone className="size-12 rounded-xl" />
                  <Bone className="h-4 w-2/3" />
                  <Bone className="h-3 w-full" />
                </div>
              ))
            : null}
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => void hire(role)}
              disabled={hiring !== null}
              aria-busy={hiring === role.id}
              className="zr-card zr-card-hover group flex flex-col gap-3 p-5 text-left disabled:cursor-progress"
              data-staff-role={role.id}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="flex size-12 items-center justify-center rounded-xl bg-zr-ink text-zr-paper">
                  <StaffRoleIcon name={role.icon} className="size-5.5" />
                </span>
                <Tag>{t.kind[role.suggestedKind]}</Tag>
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="zr-h3">{role.role[locale]}</span>
                <span className="zr-muted text-sm">{h.roleNamed(role.name[locale])}</span>
              </span>
              <span className="zr-soft line-clamp-3 text-sm leading-relaxed">
                {role.summary[locale]}
              </span>
              <span className="flex-1" />
              <span className="zr-rule flex items-center justify-between gap-2 border-t pt-3 text-sm">
                <span className="zr-muted">
                  {t.workflowsCount(role.workflows.length)}
                  {role.duties.length > 0 ? ` · ${t.dutiesCount(role.duties.length)}` : ""}
                </span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  {hiring === role.id ? <Spinner className="size-4" /> : null}
                  {hiring === role.id ? i.startingChat : t.hire}
                  <ArrowRightIcon
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-4" aria-label={h.orOwn}>
        <SectionHeading title={h.orOwn} />
        <div className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setInterview(true)}
            className="zr-card zr-card-hover flex items-start gap-4 p-5 text-left"
            data-staff-hr
          >
            <span className="zr-tint flex size-11 shrink-0 items-center justify-center rounded-xl">
              <MessagesSquareIcon className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{t.conversationTitle}</span>
              <span className="zr-muted text-sm">{t.conversationIntro}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDraft({ name: "", origin: "manual" })}
            className="zr-card zr-card-hover flex items-start gap-4 p-5 text-left"
          >
            <span className="zr-tint flex size-11 shrink-0 items-center justify-center rounded-xl">
              <PlusIcon className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{t.fromScratch}</span>
              <span className="zr-muted text-sm">{t.instructionsHelp}</span>
            </span>
          </button>
        </div>
      </section>
      {interview && props.catalog ? (
        <InterviewDialog
          context={props.context}
          questions={props.catalog.questions[locale]}
          onClose={() => setInterview(false)}
          onDraft={(next) => {
            setInterview(false);
            setDraft(next);
          }}
        />
      ) : null}
      {draft ? (
        <AgentProfileDialog
          context={props.context}
          draft={draft}
          catalog={roles}
          onClose={() => setDraft(null)}
          saveLabel={t.approveHire}
        />
      ) : null}
    </div>
  );
}

interface HrDraftResult {
  readonly draft: {
    readonly name: string;
    readonly role: string;
    readonly instructions: string;
    readonly workflows: ReadonlyArray<string>;
    readonly connectors: ReadonlyArray<string>;
    readonly objectives: ReadonlyArray<string>;
    readonly duties: ReadonlyArray<{
      readonly title: string;
      readonly prompt: string;
      readonly weekday: number;
      readonly time: string;
    }>;
    readonly templateId: string | null;
    readonly minutesPerTask: number;
  };
  readonly source: "ai" | "catalog";
}

function InterviewDialog(props: {
  readonly context: StaffContext;
  readonly questions: ReadonlyArray<{ readonly id: string; readonly question: string }>;
  readonly onClose: () => void;
  readonly onDraft: (draft: AgentDraft) => void;
}) {
  const t = useZenText(staffText);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const question = props.questions[step]!;
  const last = step === props.questions.length - 1;
  const draft = async () => {
    setBusy(true);
    const result = await attempt(() =>
      props.context.call<HrDraftResult>("hr.draft", {
        answers: props.questions.map((item) => ({
          id: item.id,
          question: item.question,
          answer: answers[item.id] ?? "",
        })),
      }),
    );
    setBusy(false);
    if (result === null) return;
    const managerName = (answers.approver ?? "").toLowerCase();
    const manager = props.context.overview.humans.find((human) =>
      managerName.includes(human.name.toLowerCase().split(" ")[0] ?? "\u0000"),
    );
    props.onDraft({
      name: result.draft.name,
      role: result.draft.role,
      instructions: result.draft.instructions,
      workflows: result.draft.workflows,
      connectors: result.draft.connectors,
      objectives: result.draft.objectives.map((title, index) => ({
        id: `objective-${index + 1}`,
        title,
        target: "",
      })),
      duties: result.draft.duties.map((duty, index) => ({
        id: `duty-new-${index + 1}`,
        ...duty,
        scheduledTaskId: null,
      })),
      templateId: result.draft.templateId,
      minutesPerTask: result.draft.minutesPerTask,
      origin: "conversation",
      managerId: manager?.id ?? props.context.overview.humans[0]?.id ?? null,
      kind: "personal",
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.conversationTitle}</DialogTitle>
          <DialogDescription>
            {step + 1} / {props.questions.length}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3" data-staff-interview>
            <div className="flex flex-col gap-2">
              {props.questions.slice(0, step).map((item) => (
                <div key={item.id} className="text-sm">
                  <p className="text-muted-foreground">{item.question}</p>
                  <p className="rounded-lg bg-primary/8 px-3 py-2">{answers[item.id] || "-"}</p>
                </div>
              ))}
            </div>
            <Field label={question.question}>
              <Textarea
                rows={4}
                autoFocus
                value={answers[question.id] ?? ""}
                onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
                aria-label={question.question}
                data-staff-answer
              />
            </Field>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => (step === 0 ? props.onClose() : setStep(step - 1))}
            disabled={busy}
          >
            {step === 0 ? t.cancel : t.back}
          </Button>
          {last ? (
            <Button onClick={() => void draft()} disabled={busy} data-staff-draft>
              {busy ? t.drafting : t.draftProfile}
            </Button>
          ) : (
            <Button onClick={() => setStep(step + 1)} data-staff-next>
              {t.next}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
