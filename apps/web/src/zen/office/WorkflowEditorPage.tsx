// Zen Staff: create or edit your own workflow, or your company's. Saves to
// <zen home>/workflows/<id>/ or <zen home>/companies/<company>/workflows/<id>/. Also opens the
// draft "Save this as a workflow" made from a thread.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import {
  ZEN_WORKFLOW_CATEGORIES,
  ZEN_WORKFLOW_INPUT_TYPES,
  renderWorkflowTemplate,
  validateWorkflow,
  workflowIdFromName,
  type ZenWorkflow,
  type ZenWorkflowCategory,
  type ZenWorkflowInputType,
} from "@t3tools/contracts/zenOffice";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useContext, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { toastManager } from "../../components/ui/toast";
import { showOfficeFailure } from "./officeFailures";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { CATEGORY_TEXT, INPUT_TYPE_TEXT, localizeWorkflowProblem, officeText } from "./office.i18n";
import {
  EMPTY_WORKFLOW_DRAFT,
  deleteOfficeWorkflow,
  draftFromWorkflow,
  initialFormValues,
  inputIdFromLabel,
  insertPlaceholder,
  manifestFromDraft,
  newDraftKey,
  officeWorkflows,
  saveOfficeWorkflow,
  type WorkflowDraft,
  type WorkflowDraftInput,
} from "./officeState";
import { WorkflowInputField } from "./OfficeHomePage";
import { OfficePageShell } from "./OfficePageShell";
import { useOfficeCompany } from "./useOfficeCompany";
import { WORKFLOW_ICON_NAMES, WorkflowIcon } from "./workflowIcons";
import { officeChatText } from "./officeChat.i18n";
import {
  clearWorkflowDraft,
  readWorkflowDraft,
  WORKFLOW_MODEL_ALIASES,
} from "./officeWorkflowTools";

export function WorkflowEditorPage({
  id,
  fromDraft = false,
}: {
  readonly id: string | undefined;
  readonly fromDraft?: boolean;
}) {
  const t = useZenText(officeText);
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) {
    return (
      <OfficePageShell title={t.createWorkflow}>
        <p className="text-muted-foreground text-sm">{t.waitingToConnect}</p>
      </OfficePageShell>
    );
  }
  return id ? (
    <EditExisting environmentId={environmentId} id={id} />
  ) : (
    <WorkflowEditor environmentId={environmentId} existing={null} fromDraft={fromDraft} />
  );
}

