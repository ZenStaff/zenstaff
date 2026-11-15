// Zen Staff AI staff: the mixed task board (steps as columns, each card worked by a person or an
// AI employee, with handoffs) and the approvals inbox (checker findings highlighted, weekly
// reports to managers).
import type { StaffApproval, StaffAssignee, StaffCard } from "@t3tools/contracts/zenStaff";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ExternalLinkIcon,
  InboxIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
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
import { staffText } from "./staff.i18n";
import {
  canGiveStaffTask,
  StaffTaskPermissionTooltip,
  useStaffHubAccess,
} from "./StaffHubControls";
import { highlightSegments } from "./staffModel";
import {
  attempt,
  Avatar,
  Field,
  formatWhen,
  Section,
  SELECT_CLASS,
  useOpenThread,
  type StaffContext,
} from "./staffShared";
import { TaskDialog } from "./StaffTeam";
import { staffHomeText } from "./staffHome.i18n";
import { EmptyState, Stamp, Tag } from "../ui/Registru";
import { ZenNativeSelect } from "../ui/ZenSelect";

function assigneeValue(assignee: StaffAssignee | null): string {
  return assignee === null ? "" : `${assignee.kind}:${assignee.id}`;
}

function parseAssignee(value: string): StaffAssignee | null {
  const [kind, ...rest] = value.split(":");
  return kind === "agent" || kind === "human" ? { kind, id: rest.join(":") } : null;
}

