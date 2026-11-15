// Zen Staff AI staff: the profile of an AI employee ("fișa postului"): who it is, what it may
// use, its schedule and limits, its manager and objectives, personal or company.
import { useAtomValue } from "@effect/atom-react";
import { localizeWorkflowManifest } from "@t3tools/contracts/zenOffice";
import type { StaffAgent, StaffAgentKind, StaffRoleTemplate } from "@t3tools/contracts/zenStaff";
import { AsyncResult } from "effect/reactivity";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeWorkflows } from "../office/officeState";
import { staffText } from "./staff.i18n";
import { attempt, Field, projectKey, SELECT_CLASS, type StaffContext } from "./staffShared";
import { ZenNativeSelect } from "../ui/ZenSelect";

export type AgentDraft = Partial<StaffAgent> & { readonly name: string };

const COLORS = [
  "#2F6F5E",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#CA8A04",
  "#0891B2",
  "#475569",
];

export function AgentProfileDialog(props: {
  readonly context: StaffContext;
  readonly draft: AgentDraft;
  readonly catalog: ReadonlyArray<StaffRoleTemplate>;
  readonly onClose: () => void;
  readonly onSaved?: (agent: StaffAgent) => void;
  readonly saveLabel?: string;
}) {
  const t = useZenText(staffText);
  const locale = useZenLocale();
  const { context } = props;
  const [agent, setAgent] = useState<AgentDraft>(() => ({
    kind: "personal",
    memory: { read: true, write: false },
    workflows: [],
    connectors: [],
    duties: [],
    objectives: [],
    limits: { maxRunsPerDay: 20, maxMinutesPerRun: 30, monthlyTokenBudget: null },
    managerId: context.overview.humans[0]?.id ?? null,
    workingHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
    color: "#2F6F5E",
    minutesPerTask: 30,
    ...props.draft,
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof StaffAgent>(key: K, value: StaffAgent[K]) =>
    setAgent((current) => ({ ...current, [key]: value }));

  const workflowsResult = useAtomValue(
    officeWorkflows({
      environmentId: context.environmentId,
      input: { companyId: context.companyId },
    }),
  );
  const workflows = AsyncResult.isSuccess(workflowsResult)
    ? workflowsResult.value.workflows.map((workflow) => ({
        id: workflow.manifest.id,
        name: localizeWorkflowManifest(workflow.manifest, locale).name,
      }))
    : [];
  const knownWorkflows = new Map(workflows.map((workflow) => [workflow.id, workflow.name]));
  for (const id of agent.workflows ?? []) if (!knownWorkflows.has(id)) knownWorkflows.set(id, id);
  const workflowChoices = [...knownWorkflows.entries()].map(([id, name]) => ({ id, name }));
  const connectorChoices = [
    ...new Set([...props.catalog.flatMap((role) => role.connectors), ...(agent.connectors ?? [])]),
  ].toSorted();
  const toggle = (list: ReadonlyArray<string> | undefined, id: string) =>
    (list ?? []).includes(id) ? (list ?? []).filter((item) => item !== id) : [...(list ?? []), id];
  const placement = context.overview.companyPlacement;
  const project = context.projects.find((candidate) => candidate.id === agent.projectId) ?? null;

  const save = async () => {
    setSaving(true);
    const saved = await attempt(
      () =>
        context.call<StaffAgent>("agent.save", {
          agent,
          defaults: context.defaultsFor(project ?? context.projects[0] ?? null),
        }),
      t.saved,
    );
    setSaving(false);
    if (saved !== null) {
      context.refresh();
      props.onSaved?.(saved);
      props.onClose();
    }
  };

  const hours = agent.workingHours ?? null;
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && props.onClose()}>
      <DialogPopup className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{agent.id ? t.profileTitle : t.profileNew}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-4 sm:grid-cols-2" data-staff-profile>
            <Field label={t.name}>
              <Input
                value={agent.name}
                onChange={(event) => set("name", event.target.value)}
                aria-label={t.name}
              />
            </Field>
            <Field label={t.role}>
              <Input
                value={agent.role ?? ""}
                onChange={(event) => set("role", event.target.value)}
                aria-label={t.role}
              />
            </Field>
            <Field label={t.color}>
              <div className="flex gap-1.5">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    className={cn(
                      "size-6 rounded-md ring-offset-2 ring-offset-background",
                      agent.color === color && "ring-2 ring-ring",
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => set("color", color)}
                  />
                ))}
              </div>
            </Field>
            <Field
              label={t.kindLabel}
              help={
                agent.kind === "company" && !placement.ok
                  ? placement.message
                  : t.kindHelp[agent.kind ?? "personal"]
              }
            >
              <div className="flex gap-2">
                {(["personal", "company"] as const satisfies ReadonlyArray<StaffAgentKind>).map(
                  (kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant={agent.kind === kind ? "default" : "outline"}
                      onClick={() => set("kind", kind)}
                    >
                      {t.kind[kind]}
                    </Button>
                  ),
                )}
              </div>
            </Field>
            <Field label={t.instructions} help={t.instructionsHelp} className="sm:col-span-2">
              <Textarea
                rows={7}
                value={agent.instructions ?? ""}
                onChange={(event) => set("instructions", event.target.value)}
                aria-label={t.instructions}
              />
            </Field>
            <Field label={t.manager}>
              <ZenNativeSelect
                className={SELECT_CLASS}
                value={agent.managerId ?? ""}
                onChange={(event) => set("managerId", event.target.value || null)}
                aria-label={t.manager}
              >
                <option value="">{t.noManager}</option>
                {context.overview.humans.map((human) => (
                  <option key={human.id} value={human.id}>
                    {human.name}
                  </option>
                ))}
              </ZenNativeSelect>
            </Field>
            <Field label={t.folder}>
              <ZenNativeSelect
                className={SELECT_CLASS}
                value={project ? projectKey(project) : ""}
                onChange={(event) =>
                  set(
                    "projectId",
                    context.projects.find((item) => projectKey(item) === event.target.value)?.id ??
                      null,
                  )
                }
                aria-label={t.folder}
              >
                <option value="">{t.chooseFolder}</option>
                {context.projects.map((item) => (
                  <option key={projectKey(item)} value={projectKey(item)}>
                    {item.title}
                  </option>
                ))}
              </ZenNativeSelect>
            </Field>
            <Field label={t.workflows} className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {workflowChoices.map((workflow) => (
                  <ChipToggle
                    key={workflow.id}
                    on={(agent.workflows ?? []).includes(workflow.id)}
                    onClick={() => set("workflows", toggle(agent.workflows, workflow.id))}
                  >
                    {workflow.name}
                  </ChipToggle>
                ))}
              </div>
            </Field>
            <Field label={t.connectors} help={t.connectorsHelp} className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {connectorChoices.map((id) => (
                  <ChipToggle
                    key={id}
                    on={(agent.connectors ?? []).includes(id)}
                    onClick={() => set("connectors", toggle(agent.connectors, id))}
                  >
                    {id}
                  </ChipToggle>
                ))}
              </div>
            </Field>
            <Field label={t.memory}>
              <div className="flex flex-col gap-1">
                <Check
                  label={t.memoryRead}
                  checked={agent.memory?.read ?? true}
                  onChange={(read) => set("memory", { read, write: agent.memory?.write ?? false })}
                />
                <Check
                  label={t.memoryWrite}
                  checked={agent.memory?.write ?? false}
                  onChange={(write) => set("memory", { read: agent.memory?.read ?? true, write })}
                />
              </div>
            </Field>
            <Field label={t.workingHours}>
              <div className="flex flex-col gap-2">
                <div className="flex gap-1">
                  {t.days.map((label, index) => {
                    const day = index + 1;
                    const on = hours?.days.includes(day) ?? false;
                    return (
                      <ChipToggle
                        key={label}
                        on={on}
                        onClick={() => {
                          const days = on
                            ? (hours?.days ?? []).filter((item) => item !== day)
                            : [...(hours?.days ?? []), day].toSorted();
                          set("workingHours", {
                            days,
                            start: hours?.start ?? "09:00",
                            end: hours?.end ?? "18:00",
                          });
                        }}
                      >
                        {label}
                      </ChipToggle>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  {t.from}
                  <Input
                    className="w-24"
                    type="time"
                    value={hours?.start ?? "09:00"}
                    onChange={(event) =>
                      set("workingHours", {
                        days: hours?.days ?? [1, 2, 3, 4, 5],
                        start: event.target.value,
                        end: hours?.end ?? "18:00",
                      })
                    }
                  />
                  {t.to}
                  <Input
                    className="w-24"
                    type="time"
                    value={hours?.end ?? "18:00"}
                    onChange={(event) =>
                      set("workingHours", {
                        days: hours?.days ?? [1, 2, 3, 4, 5],
                        start: hours?.start ?? "09:00",
                        end: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </Field>
            <Field label={t.duties} help={t.dutiesHelp} className="sm:col-span-2">
              <div className="flex flex-col gap-2">
                {(agent.duties ?? []).map((duty, index) => (
                  <div
                    key={duty.id || index}
                    className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_8rem_6rem_auto]"
                  >
                    <Input
                      value={duty.title}
                      placeholder={t.dutyTitle}
                      aria-label={t.dutyTitle}
                      onChange={(event) =>
                        set(
                          "duties",
                          (agent.duties ?? []).map((item, at) =>
                            at === index ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <ZenNativeSelect
                      className={SELECT_CLASS}
                      value={duty.weekday}
                      aria-label={t.weekday}
                      onChange={(event) =>
                        set(
                          "duties",
                          (agent.duties ?? []).map((item, at) =>
                            at === index ? { ...item, weekday: Number(event.target.value) } : item,
                          ),
                        )
                      }
                    >
                      {t.weekdays.map((label, day) => (
                        <option key={label} value={day + 1}>
                          {label}
                        </option>
                      ))}
                    </ZenNativeSelect>
                    <Input
                      type="time"
                      value={duty.time}
                      aria-label={t.time}
                      onChange={(event) =>
                        set(
                          "duties",
                          (agent.duties ?? []).map((item, at) =>
                            at === index ? { ...item, time: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t.delete}
                      onClick={() =>
                        set(
                          "duties",
                          (agent.duties ?? []).filter((_, at) => at !== index),
                        )
                      }
                    >
                      <Trash2Icon />
                    </Button>
                    <Textarea
                      rows={2}
                      className="sm:col-span-4"
                      value={duty.prompt}
                      placeholder={t.dutyPrompt}
                      aria-label={t.dutyPrompt}
                      onChange={(event) =>
                        set(
                          "duties",
                          (agent.duties ?? []).map((item, at) =>
                            at === index ? { ...item, prompt: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() =>
                    set("duties", [
                      ...(agent.duties ?? []),
                      {
                        id: `duty-new-${(agent.duties ?? []).length + 1}`,
                        title: "",
                        prompt: "",
                        weekday: 1,
                        time: "09:00",
                        scheduledTaskId: null,
                      },
                    ])
                  }
                >
                  <PlusIcon />
                  {t.addDuty}
                </Button>
              </div>
            </Field>
            <Field label={t.limits} className="sm:col-span-2">
              <div className="grid gap-2 sm:grid-cols-4">
                <NumberInput
                  label={t.maxRunsPerDay}
                  value={agent.limits?.maxRunsPerDay ?? null}
                  onChange={(value) =>
                    set("limits", {
                      maxRunsPerDay: value,
                      maxMinutesPerRun: agent.limits?.maxMinutesPerRun ?? null,
                      monthlyTokenBudget: agent.limits?.monthlyTokenBudget ?? null,
                    })
                  }
                  placeholder={t.noLimit}
                />
                <NumberInput
                  label={t.maxMinutesPerRun}
                  value={agent.limits?.maxMinutesPerRun ?? null}
                  onChange={(value) =>
                    set("limits", {
                      maxRunsPerDay: agent.limits?.maxRunsPerDay ?? null,
                      maxMinutesPerRun: value,
                      monthlyTokenBudget: agent.limits?.monthlyTokenBudget ?? null,
                    })
                  }
                  placeholder={t.noLimit}
                />
                <NumberInput
                  label={t.monthlyTokenBudget}
                  value={agent.limits?.monthlyTokenBudget ?? null}
                  onChange={(value) =>
                    set("limits", {
                      maxRunsPerDay: agent.limits?.maxRunsPerDay ?? null,
                      maxMinutesPerRun: agent.limits?.maxMinutesPerRun ?? null,
                      monthlyTokenBudget: value,
                    })
                  }
                  placeholder={t.noLimit}
                />
                <NumberInput
                  label={t.minutesPerTask}
                  value={agent.minutesPerTask ?? 30}
                  onChange={(value) => set("minutesPerTask", value ?? 30)}
                  placeholder="30"
                />
              </div>
            </Field>
            <Field label={t.objectives} className="sm:col-span-2">
              <div className="flex flex-col gap-2">
                {(agent.objectives ?? []).map((objective, index) => (
                  <div
                    key={objective.id || index}
                    className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]"
                  >
                    <Input
                      value={objective.title}
                      aria-label={t.objectives}
                      onChange={(event) =>
                        set(
                          "objectives",
                          (agent.objectives ?? []).map((item, at) =>
                            at === index ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Input
                      value={objective.target}
                      placeholder={t.objectiveTarget}
                      aria-label={t.objectiveTarget}
                      onChange={(event) =>
                        set(
                          "objectives",
                          (agent.objectives ?? []).map((item, at) =>
                            at === index ? { ...item, target: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t.delete}
                      onClick={() =>
                        set(
                          "objectives",
                          (agent.objectives ?? []).filter((_, at) => at !== index),
                        )
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() =>
                    set("objectives", [
                      ...(agent.objectives ?? []),
                      {
                        id: `objective-${(agent.objectives ?? []).length + 1}`,
                        title: "",
                        target: "",
                      },
                    ])
                  }
                >
                  <PlusIcon />
                  {t.addObjective}
                </Button>
              </div>
            </Field>
            <Check
              label={t.paused}
              checked={agent.paused ?? false}
              onChange={(paused) => set("paused", paused)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={saving}>
            {t.cancel}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || agent.name.trim() === ""}
            data-staff-save
          >
            {props.saveLabel ?? t.save}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ChipToggle(props: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      onClick={props.onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        props.on
          ? "border-primary bg-primary/10 text-foreground"
          : "border-input text-muted-foreground hover:bg-accent",
      )}
    >
      {props.children}
    </button>
  );
}

function Check(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

function NumberInput(props: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground text-xs">
      {props.label}
      <Input
        type="number"
        min={0}
        value={props.value ?? ""}
        placeholder={props.placeholder}
        onChange={(event) =>
          props.onChange(event.target.value === "" ? null : Number(event.target.value))
        }
      />
    </label>
  );
}
