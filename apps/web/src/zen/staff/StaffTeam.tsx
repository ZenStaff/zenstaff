// Zen Staff AI staff: the team (AI employee cards with status, manager, account and last work,
// and the people they report to), a task row with its trail and ratings, and the dialogs to give a
// task and to add a person. The employee's own page is StaffProfile.tsx.
import type {
  StaffAgent,
  StaffAgentStatus,
  StaffEstimate,
  StaffHuman,
  StaffRoleTemplate,
  StaffTaskRun,
} from "@t3tools/contracts/zenStaff";
import {
  PlusIcon,
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

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
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { MyRunnerTasks } from "../hub/MyRunnerTasks";
import { RunnerFollowView } from "../hub/RunnerFollowView";
import { addRunnerTask } from "../hub/runnerTasks";
import { securityText } from "../hub/security.i18n";
import { staffText } from "./staff.i18n";
import { staffHomeText } from "./staffHome.i18n";
import { staffHubText } from "./staffHub.i18n";
import { StaffHubBadge } from "./StaffHubControls";
import { EmptyState, SectionHeading, Tag } from "../ui/Registru";
import { useStaffQuery } from "./staffClient";
import { formatTokens, latestRunOf } from "./staffModel";
import {
  attempt,
  Avatar,
  Field,
  formatWhen,
  projectKey,
  SELECT_CLASS,
  StatusLabel,
  useOpenThread,
  type StaffContext,
} from "./staffShared";
import { StaffAgentAccountLine } from "./StaffAgentAccount";
import { ZenNativeSelect } from "../ui/ZenSelect";

type AgentWithStatus = StaffAgent & { readonly status: StaffAgentStatus };

export function StaffTeamGrid(props: {
  readonly context: StaffContext;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly catalog: ReadonlyArray<StaffRoleTemplate>;
  readonly onHire: () => void;
  readonly onOpen: (agentId: string) => void;
}) {
  const h = useZenText(staffHomeText);
  const { overview } = props.context;
  const [editHuman, setEditHuman] = useState<Partial<StaffHuman> | null>(null);
  const hire = (
    <button type="button" className="zr-btn zr-btn-loud" onClick={props.onHire} data-staff-hire>
      <PlusIcon />
      {h.hireCta}
    </button>
  );
  return (
    <div className="flex flex-col gap-10">
      <MyRunnerTasks companyId={props.context.companyId} />
      {overview.agents.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={h.teamEmptyTitle}
          body={h.teamEmptyBody}
          action={hire}
        />
      ) : (
        <section className="flex flex-col gap-4" aria-label={h.areas.team}>
          <SectionHeading title={h.agentsCount(overview.agents.length)} action={hire} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-staff-team>
            {overview.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                context={props.context}
                humans={props.humans}
                onOpen={() => props.onOpen(agent.id)}
              />
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-4" aria-label={h.people}>
        <SectionHeading
          title={h.people}
          detail={<span className="hidden md:inline">{h.peopleHelp}</span>}
          action={
            <button
              type="button"
              className="zr-btn zr-btn-quiet zr-btn-sm"
              onClick={() => setEditHuman({ name: "", title: "" })}
            >
              <UserPlusIcon />
              {h.addPerson}
            </button>
          }
        />
        <div className="flex flex-wrap gap-3" data-staff-people>
          {props.humans.map((human) => {
            const reports = overview.agents.filter((agent) => agent.managerId === human.id);
            return (
              <button
                key={human.id}
                type="button"
                className="zr-card flex min-w-60 items-center gap-3 px-4 py-3 text-left"
                onClick={() => human.source === "local" && setEditHuman(human)}
                data-staff-human={human.id}
              >
                <Avatar name={human.name} color="#121A2B" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-sm">{human.name}</span>
                  <span className="zr-muted truncate text-xs">
                    {human.title}
                    {human.source === "hub" ? ` · ${h.fromHub}` : ""}
                  </span>
                </span>
                {reports.length > 0 ? (
                  <span className="zr-muted ml-auto pl-4 text-xs">
                    {h.manages(reports.map((agent) => agent.name))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>
      {editHuman ? (
        <HumanDialog
          context={props.context}
          human={editHuman}
          humans={props.humans}
          onClose={() => setEditHuman(null)}
        />
      ) : null}
    </div>
  );
}

function AgentCard(props: {
  readonly agent: AgentWithStatus;
  readonly context: StaffContext;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly onOpen: () => void;
}) {
  const t = useZenText(staffText);
  const h = useZenText(staffHomeText);
  const locale = useZenLocale();
  const { agent } = props;
  const manager = props.humans.find((human) => human.id === agent.managerId)?.name ?? null;
  const last = latestRunOf(agent.id, props.context.overview.runs);
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="zr-card zr-card-hover flex flex-col gap-4 p-5 text-left"
      data-staff-agent={agent.id}
    >
      <span className="flex items-start gap-3">
        <Avatar name={agent.name} color={agent.color} agent className="size-12 text-base" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="zr-h3 truncate">{agent.name}</span>
          <span className="zr-muted truncate text-sm">{agent.role}</span>
        </span>
        {agent.hub === undefined ? (
          <Tag>{t.kind[agent.kind]}</Tag>
        ) : (
          <StaffHubBadge agent={agent} />
        )}
      </span>
      <StatusLabel status={agent.status} label={t.status[agent.status]} />
      <div className="zr-rule flex flex-col gap-2.5 border-t pt-3 text-sm">
        <span className="flex justify-between gap-3">
          <span className="zr-muted">{h.managedBy}</span>
          <span className="truncate font-medium">{manager ?? h.noManager}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="zr-muted">{h.lastWork}</span>
          {last ? (
            <span className="line-clamp-1">
              {last.title}
              <span className="zr-muted"> · {formatWhen(last.startedAt, locale)}</span>
            </span>
          ) : (
            <span className="zr-muted">{h.noWorkYet}</span>
          )}
        </span>
      </div>
      <StaffAgentAccountLine agent={agent} />
    </button>
  );
}

export function RunRow(props: {
  readonly run: StaffTaskRun;
  readonly context: StaffContext;
  readonly agent: StaffAgent;
  readonly onOpen: () => void;
}) {
  const t = useZenText(staffText);
  const h = useZenText(staffHomeText);
  const locale = useZenLocale();
  const { run } = props;
  const [showTrail, setShowTrail] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const rate = (input: { thumbs?: "up" | "down"; score?: number }) =>
    void attempt(
      () =>
        props.context.call("rating.add", {
          agentId: props.agent.id,
          threadId: run.threadId,
          ...input,
        }),
      t.rated,
    ).then(() => props.context.refresh());
  return (
    <li className="zr-card p-4 text-sm" data-staff-run={run.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
          onClick={props.onOpen}
        >
          {run.title}
        </button>
        <span className="text-muted-foreground text-xs">
          {formatWhen(run.startedAt, locale)}
          {run.tokens !== null
            ? ` · ${formatTokens(run.tokens, locale)} ${t.tokens.toLowerCase()}`
            : ""}
        </span>
        <Tag loud={run.status === "failed"}>{h.runStatus[run.status]}</Tag>
      </div>
      {run.trail ? (
        <div className="mt-2">
          <ul className="list-disc pl-5 text-muted-foreground">
            {run.trail.explainToBoss.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-1 text-primary text-xs hover:underline"
            onClick={() => setShowTrail((value) => !value)}
          >
            {t.howIGotHere}
          </button>
          {showTrail ? <Trail trail={run.trail} /> : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-1">
        <span className="mr-1 text-muted-foreground text-xs">{t.rate}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t.rateUp}
          onClick={() => rate({ thumbs: "up" })}
        >
          <ThumbsUpIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t.rateDown}
          onClick={() => rate({ thumbs: "down" })}
        >
          <ThumbsDownIcon />
        </Button>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`${value}/5`}
            className={cn(
              "text-muted-foreground hover:text-warning",
              score !== null && value <= score && "text-warning",
            )}
            onClick={() => {
              setScore(value);
              rate({ score: value });
            }}
          >
            <StarIcon
              className="size-3.5"
              fill={score !== null && value <= score ? "currentColor" : "none"}
            />
          </button>
        ))}
      </div>
    </li>
  );
}

function Trail(props: { readonly trail: NonNullable<StaffTaskRun["trail"]> }) {
  const t = useZenText(staffText);
  const block = (title: string, items: ReadonlyArray<string>) =>
    items.length === 0 ? null : (
      <div>
        <p className="font-medium text-xs">{title}</p>
        <ul className="list-disc pl-5 text-muted-foreground text-xs">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md bg-muted/40 p-2" data-staff-trail>
      <p className="text-xs">{props.trail.summary}</p>
      {block(t.sources, props.trail.sources)}
      {block(t.filesRead, props.trail.filesRead)}
      {block(t.steps, props.trail.steps)}
      {block(t.assumptions, props.trail.assumptions)}
    </div>
  );
}

export function TaskDialog(props: {
  readonly context: StaffContext;
  readonly agent: StaffAgent;
  readonly cardId?: string;
  readonly initialText?: string;
  readonly onClose: () => void;
}) {
  const t = useZenText(staffText);
  const hubT = useZenText(staffHubText);
  const locale = useZenLocale();
  const { context, agent } = props;
  const openThread = useOpenThread(context.environmentId);
  const [text, setText] = useState(props.initialText ?? "");
  const [teachMe, setTeachMe] = useState(false);
  const [starting, setStarting] = useState(false);
  const initialProject =
    context.projects.find((project) => project.id === agent.projectId) ??
    context.projects[0] ??
    null;
  const [projectChoice, setProjectChoice] = useState(
    initialProject ? projectKey(initialProject) : "",
  );
  const project = context.projects.find((item) => projectKey(item) === projectChoice) ?? null;
  const title = text.split("\n")[0]?.slice(0, 80) ?? "";
  const estimate = useStaffQuery<StaffEstimate>(
    context.environmentId,
    context.companyId,
    "task.estimate",
    {
      agentId: agent.id,
      title,
    },
  );
  // Hub v9: a task on the company server is followed here, read-only, instead of opening a chat.
  const [following, setFollowing] = useState<{ readonly runId: string } | null>(null);
  const securityT = useZenText(securityText);
  const start = async () => {
    setStarting(true);
    const result = await attempt(
      () =>
        context.call<{ threadId: string; runId?: string; onRunner?: boolean }>("task.start", {
          agentId: agent.id,
          text,
          teachMe,
          cardId: props.cardId ?? null,
          projectId: project?.id ?? null,
          defaults: context.defaultsFor(project),
        }),
      agent.hub?.source === "mirror" ? hubT.sentToRunner(agent.name) : t.started,
    );
    setStarting(false);
    if (result !== null) {
      context.refresh();
      // A company agent's thread lives on the company server, not on this computer: follow it.
      if (result.onRunner === true && result.runId && agent.hub?.staffId) {
        // Kept on this device: "Urmărește live" stays on the AI staff page after closing.
        addRunnerTask({
          companyId: context.companyId,
          staffId: agent.hub.staffId,
          runId: result.runId,
          agentName: agent.name,
          title: title || agent.name,
          startedAt: new Date().toISOString(),
        });
        setFollowing({ runId: result.runId });
        return;
      }
      props.onClose();
      openThread(result.threadId);
    }
  };
  if (following !== null && agent.hub?.staffId) {
    return (
      <Dialog open onOpenChange={(open) => !open && props.onClose()}>
        <DialogPopup className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{securityT.followLive}</DialogTitle>
            <DialogDescription>{hubT.sentToRunner(agent.name)}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <RunnerFollowView
              companyId={context.companyId}
              staffId={agent.hub.staffId}
              runId={following.runId}
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              {securityT.followClose}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !starting && props.onClose()}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.taskTitle(agent.name)}</DialogTitle>
          <DialogDescription>{t.kindHelp[agent.kind]}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <Field label={t.taskText}>
              <Textarea
                rows={5}
                value={text}
                placeholder={t.taskPlaceholder}
                onChange={(event) => setText(event.target.value)}
                aria-label={t.taskText}
                data-staff-task-text
              />
            </Field>
            <Field label={t.folder}>
              <ZenNativeSelect
                className={SELECT_CLASS}
                value={projectChoice}
                onChange={(event) => setProjectChoice(event.target.value)}
                aria-label={t.folder}
              >
                {context.projects.map((item) => (
                  <option key={projectKey(item)} value={projectKey(item)}>
                    {item.title}
                  </option>
                ))}
              </ZenNativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={teachMe}
                onChange={(event) => setTeachMe(event.target.checked)}
              />
              {t.teachMe}
            </label>
            {estimate ? <EstimateBox estimate={estimate} locale={locale} /> : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={starting}>
            {t.cancel}
          </Button>
          <Button
            onClick={() => void start()}
            disabled={starting || text.trim() === ""}
            data-staff-start
          >
            {starting ? t.starting : t.start}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function EstimateBox(props: { readonly estimate: StaffEstimate; readonly locale: string }) {
  const t = useZenText(staffText);
  const { estimate } = props;
  return (
    <div
      className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
      data-staff-estimate
    >
      <p className="font-medium">
        {t.estimate}:{" "}
        {t.estimateLine(estimate.minutes, formatTokens(estimate.tokens, props.locale))}
        {estimate.cost !== null
          ? t.estimateCost(`${estimate.cost.toFixed(2)} ${estimate.currency}`)
          : ""}
      </p>
      <p className="text-muted-foreground text-xs">
        {t.estimateHuman(estimate.humanMinutes)} ({t.estimateBasis[estimate.basis]})
      </p>
    </div>
  );
}

function HumanDialog(props: {
  readonly context: StaffContext;
  readonly human: Partial<StaffHuman>;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly onClose: () => void;
}) {
  const t = useZenText(staffText);
  const [human, setHuman] = useState(props.human);
  const save = async () => {
    const saved = await attempt(() => props.context.call("human.save", { human }), t.saved);
    if (saved !== null) {
      props.context.refresh();
      props.onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{human.id ? t.editPerson : t.addPerson}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <Field label={t.name}>
              <Input
                value={human.name ?? ""}
                onChange={(event) => setHuman({ ...human, name: event.target.value })}
              />
            </Field>
            <Field label={t.role}>
              <Input
                value={human.title ?? ""}
                onChange={(event) => setHuman({ ...human, title: event.target.value })}
              />
            </Field>
            <Field label={t.reportsTo}>
              <ZenNativeSelect
                className={SELECT_CLASS}
                value={human.managerId ?? ""}
                onChange={(event) => setHuman({ ...human, managerId: event.target.value || null })}
              >
                <option value="">{t.nobody}</option>
                {props.humans
                  .filter((item) => item.id !== human.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </ZenNativeSelect>
            </Field>
          </div>
        </DialogPanel>
        <DialogFooter>
          {human.id ? (
            <Button
              variant="ghost-destructive"
              onClick={() =>
                void attempt(() => props.context.call("human.delete", { humanId: human.id })).then(
                  () => {
                    props.context.refresh();
                    props.onClose();
                  },
                )
              }
            >
              {t.delete}
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button variant="outline" onClick={props.onClose}>
            {t.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={(human.name ?? "").trim() === ""}>
            {t.save}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