function EditExisting({ environmentId, id }: { environmentId: EnvironmentId; id: string }) {
  const t = useZenText(officeText);
  const { workflowsInput } = useOfficeCompany();
  const result = useAtomValue(officeWorkflows({ environmentId, input: workflowsInput }));
  if (!AsyncResult.isSuccess(result)) {
    return (
      <OfficePageShell title={t.editWorkflow}>
        {result._tag === "Failure" ? (
          <p className="text-destructive-foreground text-sm">{t.workflowLoadFailed}</p>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </OfficePageShell>
    );
  }
  const workflow = result.value.workflows.find((candidate) => candidate.manifest.id === id);
  if (!workflow || !workflow.editable) {
    return (
      <OfficePageShell title={t.editWorkflow}>
        <p className="text-muted-foreground text-sm">{t.onlyOwnEditable}</p>
      </OfficePageShell>
    );
  }
  return <WorkflowEditor environmentId={environmentId} existing={workflow} />;
}

function WorkflowEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly existing: ZenWorkflow | null;
  readonly fromDraft?: boolean;
}) {
  const c = useZenText(officeChatText);
  const t = useZenText(officeText);
  const categories = useZenText(CATEGORY_TEXT);
  const inputTypes = useZenText(INPUT_TYPE_TEXT);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const [threadDraft] = useState(() => (props.fromDraft ? readWorkflowDraft() : null));
  const [draft, setDraft] = useState<WorkflowDraft>(() =>
    props.existing
      ? draftFromWorkflow(props.existing)
      : threadDraft
        ? draftFromWorkflow(threadDraft)
        : EMPTY_WORKFLOW_DRAFT,
  );
  const [problems, setProblems] = useState<ReadonlyArray<string>>([]);
  const [saving, setSaving] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const save = useAtomCommand(saveOfficeWorkflow, { label: t.saveWorkflow });
  const remove = useAtomCommand(deleteOfficeWorkflow, { label: t.delete });
  const { workflowsInput, companyId, index } = useOfficeCompany();
  // A company's workflow stays the company's; a new one can go to the chosen company.
  const companyChoice =
    props.existing?.source === "company"
      ? companyId
      : companyId !== null && companyId !== ZEN_PERSONAL_COMPANY_ID
        ? companyId
        : null;
  const companyName =
    index.companies.find((company) => company.id === companyChoice)?.name ?? companyChoice ?? "";
  const [forCompany, setForCompany] = useState(props.existing?.source === "company");
  const saveCompanyId = forCompany ? companyChoice : null;

  const workflowId = props.existing?.manifest.id ?? workflowIdFromName(draft.name);
  const manifest = manifestFromDraft(draft, workflowId);
  const update = (patch: Partial<WorkflowDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const updateInput = (key: string, patch: Partial<WorkflowDraftInput>) =>
    setDraft((current) => ({
      ...current,
      inputs: current.inputs.map((input) => (input.key === key ? { ...input, ...patch } : input)),
    }));
  const moveInput = (key: string, by: -1 | 1) =>
    setDraft((current) => {
      const index = current.inputs.findIndex((input) => input.key === key);
      const target = index + by;
      if (index < 0 || target < 0 || target >= current.inputs.length) return current;
      const inputs = [...current.inputs];
      [inputs[index], inputs[target]] = [inputs[target]!, inputs[index]!];
      return { ...current, inputs };
    });
  const addInput = () =>
    setDraft((current) => ({
      ...current,
      inputs: [
        ...current.inputs,
        {
          key: newDraftKey(),
          id: inputIdFromLabel(
            "detail",
            current.inputs.map((input) => input.id),
          ),
          label: "",
          type: "text",
          required: true,
          options: "",
          placeholder: "",
        },
      ],
    }));
  const insert = (id: string) => {
    const element = promptRef.current;
    const next = insertPlaceholder(
      draft.prompt,
      id,
      element ? { start: element.selectionStart, end: element.selectionEnd } : null,
    );
    update({ prompt: next.text });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const sampleValues = Object.fromEntries(
    manifest.inputs.map((input) => [
      input.id,
      input.type === "select"
        ? (input.options?.[0] ?? "")
        : input.placeholder || `[${input.label || input.id}]`,
    ]),
  );
  const [previewValues, setPreviewValues] = useState<Record<string, string> | null>(null);
  const shownValues = { ...sampleValues, ...previewValues };

  const submit = async () => {
    const found = validateWorkflow(manifest, draft.prompt).map((problem) =>
      localizeWorkflowProblem(problem, locale),
    );
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    const result = await save({
      environmentId: props.environmentId,
      input: {
        manifest,
        prompt: draft.prompt,
        previousId: props.existing?.manifest.id ?? null,
        companyId: saveCompanyId,
      },
    });
    setSaving(false);
    if (result._tag === "Failure") return showOfficeFailure("save", result.cause);
    if (threadDraft) clearWorkflowDraft();
    registry.refresh(
      officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
    );
    toastManager.add({ type: "success", title: t.savedNamed(manifest.name) });
    void navigate({ to: "/office" });
  };

  const deleteWorkflow = async () => {
    if (!props.existing) return;
    if (!window.confirm(t.confirmDelete(props.existing.manifest.name))) return;
    const result = await remove({
      environmentId: props.environmentId,
      input: {
        id: props.existing.manifest.id,
        companyId: props.existing.source === "company" ? companyChoice : null,
      },
    });
    if (result._tag === "Failure") return showOfficeFailure("delete", result.cause);
    registry.refresh(
      officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
    );
    void navigate({ to: "/office" });
  };

  return (
    <OfficePageShell
      title={props.existing ? t.editWorkflow : t.createWorkflow}
      actions={
        <div className="flex items-center gap-1.5">
          {props.existing ? (
            <Button size="sm" variant="ghost-destructive" onClick={() => void deleteWorkflow()}>
              <Trash2Icon />
              {t.delete}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/office" })}>
            {t.cancel}
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? t.saving : t.saveWorkflow}
          </Button>
        </div>
      }
    >
      <div className="grid gap-8 pt-2 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-6">
          {threadDraft && !props.existing ? (
            <p
              role="status"
              className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
            >
              {c.draftFromTask}
            </p>
          ) : null}
          {problems.length > 0 ? (
            <ul
              role="alert"
              className="flex list-disc flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 py-2 pr-3 pl-7 text-sm"
            >
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <section className="flex flex-col gap-4" aria-label={t.about}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-name">{t.name}</Label>
              <Input
                id="wf-name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder={t.namePlaceholder}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-description">{t.whatItDoes}</Label>
              <Input
                id="wf-description"
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
                placeholder={t.whatItDoesPlaceholder}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wf-category">{t.category}</Label>
                <Select
                  value={draft.category}
                  onValueChange={(value) => update({ category: value as ZenWorkflowCategory })}
                >
                  <SelectTrigger id="wf-category" className="w-56" aria-label={t.category}>
                    <SelectValue>{categories[draft.category]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {ZEN_WORKFLOW_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {categories[category]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <Label htmlFor="wf-output">{t.whatYouGet}</Label>
                <Input
                  id="wf-output"
                  value={draft.output}
                  onChange={(event) => update({ output: event.target.value })}
                  placeholder={t.whatYouGetPlaceholder}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-sm">{t.icon}</span>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t.icon}>
                {WORKFLOW_ICON_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={draft.icon === name}
                    aria-label={name}
                    onClick={() => update({ icon: name })}
                    className={
                      draft.icon === name
                        ? "flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
                        : "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    }
                  >
                    <WorkflowIcon name={name} className="size-4" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wf-model">{c.model}</Label>
                <Select
                  value={draft.model || "default"}
                  onValueChange={(value) =>
                    update({ model: value === "default" ? "" : String(value) })
                  }
                >
                  <SelectTrigger id="wf-model" className="w-72" aria-label={c.model}>
                    <SelectValue>{modelLabel(draft.model, c)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {[
                      "default",
                      ...WORKFLOW_MODEL_ALIASES,
                      ...(isCustomModel(draft.model) ? [draft.model] : []),
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {modelLabel(value === "default" ? "" : value, c)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <p className="text-muted-foreground text-xs">{c.modelHelp}</p>
              </div>
              {companyChoice !== null ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wf-scope">{c.saveFor}</Label>
                  <Select
                    value={forCompany ? "company" : "me"}
                    disabled={props.existing !== null}
                    onValueChange={(value) => setForCompany(value === "company")}
                  >
                    <SelectTrigger id="wf-scope" className="w-64" aria-label={c.saveFor}>
                      <SelectValue>
                        {forCompany ? c.saveForCompany(companyName) : c.saveForMe}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="start" alignItemWithTrigger={false}>
                      <SelectItem value="me">{c.saveForMe}</SelectItem>
                      <SelectItem value="company">{c.saveForCompany(companyName)}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-3" aria-label={t.questions}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium text-sm">{t.questions}</h2>
                <p className="text-muted-foreground text-xs">{t.questionsHelp}</p>
              </div>
              <Button size="sm" variant="outline" onClick={addInput}>
                <PlusIcon />
                {t.addQuestion}
              </Button>
            </div>
            {draft.inputs.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.noQuestions}</p>
            ) : null}
            {draft.inputs.map((input, index) => (
              <div key={input.key} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-40 flex-1"
                    value={input.label}
                    aria-label={t.questionN(index + 1)}
                    placeholder={t.questionPlaceholder}
                    onChange={(event) => {
                      const label = event.target.value;
                      const others = draft.inputs
                        .filter((other) => other.key !== input.key)
                        .map((other) => other.id);
                      const placeholderUsed = draft.prompt.includes(`{{${input.id}}}`);
                      updateInput(input.key, {
                        label,
                        ...(placeholderUsed ? {} : { id: inputIdFromLabel(label, others) }),
                      });
                    }}
                  />
                  <Select
                    value={input.type}
                    onValueChange={(value) =>
                      updateInput(input.key, { type: value as ZenWorkflowInputType })
                    }
                  >
                    <SelectTrigger className="w-40" aria-label={t.answerTypeN(index + 1)}>
                      <SelectValue>{inputTypes[input.type]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {ZEN_WORKFLOW_INPUT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {inputTypes[type]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <label className="flex items-center gap-1.5 text-sm">
                    <Switch
                      checked={input.required}
                      onCheckedChange={(checked) => updateInput(input.key, { required: checked })}
                      aria-label={t.requiredN(index + 1)}
                    />
                    {t.required}
                  </label>
                  <div className="flex items-center">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t.moveUp}
                      onClick={() => moveInput(input.key, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t.moveDown}
                      onClick={() => moveInput(input.key, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-destructive"
                      aria-label={t.removeQuestionN(index + 1)}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          inputs: current.inputs.filter((other) => other.key !== input.key),
                        }))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
                {input.type === "select" ? (
                  <Textarea
                    rows={3}
                    value={input.options}
                    aria-label={t.choicesN(index + 1)}
                    placeholder={t.choicesPlaceholder}
                    onChange={(event) => updateInput(input.key, { options: event.target.value })}
                  />
                ) : (
                  <Input
                    value={input.placeholder}
                    aria-label={t.exampleAnswerN(index + 1)}
                    placeholder={t.exampleAnswerPlaceholder}
                    onChange={(event) =>
                      updateInput(input.key, { placeholder: event.target.value })
                    }
                  />
                )}
                <p className="text-muted-foreground text-xs">
                  {t.inTheInstructions} <code className="font-mono">{`{{${input.id}}}`}</code>
                </p>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-2" aria-label={t.instructionsTitle}>
            <div>
              <h2 className="font-medium text-sm">{t.instructionsTitle}</h2>
              <p className="text-muted-foreground text-xs">
                {t.instructionsHelpBefore} <code className="font-mono">{"{{#id}}"}</code>{" "}
                {t.instructionsHelpAnd} <code className="font-mono">{"{{/id}}"}</code>{" "}
                {t.instructionsHelpAfter}
              </p>
            </div>
            {manifest.inputs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {manifest.inputs.map((input) => (
                  <Button
                    key={input.id}
                    size="xs"
                    variant="outline"
                    onClick={() => insert(input.id)}
                  >
                    <PlusIcon />
                    {input.label || input.id}
                  </Button>
                ))}
              </div>
            ) : null}
            <Textarea
              ref={promptRef}
              rows={14}
              value={draft.prompt}
              aria-label={t.instructions}
              placeholder={t.instructionsPlaceholder}
              onChange={(event) => update({ prompt: event.target.value })}
            />
          </section>
        </div>

        <aside
          className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
          aria-label={t.preview}
        >
          <h2 className="font-medium text-sm">{t.preview}</h2>
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <WorkflowIcon name={draft.icon} className="size-4.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{draft.name || t.untitledWorkflow}</p>
                <p className="truncate text-muted-foreground text-xs">
                  {categories[draft.category]}
                </p>
              </div>
            </div>
            {manifest.inputs.map((input) => (
              <WorkflowInputField
                key={input.id}
                input={input}
                value={previewValues?.[input.id] ?? initialFormValues([input])[input.id] ?? ""}
                onChange={(value) =>
                  setPreviewValues((current) => ({ ...current, [input.id]: value }))
                }
              />
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t.messagePreview}</span>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs">
              {draft.prompt.trim()
                ? renderWorkflowTemplate(draft.prompt, shownValues)
                : t.writeInstructionsToPreview}
            </pre>
          </div>
        </aside>
      </div>
    </OfficePageShell>
  );
}

function isCustomModel(model: string): boolean {
  return model !== "" && !(WORKFLOW_MODEL_ALIASES as ReadonlyArray<string>).includes(model);
}

function modelLabel(
  model: string,
  c: {
    readonly modelDefault: string;
    readonly modelHaiku: string;
    readonly modelSonnet: string;
    readonly modelOpus: string;
    readonly modelCustom: (model: string) => string;
  },
): string {
  switch (model) {
    case "":
      return c.modelDefault;
    case "haiku":
      return c.modelHaiku;
    case "sonnet":
      return c.modelSonnet;
    case "opus":
      return c.modelOpus;
    default:
      return c.modelCustom(model);
  }
}