export function StaffBoardTab(props: { readonly context: StaffContext }) {
  const t = useZenText(staffText);
  const { context } = props;
  const { overview } = context;
  const hubAccess = useStaffHubAccess(context);
  const openThread = useOpenThread(context.environmentId);
  const [editing, setEditing] = useState<Partial<StaffCard> | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [starting, setStarting] = useState<StaffCard | null>(null);
  const columns = overview.columns;
  const who = (assignee: StaffAssignee | null) => {
    if (assignee === null) return null;
    if (assignee.kind === "agent") {
      const agent = overview.agents.find((item) => item.id === assignee.id);
      return agent ? { name: agent.name, color: agent.color, agent: true } : null;
    }
    const human = overview.humans.find((item) => item.id === assignee.id);
    return human ? { name: human.name, color: "#1B2B24", agent: false } : null;
  };
  const save = (card: Partial<StaffCard>) =>
    attempt(() => context.call("card.save", { card })).then((saved) => {
      if (saved !== null) context.refresh();
      return saved;
    });
  const move = (card: StaffCard, delta: number) => {
    const index = columns.findIndex((column) => column.id === card.columnId);
    const next = columns[index + delta];
    if (next) void save({ ...card, columnId: next.id });
  };
  const h = useZenText(staffHomeText);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="zr-soft max-w-2xl flex-1">{h.boardIntro}</p>
        <button
          type="button"
          className="zr-btn zr-btn-quiet zr-btn-sm"
          onClick={() => setStepsOpen(true)}
        >
          {t.editSteps}
        </button>
        <button
          type="button"
          className="zr-btn zr-btn-loud zr-btn-sm"
          onClick={() =>
            setEditing({
              title: "",
              description: "",
              columnId: columns[0]?.id ?? "",
              assignee: null,
            })
          }
          data-staff-new-card
        >
          <PlusIcon />
          {t.newCard}
        </button>
      </div>
      <div
        className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2"
        data-staff-board
      >
        {columns.map((column, columnIndex) => {
          const cards = overview.cards.filter((card) => card.columnId === column.id);
          return (
            <div key={column.id} className="zr-tint flex min-h-72 flex-col gap-3 rounded-2xl p-3">
              <div className="flex items-center justify-between px-1 pt-1">
                <h3 className="zr-h3">{column.title}</h3>
                <span className="zr-muted zr-mono">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <p className="zr-muted rounded-xl border border-dashed border-zr-line px-3 py-6 text-center text-xs">
                  {h.boardEmpty}
                </p>
              ) : null}
              {cards.map((card) => {
                const person = who(card.assignee);
                return (
                  <div
                    key={card.id}
                    className="zr-card flex flex-col gap-2.5 p-3.5"
                    data-staff-card={card.id}
                  >
                    <button
                      type="button"
                      className="text-left font-semibold text-sm leading-snug hover:underline"
                      onClick={() => setEditing(card)}
                    >
                      {card.title}
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {person ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Avatar
                            name={person.name}
                            color={person.color}
                            agent={person.agent}
                            className="size-5 text-4xs"
                          />
                          {person.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">{t.unassigned}</span>
                      )}
                      {card.origin !== "board" ? <Tag>{t.origin[card.origin]}</Tag> : null}
                      {card.handoffs.length > 1 ? (
                        <Badge variant="secondary" size="sm">
                          {t.handoffs(card.handoffs.length - 1)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t.moveLeft}
                        disabled={columnIndex === 0}
                        onClick={() => move(card, -1)}
                      >
                        <ArrowLeftIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t.moveRight}
                        disabled={columnIndex === columns.length - 1}
                        onClick={() => move(card, 1)}
                      >
                        <ArrowRightIcon />
                      </Button>
                      <div className="flex-1" />
                      {card.threadId ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => openThread(card.threadId!)}
                        >
                          <ExternalLinkIcon />
                          {t.openThread}
                        </Button>
                      ) : card.assignee?.kind === "agent" ? (
                        (() => {
                          const assignee = overview.agents.find(
                            (item) => item.id === card.assignee!.id,
                          );
                          const allowed =
                            assignee === undefined ||
                            canGiveStaffTask(overview, assignee, hubAccess);
                          return (
                            <StaffTaskPermissionTooltip allowed={allowed}>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!allowed}
                                onClick={() => setStarting(card)}
                                data-staff-start-card
                              >
                                <PlayIcon />
                                {t.startWork}
                              </Button>
                            </StaffTaskPermissionTooltip>
                          );
                        })()
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {editing ? (
        <CardDialog
          context={context}
          card={editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {stepsOpen ? <StepsDialog context={context} onClose={() => setStepsOpen(false)} /> : null}
      {starting && starting.assignee?.kind === "agent"
        ? (() => {
            const agent = overview.agents.find((item) => item.id === starting.assignee!.id);
            return agent ? (
              <TaskDialog
                context={context}
                agent={agent}
                cardId={starting.id}
                initialText={`${starting.title}\n\n${starting.description}`.trim()}
                onClose={() => setStarting(null)}
              />
            ) : null;
          })()
        : null}
    </div>
  );
}

function CardDialog(props: {
  readonly context: StaffContext;
  readonly card: Partial<StaffCard>;
  readonly onSave: (card: Partial<StaffCard>) => Promise<unknown>;
  readonly onClose: () => void;
}) {
  const t = useZenText(staffText);
  const locale = useZenLocale();
  const { overview } = props.context;
  const [card, setCard] = useState(props.card);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{card.id ? card.title : t.newCard}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <Field label={t.cardTitle}>
              <Input
                value={card.title ?? ""}
                onChange={(event) => setCard({ ...card, title: event.target.value })}
                data-staff-card-title
              />
            </Field>
            <Field label={t.cardDescription}>
              <Textarea
                rows={4}
                value={card.description ?? ""}
                onChange={(event) => setCard({ ...card, description: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.assignee}>
                <ZenNativeSelect
                  className={SELECT_CLASS}
                  value={assigneeValue(card.assignee ?? null)}
                  onChange={(event) =>
                    setCard({ ...card, assignee: parseAssignee(event.target.value) })
                  }
                  data-staff-card-assignee
                >
                  <option value="">{t.unassigned}</option>
                  <optgroup label={t.humans}>
                    {overview.humans.map((human) => (
                      <option key={human.id} value={`human:${human.id}`}>
                        {human.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t.title}>
                    {overview.agents.map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        {agent.name} ({agent.role})
                      </option>
                    ))}
                  </optgroup>
                </ZenNativeSelect>
              </Field>
              <Field label={t.step}>
                <ZenNativeSelect
                  className={SELECT_CLASS}
                  value={card.columnId ?? ""}
                  onChange={(event) => setCard({ ...card, columnId: event.target.value })}
                >
                  {overview.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </ZenNativeSelect>
              </Field>
            </div>
            {(card.handoffs ?? []).length > 0 ? (
              <ol className="flex flex-col gap-1 text-muted-foreground text-xs">
                {(card.handoffs ?? []).map((handoff) => {
                  const name =
                    handoff.to.kind === "agent"
                      ? overview.agents.find((agent) => agent.id === handoff.to.id)?.name
                      : overview.humans.find((human) => human.id === handoff.to.id)?.name;
                  return (
                    <li key={handoff.at + handoff.to.id}>
                      {formatWhen(handoff.at, locale)} ·{" "}
                      {overview.columns.find((column) => column.id === handoff.columnId)?.title} ·{" "}
                      {name ?? "?"}
                      {handoff.note ? ` · ${handoff.note}` : ""}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          {card.id ? (
            <Button
              variant="ghost-destructive"
              onClick={() =>
                void attempt(() => props.context.call("card.delete", { cardId: card.id })).then(
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
          <Button
            disabled={(card.title ?? "").trim() === ""}
            onClick={() =>
              void props.onSave(card).then((saved) => saved !== null && props.onClose())
            }
            data-staff-card-save
          >
            {t.save}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function StepsDialog(props: { readonly context: StaffContext; readonly onClose: () => void }) {
  const t = useZenText(staffText);
  const { columns } = props.context.overview;
  const [text, setText] = useState(columns.map((column) => column.title).join("\n"));
  const save = () => {
    const titles = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const next = titles.map((title, index) => ({
      id:
        columns.find((column) => column.title === title)?.id ??
        columns[index]?.id ??
        `step-${index + 1}`,
      title,
    }));
    void attempt(() => props.context.call("board.save", { columns: next }), t.saved).then(
      (saved) => {
        if (saved !== null) {
          props.context.refresh();
          props.onClose();
        }
      },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.editSteps}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Field label={t.step} help={t.stepsHelp}>
            <Textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t.cancel}
          </Button>
          <Button onClick={save}>{t.save}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function StaffApprovalsTab(props: { readonly context: StaffContext }) {
  const t = useZenText(staffText);
  const { context } = props;
  const pending = context.overview.approvals.filter((approval) => approval.status === "pending");
  const decided = context.overview.approvals
    .filter((approval) => approval.status !== "pending")
    .slice(0, 20);
  const [writing, setWriting] = useState(false);
  const h = useZenText(staffHomeText);
  return (
    <div className="flex flex-col gap-10">
      <p className="zr-soft max-w-3xl">{h.approvalsIntro}</p>
      <Section title={t.pending}>
        {pending.length === 0 ? (
          <EmptyState icon={InboxIcon} title={h.approvalsEmptyTitle} body={h.approvalsEmptyBody} />
        ) : null}
        <div className="grid gap-4 xl:grid-cols-2" data-staff-approvals>
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} context={context} approval={approval} />
          ))}
        </div>
      </Section>
      {decided.length > 0 ? (
        <Section title={h.decided}>
          <div className="grid gap-4 xl:grid-cols-2">
            {decided.map((approval) => (
              <ApprovalCard key={approval.id} context={context} approval={approval} />
            ))}
          </div>
        </Section>
      ) : null}
      <Section
        title={t.reports}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={writing || context.overview.agents.length === 0}
            onClick={() => {
              setWriting(true);
              void attempt(() => context.call("report.weekly", {})).then(() => {
                setWriting(false);
                context.refresh();
              });
            }}
          >
            {t.writeReports}
          </Button>
        }
      >
        {context.overview.reports.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noReports}</p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2" data-staff-reports>
          {context.overview.reports.slice(0, 8).map((report) => (
            <pre
              key={report.id}
              className="zr-card whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed"
            >
              {report.text}
            </pre>
          ))}
        </div>
      </Section>
    </div>
  );
}

const SEVERITY_CLASS = {
  high: "bg-destructive/15 decoration-destructive",
  medium: "bg-warning/20 decoration-warning",
  low: "bg-info/15 decoration-info",
} as const;

function ApprovalCard(props: { readonly context: StaffContext; readonly approval: StaffApproval }) {
  const t = useZenText(staffText);
  const locale = useZenLocale();
  const { context, approval } = props;
  const openThread = useOpenThread(context.environmentId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const agent = context.overview.agents.find((item) => item.id === approval.agentId);
  const findings = approval.checker?.findings ?? [];
  const issues = findings.filter((finding) => finding.severity !== "low");
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    const done = await attempt(
      () => context.call("approval.decide", { approvalId: approval.id, decision, note }),
      t.saved,
    );
    setBusy(false);
    if (done !== null) context.refresh();
  };
  const h = useZenText(staffHomeText);
  return (
    <div className="zr-card relative flex flex-col gap-3 p-5" data-staff-approval={approval.id}>
      <div className="flex flex-wrap items-center gap-2">
        {agent ? (
          <Avatar name={agent.name} color={agent.color} agent className="size-7 text-xs" />
        ) : null}
        <span className="font-semibold text-sm">{agent?.name ?? approval.agentId}</span>
        {agent ? <span className="zr-muted text-sm">· {agent.role}</span> : null}
        <div className="flex-1" />
        <Tag loud={approval.action === "pay" || approval.action === "delete"}>
          {t.action[approval.action]}
        </Tag>
      </div>
      <p className="zr-h3">{approval.reason || t.action[approval.action]}</p>
      <p className="zr-muted -mt-1 text-sm">
        {t.target}: <span className="text-zr-ink">{approval.target || "-"}</span>
        {" · "}
        {formatWhen(approval.createdAt, locale)}
        {approval.threadId ? (
          <>
            {" · "}
            <button
              type="button"
              className="zr-link"
              onClick={() => openThread(approval.threadId!)}
            >
              {t.openThread}
            </button>
          </>
        ) : null}
      </p>
      <div
        className="zr-sheet whitespace-pre-wrap p-3.5 text-sm leading-relaxed"
        data-staff-approval-content
      >
        {highlightSegments(approval.content, findings).map((segment) =>
          segment.finding ? (
            <mark
              key={segment.start}
              className={cn(
                "rounded px-0.5 text-foreground underline decoration-2 underline-offset-2",
                SEVERITY_CLASS[segment.finding.severity],
              )}
            >
              {segment.text}
            </mark>
          ) : (
            <span key={segment.start}>{segment.text}</span>
          ),
        )}
      </div>
      {approval.checker ? (
        <div className="flex flex-col gap-1.5" data-staff-findings>
          <p
            className={cn(
              "font-medium text-sm",
              issues.length > 0 ? "text-warning-foreground" : "text-success-foreground",
            )}
          >
            {issues.length > 0 ? t.checkerIssues(findings.length) : t.checkerOk}{" "}
            <span className="font-normal text-muted-foreground text-xs">
              ({approval.checker.aiChecked ? t.checkerAi : t.checkerRules})
            </span>
          </p>
          <ul className="flex flex-col gap-1">
            {findings.map((finding) => (
              <li
                key={`${finding.source}-${finding.rule}-${finding.excerpt}-${finding.message}`}
                className="flex items-start gap-2 text-sm"
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-3xs uppercase tracking-wide",
                    SEVERITY_CLASS[finding.severity],
                  )}
                >
                  {t.severity[finding.severity]}
                </span>
                <span>{finding.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {approval.status === "pending" ? (
        <div className="flex flex-col gap-3">
          <Input
            value={note}
            placeholder={t.rejectNote}
            onChange={(event) => setNote(event.target.value)}
            aria-label={t.note}
            data-staff-note
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="zr-btn zr-btn-quiet zr-btn-sm"
              disabled={busy}
              onClick={() => void decide("reject")}
              data-staff-reject
            >
              <XIcon />
              {t.reject}
            </button>
            <button
              type="button"
              className="zr-btn zr-btn-loud zr-btn-sm"
              disabled={busy}
              onClick={() => void decide("approve")}
              data-staff-approve
            >
              <CheckIcon />
              {t.approve}
            </button>
            <div className="flex-1" />
            <Stamp quiet>{h.stampPending}</Stamp>
          </div>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <p className="zr-muted text-xs">
            {approval.status === "approved"
              ? t.approvedBy(approval.decidedBy ?? "", formatWhen(approval.decidedAt, locale))
              : t.rejectedBy(approval.decidedBy ?? "", formatWhen(approval.decidedAt, locale))}
            {approval.decisionNote ? ` · ${approval.decisionNote}` : ""}
          </p>
          <Stamp quiet={approval.status !== "approved"}>
            {approval.status === "approved" ? h.stampApproved : h.stampRejected}
          </Stamp>
        </div>
      )}
    </div>
  );
}
