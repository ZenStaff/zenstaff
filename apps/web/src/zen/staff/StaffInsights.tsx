// Zen Staff AI staff: the monthly evaluation (with proposed instruction updates), discovery of
// repeated work (with the printable lost-hours map), the quality tools (checker, estimate,
// customer panel) and the settings (company account, runner, brand and prices).
import type {
  StaffCheckerResult,
  StaffDiscoveryResult,
  StaffEstimate,
  StaffEvaluation,
  StaffOutboundKind,
  StaffSettings,
} from "@t3tools/contracts/zenStaff";
import { useNavigate } from "@tanstack/react-router";
import { LightbulbIcon, PrinterIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { staffText } from "./staff.i18n";
import { staffAccountText } from "./staffAccount.i18n";
import { staffHomeText } from "./staffHome.i18n";
import { StaffCompanyAccountSection } from "./StaffCompanyAccount";
import {
  formatPriceList,
  formatTokens,
  highlightSegments,
  lostHoursReportHtml,
  parsePriceList,
} from "./staffModel";
import { attempt, Avatar, Field, Section, SELECT_CLASS, type StaffContext } from "./staffShared";
import { EstimateBox } from "./StaffTeam";
import { useStaffQuery } from "./staffClient";
import { Bone } from "../ui/Registru";
import { ZenNativeSelect } from "../ui/ZenSelect";

const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
const hours = (minutes: number, locale: string) =>
  (minutes / 60).toLocaleString(locale, { maximumFractionDigits: 1 });

export function StaffEvaluationTab(props: { readonly context: StaffContext }) {
  const t = useZenText(staffText);
  const q = useZenText(staffHomeText);
  const locale = useZenLocale();
  const { context } = props;
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const evaluation = useStaffQuery<StaffEvaluation>(
    context.environmentId,
    context.companyId,
    "evaluation",
    { month },
    { live: true },
  );
  const [proposing, setProposing] = useState<string | null>(null);
  const pending = context.overview.proposals.filter((proposal) => proposal.status === "pending");
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Field label={t.month}>
          <Input
            type="month"
            className="w-44"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-staff-total-saved>
        {(
          [
            [q.kpiTasks, evaluation ? String(evaluation.totals.tasksDone) : null],
            [q.kpiSaved, evaluation ? `${hours(evaluation.totals.minutesSaved, locale)} h` : null],
            [q.kpiTokens, evaluation ? formatTokens(evaluation.totals.tokens, locale) : null],
            [
              q.kpiCost,
              evaluation
                ? evaluation.totals.cost === null
                  ? q.kpiCostSeat
                  : `${evaluation.totals.cost.toFixed(2)} ${evaluation.currency}`
                : null,
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="zr-card flex flex-col gap-1 p-5">
            <span className="zr-muted text-sm">{label}</span>
            {value === null ? (
              <Bone className="mt-1 h-8 w-20" />
            ) : (
              <span
                className={cn(
                  "font-zr-serif tabular-nums",
                  value.length > 12 ? "pt-2 text-lg" : "text-3xl",
                )}
              >
                {value}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="zr-card overflow-x-auto" data-staff-evaluation>
        <table className="w-full text-sm">
          <thead className="zr-muted text-left text-xs">
            <tr>
              {(
                [
                  ["agent", ""],
                  ["done", t.tasksDone],
                  ["tokens", t.tokens],
                  ["cost", t.cost],
                  ["saved", t.timeSaved],
                  ["approved", t.approvalRate],
                  ["rejected", t.rejectionRate],
                  ["ratings", t.ratings],
                  ["score", t.score],
                  ["budget", t.budget],
                  ["actions", ""],
                ] as const
              ).map(([id, label]) => (
                <th key={id} className="px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(evaluation?.rows ?? []).map((row) => {
              const agent = context.overview.agents.find((item) => item.id === row.agentId);
              if (!agent) return null;
              return (
                <tr key={row.agentId} className="border-t">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Avatar
                        name={agent.name}
                        color={agent.color}
                        agent
                        className="size-7 text-xs"
                      />
                      <span className="flex flex-col">
                        <span className="font-medium">{agent.name}</span>
                        <span className="text-muted-foreground text-xs">{agent.role}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.tasksDone}
                    {row.tasksFailed > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        / {q.failedCount(row.tasksFailed)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatTokens(row.tokens, locale)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.cost === null ? "-" : `${row.cost.toFixed(2)} ${evaluation?.currency}`}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {t.hoursShort(hours(row.minutesSaved, locale))}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{percent(row.approvalRate)}</td>
                  <td className="px-3 py-2 tabular-nums">{percent(row.rejectionRate)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.thumbsUp}↑ {row.thumbsDown}↓
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.averageScore === null ? "-" : `${row.averageScore}/5`}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{percent(row.budgetUsed)}</td>
                  <td className="px-3 py-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={proposing === agent.id}
                      onClick={() => {
                        setProposing(agent.id);
                        void attempt(() =>
                          context.call("improve.propose", { agentId: agent.id }),
                        ).then(() => {
                          setProposing(null);
                          context.refresh();
                        });
                      }}
                    >
                      <LightbulbIcon />
                      {t.improve}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Section title={t.proposals} intro={t.improveHelp}>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noProposals}</p>
        ) : null}
        {pending.map((proposal) => {
          const agent = context.overview.agents.find((item) => item.id === proposal.agentId);
          return (
            <div
              key={proposal.id}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4"
              data-staff-proposal
            >
              <p className="font-medium text-sm">
                {agent?.name} · {t.basedOn(proposal.basedOn)}
              </p>
              <ul className="list-disc pl-5 text-sm">
                {proposal.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer text-muted-foreground text-xs">
                  {t.instructions}
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm">{proposal.proposed}</p>
              </details>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void attempt(
                      () =>
                        context.call("improve.decide", { proposalId: proposal.id, approve: true }),
                      t.saved,
                    ).then(() => context.refresh())
                  }
                >
                  {t.applyProposal}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void attempt(() =>
                      context.call("improve.decide", { proposalId: proposal.id, approve: false }),
                    ).then(() => context.refresh())
                  }
                >
                  {t.dismiss}
                </Button>
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

export function StaffDiscoverTab(props: {
  readonly context: StaffContext;
  readonly onHire: (templateId: string | null) => void;
}) {
  const t = useZenText(staffText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const { context } = props;
  const [result, setResult] = useState<StaffDiscoveryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const optIn = context.overview.settings.discoveryOptIn;
  const describe = (suggestion: StaffDiscoveryResult["suggestions"][number]) => {
    const when =
      suggestion.weekday !== null && suggestion.cadence !== "monthly"
        ? t.everyDay(t.weekdays[suggestion.weekday - 1]!)
        : t.cadence[suggestion.cadence];
    const time =
      suggestion.minutesEach >= 60
        ? `${hours(suggestion.minutesEach, locale)} h`
        : `${suggestion.minutesEach} min`;
    return { when, time, text: t.suggestion(suggestion.person, suggestion.label, when, time) };
  };
  const print = () => {
    if (result === null) return;
    const html = lostHoursReportHtml({
      title: t.reportTitle,
      subtitle: t.reportSubtitle(context.overview.companyName),
      total: t.reportTotal(String(result.hoursPerMonth)),
      columns: t.reportColumns,
      rows: result.suggestions.map((suggestion) => {
        const text = describe(suggestion);
        return [
          suggestion.person,
          suggestion.label,
          text.when,
          text.time,
          String(suggestion.hoursPerMonth),
          suggestion.proposal === "agent" ? t.hireForIt : t.makeWorkflow,
        ];
      }),
      footer: t.reportFooter,
      date: new Date().toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB"),
      lang: locale,
      result,
    });
    const page = globalThis.open("", "_blank");
    if (page === null) return;
    page.document.write(html);
    page.document.close();
    page.focus();
    page.print();
  };
  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t.discoverTitle}
        intro={t.discoverIntro}
        actions={
          <div className="flex gap-2">
            {result && result.suggestions.length > 0 ? (
              <Button size="sm" variant="outline" onClick={print} data-staff-print>
                <PrinterIcon />
                {t.printReport}
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={!optIn || busy}
              onClick={() => {
                setBusy(true);
                void attempt(() => context.call<StaffDiscoveryResult>("discovery.run", {})).then(
                  (value) => {
                    setBusy(false);
                    if (value !== null) setResult(value);
                  },
                );
              }}
              data-staff-analyze
            >
              {busy ? t.analyzing : t.analyze}
            </Button>
          </div>
        }
      >
        {!optIn ? (
          <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
            {t.discoverOff}
          </p>
        ) : null}
        {result ? (
          <div className="flex flex-col gap-3" data-staff-discovery>
            <p className="text-muted-foreground text-sm">
              {t.analyzed(result.analyzedThreads)}
              {result.hoursPerMonth > 0
                ? ` · ${t.hoursPerMonth(String(result.hoursPerMonth))}`
                : ""}
            </p>
            {result.suggestions.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.noSuggestions}</p>
            ) : null}
            {result.suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
                data-staff-suggestion
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{describe(suggestion).text}</p>
                  <p className="text-muted-foreground text-sm">
                    {suggestion.count}× · {t.hoursPerMonth(String(suggestion.hoursPerMonth))}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigate({ to: "/workflow-editor" })}
                >
                  {t.makeWorkflow}
                </Button>
                <Button size="sm" onClick={() => props.onHire(suggestion.suggestedTemplateId)}>
                  {t.hireForIt}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

const SEVERITY_CLASS = {
  high: "bg-destructive/15 decoration-destructive",
  medium: "bg-warning/20 decoration-warning",
  low: "bg-info/15 decoration-info",
} as const;

export type StaffQualityTool = "checker" | "estimate" | "panel";

/** One of the three quality tools (the Performance area shows one at a time). */
export function StaffQualityTab(props: {
  readonly context: StaffContext;
  readonly tool: StaffQualityTool;
}) {
  const t = useZenText(staffText);
  const q = useZenText(staffHomeText);
  const locale = useZenLocale();
  const { context } = props;
  const [content, setContent] = useState("");
  const [action, setAction] = useState<StaffOutboundKind>("publish");
  const [target, setTarget] = useState("Facebook");
  const [checked, setChecked] = useState<StaffCheckerResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [agentId, setAgentId] = useState(context.overview.agents[0]?.id ?? "");
  const [taskTitle, setTaskTitle] = useState("");
  const [estimate, setEstimate] = useState<StaffEstimate | null>(null);
  const [sources, setSources] = useState("");
  const [building, setBuilding] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<{
    question: string;
    answers: Array<{ persona: string; answer: string; verdict: "positive" | "mixed" | "negative" }>;
  } | null>(null);
  return (
    <div className="flex flex-col gap-10">
      {props.tool === "checker" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Field label={t.content}>
              <Textarea
                rows={7}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={q.checkerPlaceholder}
                data-staff-checker-text
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={q.whatHappens}>
                <ZenNativeSelect
                  className={SELECT_CLASS}
                  value={action}
                  onChange={(event) => setAction(event.target.value as StaffOutboundKind)}
                >
                  {(["send", "publish", "pay", "delete", "other"] as const).map((kind) => (
                    <option key={kind} value={kind}>
                      {t.action[kind]}
                    </option>
                  ))}
                </ZenNativeSelect>
              </Field>
              <Field label={t.target}>
                <Input
                  className="w-48"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </Field>
              <Button
                disabled={checking || content.trim() === ""}
                onClick={() => {
                  setChecking(true);
                  void attempt(() =>
                    context.call<StaffCheckerResult>("checker.run", { content, action, target }),
                  ).then((value) => {
                    setChecking(false);
                    if (value !== null) setChecked(value);
                  });
                }}
                data-staff-run-checker
              >
                {checking ? t.checking : t.runChecker}
              </Button>
            </div>
          </div>
          {checked ? (
            <div className="flex flex-col gap-2" data-staff-checker-result>
              <div className="whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm leading-relaxed">
                {highlightSegments(content, checked.findings).map((segment) =>
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
              <p className="font-medium text-sm">
                {checked.findings.length === 0
                  ? t.checkerOk
                  : t.checkerIssues(checked.findings.length)}{" "}
                <span className="font-normal text-muted-foreground text-xs">
                  ({checked.aiChecked ? t.checkerAi : t.checkerRules})
                </span>
              </p>
              <ul className="flex flex-col gap-1">
                {checked.findings.map((finding) => (
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
        </div>
      ) : null}
      {props.tool === "estimate" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={q.whichEmployee}>
              <ZenNativeSelect
                className={SELECT_CLASS}
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {context.overview.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.role})
                  </option>
                ))}
              </ZenNativeSelect>
            </Field>
            <Field label={t.taskText}>
              <Input
                className="w-72"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder={q.taskPlaceholder}
              />
            </Field>
            <Button
              variant="outline"
              disabled={agentId === ""}
              onClick={() =>
                void attempt(() =>
                  context.call<StaffEstimate>("task.estimate", { agentId, title: taskTitle }),
                ).then((value) => value && setEstimate(value))
              }
              data-staff-estimate-run
            >
              {t.estimate}
            </Button>
          </div>
          {estimate ? <EstimateBox estimate={estimate} locale={locale} /> : null}
        </div>
      ) : null}
      {props.tool === "panel" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Field label={t.panelSources}>
              <Textarea
                rows={6}
                value={sources}
                onChange={(event) => setSources(event.target.value)}
                data-staff-panel-sources
              />
            </Field>
            <Button
              className="self-start"
              variant="outline"
              disabled={building}
              onClick={() => {
                setBuilding(true);
                void attempt(() => context.call("personas.build", { sources, count: 6 })).then(
                  () => {
                    setBuilding(false);
                    context.refresh();
                  },
                );
              }}
              data-staff-build-panel
            >
              {building ? t.building : t.buildPanel}
            </Button>
            <div className="grid gap-2 sm:grid-cols-2" data-staff-personas>
              {context.overview.personas.map((persona) => (
                <div key={persona.id} className="rounded-lg border bg-card p-3 text-sm">
                  <p className="font-medium">{persona.name}</p>
                  <p className="text-muted-foreground text-xs">{persona.summary}</p>
                  <p className="mt-1 text-xs">
                    <span className="font-medium">{t.cares}:</span> {persona.cares.join(", ")}
                  </p>
                  <p className="text-xs">
                    <span className="font-medium">{t.objections}:</span>{" "}
                    {persona.objections.join(", ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Field label={t.panelQuestion}>
              <Textarea
                rows={3}
                value={question}
                placeholder={t.panelPlaceholder}
                onChange={(event) => setQuestion(event.target.value)}
                data-staff-panel-question
              />
            </Field>
            <Button
              className="self-start"
              disabled={asking || question.trim() === "" || context.overview.personas.length === 0}
              onClick={() => {
                setAsking(true);
                void attempt(() => context.call<typeof answers>("personas.ask", { question })).then(
                  (value) => {
                    setAsking(false);
                    if (value) setAnswers(value);
                  },
                );
              }}
              data-staff-ask-panel
            >
              {asking ? t.asking : t.ask}
            </Button>
            {answers ? (
              <div className="flex flex-col gap-2" data-staff-panel-answers>
                {answers.answers.map((answer) => (
                  <div key={answer.persona} className="rounded-lg border bg-card p-3 text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      {answer.persona}
                      <Badge
                        variant={
                          answer.verdict === "positive"
                            ? "success"
                            : answer.verdict === "negative"
                              ? "error"
                              : "warning"
                        }
                        size="sm"
                      >
                        {t.verdict[answer.verdict]}
                      </Badge>
                    </p>
                    <p className="text-muted-foreground">{answer.answer}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function StaffSettingsTab(props: { readonly context: StaffContext }) {
  const t = useZenText(staffText);
  const navigate = useNavigate();
  const { context } = props;
  const current = context.overview.settings;
  const account = useZenText(staffAccountText);
  const [brandTone, setBrandTone] = useState(current.brand.tone);
  const [banned, setBanned] = useState(current.brand.bannedWords.join(", "));
  const [prices, setPrices] = useState(formatPriceList(current.brand.prices));
  const [price, setPrice] = useState(
    current.pricePerMillionTokens === null ? "" : String(current.pricePerMillionTokens),
  );
  const [currency, setCurrency] = useState(current.currency);
  const save = (settings: Partial<StaffSettings> & Record<string, unknown>) =>
    void attempt(() => context.call("settings.save", { settings }), t.saved).then(() =>
      context.refresh(),
    );
  const runner = context.overview.runner;
  const q = useZenText(staffHomeText);
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <p className="zr-soft">{q.settingsIntro}</p>
      <StaffCompanyAccountSection context={context} />
      <Section title={account.runnerTitle}>
        <p
          className={cn(
            "text-sm",
            runner.isRunner ? "text-success-foreground" : "text-muted-foreground",
          )}
          data-staff-runner
        >
          {runner.isRunner ? account.runnerYes(runner.source) : account.runnerNo}
        </p>
        {!context.overview.companyPlacement.ok ? (
          <div className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm">
            <p className="font-medium">{t.companyNotReady}</p>
            <p className="text-muted-foreground">{context.overview.companyPlacement.message}</p>
          </div>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => void navigate({ to: "/hub", search: {} })}
        >
          {t.openTeam}
        </Button>
      </Section>
      <Section title={t.approvalsTitle}>
        <label className="zr-card flex items-center gap-3 p-4 font-medium text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={current.approvals}
            onChange={(event) => save({ approvals: event.target.checked })}
            data-staff-approvals-switch
          />
          {t.approvalsSwitch}
        </label>
        <p className="zr-muted text-sm">
          {current.approvals ? t.approvalsOnHelp : t.approvalsOffHelp}
        </p>
      </Section>
      <Section title={q.settingsHelpers}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={current.discoveryOptIn}
            onChange={(event) => save({ discoveryOptIn: event.target.checked })}
            data-staff-discovery-optin
          />
          {t.discoverySwitch}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={current.checkerAi}
            onChange={(event) => save({ checkerAi: event.target.checked })}
          />
          {t.checkerSwitch}
        </label>
      </Section>
      <Section title={t.brandTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.tone} className="sm:col-span-2">
            <Textarea
              rows={2}
              value={brandTone}
              onChange={(event) => setBrandTone(event.target.value)}
            />
          </Field>
          <Field label={t.bannedWords} className="sm:col-span-2">
            <Input value={banned} onChange={(event) => setBanned(event.target.value)} />
          </Field>
          <Field label={t.priceList} className="sm:col-span-2">
            <Textarea
              rows={5}
              value={prices}
              onChange={(event) => setPrices(event.target.value)}
              data-staff-prices
            />
          </Field>
          <Field label={t.pricePerMillion}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </Field>
          <Field label={t.currency}>
            <Input
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </Field>
          <Button
            className="justify-self-start"
            onClick={() =>
              save({
                brand: {
                  tone: brandTone,
                  bannedWords: banned
                    .split(",")
                    .map((word) => word.trim())
                    .filter(Boolean),
                  prices: parsePriceList(prices),
                },
                pricePerMillionTokens: price === "" ? null : Number(price),
                currency,
              })
            }
            data-staff-brand-save
          >
            {t.save}
          </Button>
        </div>
      </Section>
    </div>
  );
}
