// Zen Staff Academy: `/academy`. Index: "Continuă de unde ai rămas", tracks with progress, lesson
// cards, search (no-result searches feed the opt-in learning signals). A lesson: hero, short steps
// (examples, "Nu așa / Așa da", drawn pictures, "Încearcă acum"), a stepper, a short check, the
// next lesson. Lesson format: lessonSteps.ts.
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  localized,
  lessonBody,
  practiceFileName,
  tryItUsesExercise,
  type ZenAcademyLocale,
  type ZenAcademyTrack,
  type ZenLesson,
} from "@t3tools/contracts/zenAcademy";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BuildingIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  FlaskConicalIcon,
  FolderIcon,
  GraduationCapIcon,
  LightbulbIcon,
  MessageSquareQuoteIcon,
  PlayIcon,
  SearchIcon,
  ShieldCheckIcon,
  BriefcaseIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";

import ChatMarkdown from "../../components/ChatMarkdown";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { companyOfProject } from "../companies/companiesModel";
import { officeWorkflows } from "../office/officeState";
import { OfficePageShell } from "../office/OfficePageShell";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { useZenEdition } from "../office/useZenEdition";
import {
  academyLessons,
  lessonsByTrack,
  lessonsInput,
  nextLesson,
  searchLessons,
} from "./academyState";
import { isLessonDone, markLesson, trackProgress, useAcademyProgress } from "./progress";
import { recordNoResultSearch, useAcademySignals } from "./signals";
import {
  setAcademyLocale,
  useAcademyLocale,
  useAcademyStrings,
  type AcademyStrings,
} from "./academy.i18n";
import { useAcademyTryIt, type TryItTarget } from "./useAcademyTryIt";
import { cn } from "../../lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { useZenText } from "../i18n/zenI18n";
import { Bone, EmptyState, PageHeading, PenWord, Stamp, Tag } from "../ui/Registru";
import { lessonText } from "./lesson.i18n";
import { LessonPictureView } from "./LessonPictures";
import {
  continueLesson,
  getLessonPlace,
  rememberLessonPlace,
  useLessonPlace,
  type LessonPlace,
} from "./lessonPlace";
import { parseLesson, type LessonBlock, type QuizQuestion } from "./lessonSteps";
import {
  canCheck,
  checkQuiz,
  chooseAnswer,
  initialQuiz,
  isAnswerRight,
  quizScore,
  retryQuiz,
  type QuizState,
} from "./quizState";
import { useIsInternalFolder } from "../office/useInternalFolders";

const TRACK_ICONS: Record<ZenAcademyTrack, typeof BriefcaseIcon> = {
  office: BriefcaseIcon,
  code: ShieldCheckIcon,
};

export function AcademyPage(props: { readonly lessonId?: string | undefined }) {
  const environmentId = usePrimaryEnvironmentId();
  const strings = useAcademyStrings();
  const locale = useAcademyLocale();
  return (
    <OfficePageShell
      title={strings.pageTitle}
      registru
      actions={
        <ToggleGroup
          value={[locale]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "en" || next === "ro") setAcademyLocale(next);
          }}
          aria-label={strings.language}
        >
          <ToggleGroupItem value="ro">RO</ToggleGroupItem>
          <ToggleGroupItem value="en">EN</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {environmentId === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{strings.pageTitle}</EmptyTitle>
            <EmptyDescription>{strings.notConnected}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AcademyContent environmentId={environmentId} lessonId={props.lessonId} />
      )}
    </OfficePageShell>
  );
}

function AcademyContent(props: {
  readonly environmentId: EnvironmentId;
  readonly lessonId: string | undefined;
}) {
  const strings = useAcademyStrings();
  const locale = useAcademyLocale();
  const edition = useZenEdition();
  const company = useOfficeCompany();
  const lessonsAtom = academyLessons({
    environmentId: props.environmentId,
    input: lessonsInput(company.companyId),
  });
  const result = useAtomValue(lessonsAtom);
  const retry = useAtomRefresh(lessonsAtom);
  if (result._tag === "Failure") {
    return <AcademyEmptyState strings={strings} title={strings.loadFailed} onRetry={retry} />;
  }
  if (!AsyncResult.isSuccess(result)) {
    return (
      <div className="flex flex-col gap-10" aria-busy>
        <div className="flex flex-col gap-3">
          <Bone className="h-10 w-2/3" />
          <Bone className="h-4 w-1/2" />
        </div>
        <Bone className="h-44 w-full rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="zr-card flex flex-col gap-3 p-5">
              <Bone className="size-9 rounded-full" />
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const groups = lessonsByTrack(result.value.lessons, edition);
  const visible = groups.flatMap((group) => group.lessons);
  if (visible.length === 0) {
    return (
      <AcademyEmptyState
        strings={strings}
        title={strings.emptyTitle}
        problems={result.value.problems}
        onRetry={retry}
      />
    );
  }
  const open = props.lessonId
    ? visible.find((lesson) => lesson.manifest.id === props.lessonId)
    : undefined;
  if (open) {
    return (
      <LessonReader
        environmentId={props.environmentId}
        lesson={open}
        next={nextLesson(visible, open.manifest.id)}
        companyId={company.companyId}
      />
    );
  }
  return (
    <LessonIndex
      environmentId={props.environmentId}
      companyId={company.companyId}
      groups={groups}
      locale={locale}
      strings={strings}
      problems={result.value.problems}
    />
  );
}

/** Shown instead of a blank page when the lessons fail to load or none came back. */
function AcademyEmptyState(props: {
  readonly strings: AcademyStrings;
  readonly title: string;
  readonly problems?: ReadonlyArray<{ location: string; message: string }>;
  readonly onRetry: () => void;
}) {
  const { strings } = props;
  return (
    <Empty className="mt-6" data-academy-empty>
      <EmptyHeader>
        <GraduationCapIcon className="size-8 text-muted-foreground" aria-hidden />
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{strings.emptyBody}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" onClick={props.onRetry}>
        {strings.retry}
      </Button>
      {props.problems && props.problems.length > 0 ? (
        <ul className="text-muted-foreground text-xs" data-zen-no-translate>
          {props.problems.map((problem) => (
            <li key={problem.location}>{problem.message}</li>
          ))}
        </ul>
      ) : null}
    </Empty>
  );
}

function LessonIndex(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string | null;
  readonly groups: ReturnType<typeof lessonsByTrack>;
  readonly locale: ZenAcademyLocale;
  readonly strings: AcademyStrings;
  readonly problems: ReadonlyArray<{ location: string; message: string }>;
}) {
  const { strings, locale } = props;
  const l = useZenText(lessonText);
  const [query, setQuery] = useState("");
  const progress = useAcademyProgress();
  const place = useLessonPlace();
  const { optedIn } = useAcademySignals();
  const filtered = props.groups
    .map((group) => ({ ...group, matches: searchLessons(group.lessons, query, locale) }))
    .filter((group) => query.trim() === "" || group.matches.length > 0);
  const noResults = query.trim().length > 0 && filtered.length === 0;
  const [recorded, setRecorded] = useState<string | null>(null);
  const all = props.groups.flatMap((group) => group.lessons);
  const resume = continueLesson(place, all, (id) => isLessonDone(progress, id));

  // A search that stays empty for a moment counts once (only its sanitized words, when opted in).
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a debounce timer: a search that stays empty for 1.5 s is counted once
  useEffect(() => {
    if (!noResults || !optedIn) return;
    const pending = query;
    const timer = setTimeout(() => {
      if (recordNoResultSearch(pending)) setRecorded(pending);
    }, 1500);
    return () => clearTimeout(timer);
  }, [noResults, optedIn, query]);

  return (
    <div className="flex flex-col gap-12">
      <PageHeading
        title={
          <>
            {l.indexTitle[0]} <PenWord>{l.indexTitle[1]}</PenWord>
          </>
        }
        subtitle={l.indexSub}
        actions={
          <label className="zr-search w-full sm:w-72">
            <SearchIcon className="zr-muted size-4 shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.searchPlaceholder}
              aria-label={strings.searchLabel}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zr-ink-4"
            />
          </label>
        }
      />
      {query.trim() === "" ? (
        resume ? (
          <ContinueCard
            lesson={resume.lesson}
            place={resume.place}
            locale={locale}
            strings={strings}
          />
        ) : (
          <p className="zr-sheet zr-soft p-5 text-sm">{l.allDone}</p>
        )
      ) : null}
      {noResults ? (
        <EmptyState
          icon={SearchIcon}
          title={strings.noResults(query.trim())}
          body={
            <>
              {strings.noResultsHint}
              {optedIn && recorded === query ? (
                <span className="mt-1 block text-xs">{strings.noResultsRecorded}</span>
              ) : null}
            </>
          }
        />
      ) : null}
      {filtered.map((group) => {
        const stats = trackProgress(progress, group.lessons, group.track);
        const Icon = TRACK_ICONS[group.track];
        return (
          <section
            key={group.track}
            className="flex flex-col gap-5"
            aria-label={strings.tracks[group.track]}
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="zr-h2 flex items-center gap-2.5">
                  <Icon className="size-5" aria-hidden />
                  {strings.tracks[group.track]}
                </h3>
                <p className="zr-muted max-w-2xl text-sm">
                  {strings.trackDescriptions[group.track]}
                </p>
              </div>
              <div
                className="flex w-60 flex-col gap-1.5"
                data-testid={`academy-progress-${group.track}`}
              >
                <span className="zr-muted text-xs">{l.lessonsDone(stats.done, stats.total)}</span>
                <div
                  className="zr-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={stats.percent}
                  aria-label={strings.tracks[group.track]}
                >
                  <span style={{ width: `${stats.percent}%` }} />
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.matches.map((lesson) => (
                <LessonCard
                  key={lesson.manifest.id}
                  lesson={lesson}
                  number={group.lessons.indexOf(lesson) + 1}
                  done={isLessonDone(progress, lesson.manifest.id)}
                  locale={locale}
                  strings={strings}
                />
              ))}
            </div>
          </section>
        );
      })}
      {props.problems.length > 0 ? (
        <details className="zr-muted text-xs">
          <summary>{strings.problemsSummary(props.problems.length)}</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {props.problems.map((problem) => (
              <li key={problem.location}>
                {problem.location}: {problem.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Opens a lesson, remembering it for "Continuă de unde ai rămas" (at the step left, if any). */
function useOpenLesson() {
  const navigate = useNavigate();
  return (lesson: ZenLesson, locale: ZenAcademyLocale) => {
    const place = getLessonPlace();
    const structured = parseLesson(lessonBody(lesson, locale));
    const steps = structured.steps.length + (structured.quiz.length > 0 ? 1 : 0);
    rememberLessonPlace(
      lesson.manifest.id,
      place?.lessonId === lesson.manifest.id ? place.step : 0,
      Math.max(steps, 1),
    );
    void navigate({ to: "/academy", search: { lesson: lesson.manifest.id } });
  };
}

function ContinueCard(props: {
  readonly lesson: ZenLesson;
  readonly place: LessonPlace | null;
  readonly locale: ZenAcademyLocale;
  readonly strings: AcademyStrings;
}) {
  const l = useZenText(lessonText);
  const open = useOpenLesson();
  const { manifest } = props.lesson;
  const percent =
    props.place === null ? 0 : Math.round((props.place.step / props.place.steps) * 100);
  return (
    <section
      className="zr-art flex flex-wrap items-end gap-6 px-7 py-8 sm:px-10"
      data-testid="academy-continue"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="zr-soft text-sm font-semibold">
          {props.place ? l.continueTitle : l.startTitle}
        </span>
        <h3 className="zr-title text-3xl!">{localized(manifest.title, props.locale)}</h3>
        <p className="zr-soft max-w-2xl">{localized(manifest.summary, props.locale)}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="zr-soft inline-flex items-center gap-1.5">
            <ClockIcon className="size-4" aria-hidden />
            {l.minutes(manifest.minutes)}
          </span>
          <Tag>{props.strings.levels[manifest.level]}</Tag>
          {props.place ? (
            <span className="zr-soft">
              {l.continueStep(Math.min(props.place.step + 1, props.place.steps), props.place.steps)}
            </span>
          ) : null}
        </div>
        {props.place ? (
          <div className="zr-progress zr-progress-loud max-w-md" aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="zr-btn zr-btn-loud"
        onClick={() => open(props.lesson, props.locale)}
        data-testid="academy-continue-open"
      >
        {props.place ? l.continueButton : l.startButton}
        <ArrowRightIcon />
      </button>
    </section>
  );
}

function LessonCard(props: {
  readonly lesson: ZenLesson;
  readonly number: number;
  readonly done: boolean;
  readonly locale: ZenAcademyLocale;
  readonly strings: AcademyStrings;
}) {
  const l = useZenText(lessonText);
  const open = useOpenLesson();
  const { manifest } = props.lesson;
  return (
    <button
      type="button"
      onClick={() => open(props.lesson, props.locale)}
      className="zr-card zr-card-hover flex w-full flex-col gap-3 p-5 text-left"
      data-testid={`academy-lesson-${manifest.id}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-full font-zr-serif text-base",
            props.done ? "bg-zr-ink text-zr-paper" : "zr-tint text-zr-ink",
          )}
          aria-hidden
        >
          {props.done ? <CheckIcon className="size-4" /> : props.number}
        </span>
        <span className="flex flex-wrap justify-end gap-1.5">
          {props.lesson.source === "company" ? (
            <Tag>
              <BuildingIcon className="size-3" aria-hidden />
              {props.strings.companyBadge}
            </Tag>
          ) : null}
          {props.done ? <Tag>{l.lessonDone}</Tag> : null}
        </span>
      </span>
      <span className="line-clamp-2 font-semibold text-base leading-snug">
        {localized(manifest.title, props.locale)}
      </span>
      <span className="zr-muted line-clamp-2 text-sm leading-relaxed">
        {localized(manifest.summary, props.locale)}
      </span>
      <span className="flex-1" />
      <span className="zr-rule zr-muted flex items-center gap-3 border-t pt-3 text-xs">
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="size-3.5" aria-hidden />
          {l.minutes(manifest.minutes)}
        </span>
        <LevelDots level={manifest.level} label={props.strings.levels[manifest.level]} />
      </span>
    </button>
  );
}

const LEVEL_DOTS: Record<ZenLesson["manifest"]["level"], number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

/** The level as one to three dots and its word. */
function LevelDots(props: {
  readonly level: ZenLesson["manifest"]["level"];
  readonly label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((dot) => (
          <span
            key={dot}
            className={cn(
              "size-1.5 rounded-full",
              dot <= LEVEL_DOTS[props.level] ? "bg-zr-ink" : "bg-zr-line",
            )}
          />
        ))}
      </span>
      {props.label}
    </span>
  );
}

function LessonReader(props: {
  readonly environmentId: EnvironmentId;
  readonly lesson: ZenLesson;
  readonly next: ZenLesson | null;
  readonly companyId: string | null;
}) {
  const strings = useAcademyStrings();
  const l = useZenText(lessonText);
  const locale = useAcademyLocale();
  const navigate = useNavigate();
  const openLesson = useOpenLesson();
  const progress = useAcademyProgress();
  const { manifest } = props.lesson;
  const done = isLessonDone(progress, manifest.id);
  const structured = parseLesson(lessonBody(props.lesson, locale));
  const hasQuiz = structured.quiz.length > 0;
  const total = structured.steps.length + (hasQuiz ? 1 : 0);
  const [step, setStep] = useState(() => {
    const place = getLessonPlace();
    return place?.lessonId === manifest.id ? Math.min(place.step, Math.max(total - 1, 0)) : 0;
  });
  const [quiz, setQuiz] = useState<QuizState>(() => initialQuiz(structured.quiz));
  const [trying, setTrying] = useState(false);
  const [tryError, setTryError] = useState<string | null>(null);
  const [tryBusy, setTryBusy] = useState(false);
  const tryItApi = useAcademyTryIt(props.environmentId, strings);
  // Chat-first: a lesson with a practice folder (or a page to open) starts at once; one that runs
  // in the person's own folder asks where first.
  const tryNow = async () => {
    const tryIt = manifest.tryIt;
    if (!tryIt) return;
    if (tryIt.kind !== "open" && !tryItUsesExercise(tryIt)) {
      setTrying(true);
      return;
    }
    setTryError(null);
    setTryBusy(true);
    const failure = await tryItApi.run({
      lesson: props.lesson,
      target: { kind: "practice" },
      locale,
      companyId: props.companyId,
      workflows: [],
    });
    setTryBusy(false);
    if (failure) setTryError(failure);
  };
  const go = (next: number) => {
    const bounded = Math.max(0, Math.min(next, total - 1));
    setStep(bounded);
    rememberLessonPlace(manifest.id, bounded, total);
    document.querySelector("[data-testid=academy-reader]")?.scrollIntoView({ block: "start" });
  };
  const onQuizStep = hasQuiz && step === structured.steps.length;
  const current = onQuizStep ? null : structured.steps[step];

  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-8" data-testid="academy-reader">
      <button
        type="button"
        className="zr-link flex w-fit items-center gap-1.5 text-sm"
        onClick={() => void navigate({ to: "/academy", search: {} })}
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {l.backToLessons}
      </button>
      {step > 0 ? (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="zr-muted text-sm">{strings.tracks[manifest.track]}</span>
            <h2 className="zr-h2 text-3xl!">{localized(manifest.title, locale)}</h2>
          </div>
          <span className="zr-muted inline-flex items-center gap-1.5 text-sm">
            <ClockIcon className="size-4" aria-hidden />
            {l.minutes(manifest.minutes)}
          </span>
        </header>
      ) : (
        <header className="zr-art grid gap-8 px-7 py-9 sm:px-10 lg:grid-cols-[1fr_18rem]">
          <div className="flex flex-col gap-3">
            <span className="zr-soft text-sm font-semibold">{strings.tracks[manifest.track]}</span>
            <h2 className="zr-title">{localized(manifest.title, locale)}</h2>
            <p className="zr-soft max-w-2xl text-base leading-relaxed">
              {localized(manifest.summary, locale)}
            </p>
            <div className="zr-soft flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon className="size-4" aria-hidden />
                {l.minutes(manifest.minutes)}
              </span>
              <LevelDots level={manifest.level} label={strings.levels[manifest.level]} />
              {done ? (
                <span className="inline-flex items-center gap-1 font-semibold text-zr-ok">
                  <CheckCircle2Icon className="size-4" aria-hidden />
                  {l.doneBadge}
                </span>
              ) : null}
            </div>
          </div>
          {structured.learn.length > 0 ? (
            <div className="zr-card flex flex-col gap-3 self-start p-5" data-testid="academy-learn">
              <span className="font-semibold">{l.youWillLearn}</span>
              <ul className="flex flex-col gap-2 text-sm">
                {structured.learn.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-zr-loud" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </header>
      )}
      {structured.intro && step === 0 ? (
        <div className="zr-prose">
          <ChatMarkdown text={structured.intro} cwd={undefined} />
        </div>
      ) : null}
      <LessonStepper
        steps={structured.steps.map((item) => item.title)}
        hasQuiz={hasQuiz}
        current={step}
        onGo={go}
      />
      <section
        className="zr-card flex flex-col gap-6 p-6 sm:p-9"
        data-testid="academy-step"
        aria-live="polite"
      >
        {current ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="zr-muted text-sm">
                {l.stepOf(step + 1, structured.steps.length)}
              </span>
              <h3 className="zr-h2 text-2xl!">{current.title}</h3>
            </div>
            {current.blocks.map((block) => (
              <LessonBlockView
                key={blockKey(block)}
                block={block}
                lesson={props.lesson}
                onTry={() => void tryNow()}
                tryBusy={tryBusy}
                tryError={tryError}
              />
            ))}
          </>
        ) : (
          <LessonQuiz
            questions={structured.quiz}
            state={quiz}
            onChange={setQuiz}
            onPassed={() => {
              if (!done) markLesson(manifest.id, true);
            }}
          />
        )}
        {!hasQuiz && step === total - 1 && !done ? (
          <div className="zr-sheet flex flex-wrap items-center gap-3 p-4">
            <span className="zr-soft flex-1 text-sm">{l.noQuiz}</span>
            <button
              type="button"
              className="zr-btn zr-btn-ink zr-btn-sm"
              onClick={() => markLesson(manifest.id, true)}
            >
              <CheckCircle2Icon />
              {l.markDone}
            </button>
          </div>
        ) : null}
      </section>
      <nav className="flex flex-wrap items-center gap-3">
        {step > 0 ? (
          <button type="button" className="zr-btn zr-btn-quiet" onClick={() => go(step - 1)}>
            <ArrowLeftIcon />
            {l.previous}
          </button>
        ) : null}
        <div className="flex-1" />
        {step < total - 1 ? (
          <button
            type="button"
            className="zr-btn zr-btn-ink"
            onClick={() => go(step + 1)}
            data-testid="academy-next-step"
          >
            {hasQuiz && step === total - 2 ? l.toQuiz : l.next}
            <ArrowRightIcon />
          </button>
        ) : props.next ? (
          <button
            type="button"
            className={cn("zr-btn", done ? "zr-btn-loud" : "zr-btn-quiet")}
            onClick={() => openLesson(props.next!, locale)}
            data-testid="academy-next-lesson"
          >
            {l.nextLesson}: {localized(props.next.manifest.title, locale)}
            <ArrowRightIcon />
          </button>
        ) : (
          <button
            type="button"
            className="zr-btn zr-btn-quiet"
            onClick={() => void navigate({ to: "/academy", search: {} })}
          >
            {l.finishTrack}
          </button>
        )}
      </nav>
      {trying ? (
        <TryItDialog
          environmentId={props.environmentId}
          lesson={props.lesson}
          companyId={props.companyId}
          onClose={() => setTrying(false)}
        />
      ) : null}
    </article>
  );
}

/** Numbered segments, one per step and one for the check; the done ones in ink. */
function LessonStepper(props: {
  readonly steps: ReadonlyArray<string>;
  readonly hasQuiz: boolean;
  readonly current: number;
  readonly onGo: (step: number) => void;
}) {
  const l = useZenText(lessonText);
  const labels = [...props.steps, ...(props.hasQuiz ? [l.checkStep] : [])];
  return (
    <ol
      className="flex gap-1.5"
      aria-label={l.stepOf(props.current + 1, labels.length)}
      data-testid="academy-stepper"
    >
      {labels.map((label, index) => (
        <li key={label} className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={() => props.onGo(index)}
            className="group flex w-full min-w-0 flex-col gap-2 text-left"
            aria-current={index === props.current ? "step" : undefined}
          >
            <span
              className={cn(
                "h-1.5 w-full rounded-full transition-colors",
                index < props.current
                  ? "bg-zr-ink"
                  : index === props.current
                    ? "bg-zr-loud"
                    : "bg-zr-line group-hover:bg-zr-ink-4",
              )}
            />
            <span
              className={cn(
                "hidden truncate text-xs lg:block",
                index === props.current ? "font-semibold text-zr-ink" : "zr-muted",
              )}
            >
              {label}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A stable key for a step's block (its kind and text). */
function blockKey(block: LessonBlock): string {
  switch (block.kind) {
    case "pair":
      return `pair:${block.dont}:${block.do}`;
    case "picture":
      return `picture:${block.name}:${block.caption ?? ""}`;
    case "example":
      return `example:${block.title ?? ""}:${block.text}`;
    default:
      return `${block.kind}:${block.text}`;
  }
}

function LessonBlockView(props: {
  readonly block: LessonBlock;
  readonly lesson: ZenLesson;
  readonly onTry: () => void;
  readonly tryBusy: boolean;
  readonly tryError: string | null;
}) {
  const l = useZenText(lessonText);
  const { block } = props;
  const markdown = (text: string) => <ChatMarkdown text={text} cwd={undefined} />;
  switch (block.kind) {
    case "markdown":
      return <div className="zr-prose">{markdown(block.text)}</div>;
    case "picture":
      return <LessonPictureView name={block.name} caption={block.caption} pic={l.pic} />;
    case "example":
      return (
        <div className="zr-sheet flex flex-col gap-2 border-l-4 border-l-zr-ink p-5">
          <span className="flex items-center gap-2 font-semibold text-sm">
            <MessageSquareQuoteIcon className="size-4" aria-hidden />
            {block.title ?? l.example}
          </span>
          <div className="zr-prose">{markdown(block.text)}</div>
        </div>
      );
    case "pair":
      return (
        <div className="grid gap-3 md:grid-cols-2" data-lesson-pair>
          <DoDont kind="dont" text={block.dont} />
          <DoDont kind="do" text={block.do} />
        </div>
      );
    case "do":
    case "dont":
      return <DoDont kind={block.kind} text={block.text} />;
    case "tip":
    case "warn":
      return (
        <div
          className={cn(
            "flex gap-3 rounded-2xl p-4",
            block.kind === "warn" ? "bg-zr-loud-soft" : "zr-tint",
          )}
        >
          {block.kind === "warn" ? (
            <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-zr-loud-text" aria-hidden />
          ) : (
            <LightbulbIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          )}
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-sm">{block.kind === "warn" ? l.warn : l.tip}</span>
            <div className="zr-prose text-base!">{markdown(block.text)}</div>
          </div>
        </div>
      );
    case "try":
      return (
        <div
          className="flex flex-wrap items-center gap-5 rounded-2xl border-2 border-zr-ink p-5"
          data-lesson-try
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="zr-h3 flex items-center gap-2">
              <FlaskConicalIcon className="size-4.5" aria-hidden />
              {l.exercise}
            </span>
            {block.text ? <div className="zr-prose text-base!">{markdown(block.text)}</div> : null}
            <span className="zr-muted text-xs">{l.tryNowHint}</span>
            {props.tryError ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {props.tryError}
              </p>
            ) : null}
          </div>
          {props.lesson.manifest.tryIt ? (
            <button
              type="button"
              className="zr-btn zr-btn-loud"
              onClick={props.onTry}
              disabled={props.tryBusy}
              data-testid="academy-try-it"
            >
              {props.tryBusy ? <Spinner className="size-4" /> : <PlayIcon />}
              {props.tryBusy ? l.tryStarting : l.tryNow}
            </button>
          ) : null}
        </div>
      );
  }
}

function DoDont(props: { readonly kind: "do" | "dont"; readonly text: string }) {
  const l = useZenText(lessonText);
  const dont = props.kind === "dont";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border p-4",
        dont ? "border-zr-line bg-zr-sheet" : "border-zr-ink bg-zr-card",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 font-semibold text-sm",
          dont ? "text-zr-loud-text" : "text-zr-ok",
        )}
      >
        {dont ? (
          <XIcon className="size-4" aria-hidden />
        ) : (
          <CheckIcon className="size-4" aria-hidden />
        )}
        {dont ? l.dont : l.do}
      </span>
      <div className={cn("zr-prose text-base!", dont && "opacity-80")}>
        <ChatMarkdown text={props.text} cwd={undefined} />
      </div>
    </div>
  );
}

function LessonQuiz(props: {
  readonly questions: ReadonlyArray<QuizQuestion>;
  readonly state: QuizState;
  readonly onChange: (state: QuizState) => void;
  readonly onPassed: () => void;
}) {
  const l = useZenText(lessonText);
  const { questions, state } = props;
  const score = quizScore(state, questions);
  return (
    <div className="flex flex-col gap-6" data-testid="academy-quiz">
      <div className="flex flex-col gap-1">
        <h3 className="zr-h2 text-2xl!">{l.quizTitle}</h3>
        <p className="zr-muted text-sm">{l.quizSub}</p>
      </div>
      {questions.map((question, qIndex) => {
        const answered = state.answers[qIndex];
        const right = state.checked && isAnswerRight(state, questions, qIndex);
        return (
          <fieldset key={question.question} className="flex flex-col gap-2.5">
            <legend className="mb-2 font-semibold text-base">
              {qIndex + 1}. {question.question}
            </legend>
            {question.options.map((option, oIndex) => {
              const chosen = answered === oIndex;
              const showRight = state.checked && chosen && option.correct;
              const showWrong = state.checked && chosen && !option.correct;
              return (
                <label
                  key={option.text}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-base transition-colors",
                    chosen ? "border-zr-ink" : "border-zr-line hover:bg-zr-tint",
                    showRight && "border-zr-ok bg-zr-ok-soft",
                    showWrong && "border-zr-loud bg-zr-loud-soft",
                    state.checked && "cursor-default",
                  )}
                >
                  <input
                    type="radio"
                    className="size-4 accent-zr-ink"
                    name={`quiz-${qIndex}`}
                    checked={chosen}
                    disabled={state.checked}
                    onChange={() => props.onChange(chooseAnswer(state, questions, qIndex, oIndex))}
                  />
                  <span className="flex-1">{option.text}</span>
                  {showRight ? <CheckIcon className="size-4 text-zr-ok" aria-hidden /> : null}
                  {showWrong ? <XIcon className="size-4 text-zr-loud-text" aria-hidden /> : null}
                </label>
              );
            })}
            {state.checked ? (
              <p className={cn("text-sm", right ? "text-zr-ok" : "text-zr-loud-text")}>
                <span className="font-semibold">{right ? l.quizRight : l.quizWrong}</span>{" "}
                {right ? question.explanation : null}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-4">
        {!state.checked ? (
          <button
            type="button"
            className="zr-btn zr-btn-loud"
            disabled={!canCheck(state)}
            onClick={() => {
              const next = checkQuiz(state);
              props.onChange(next);
              if (quizScore(next, questions).passed) props.onPassed();
            }}
            data-testid="academy-quiz-check"
          >
            <CheckIcon />
            {l.quizCheck}
          </button>
        ) : score.passed ? (
          <span className="flex items-center gap-3">
            <Stamp pop>{l.quizScore(score.right, score.total)}</Stamp>
            <span className="zr-soft text-sm">{l.quizPassed}</span>
          </span>
        ) : (
          <>
            <span className="zr-soft text-sm">{l.quizScore(score.right, score.total)}</span>
            <button
              type="button"
              className="zr-btn zr-btn-quiet"
              onClick={() => props.onChange(retryQuiz(state, questions))}
            >
              {l.quizRetry}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const projectKey = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;
const PRACTICE = "practice";

function TryItDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly lesson: ZenLesson;
  readonly companyId: string | null;
  readonly onClose: () => void;
}) {
  const strings = useAcademyStrings();
  const locale = useAcademyLocale();
  const company = useOfficeCompany();
  const tryIt = props.lesson.manifest.tryIt!;
  const tryItApi = useAcademyTryIt(props.environmentId, strings);
  const workflowsResult = useAtomValue(
    officeWorkflows({ environmentId: props.environmentId, input: company.workflowsInput }),
  );
  const workflows = AsyncResult.isSuccess(workflowsResult) ? workflowsResult.value.workflows : [];
  const isInternal = useIsInternalFolder();
  const projects = useProjects()
    .filter((project) => project.environmentId === props.environmentId)
    .filter((project) => project.archivedAt == null && !isInternal(project))
    .filter(
      (project) =>
        company.companyId === null ||
        companyOfProject(company.index, project.environmentId, project.id) === company.companyId,
    );
  const practice = tryItUsesExercise(tryIt);
  const [target, setTarget] = useState<string>(
    practice ? PRACTICE : projects[0] ? projectKey(projects[0]) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const chosenProject = projects.find((project) => projectKey(project) === target) ?? null;
  const title = localized(props.lesson.manifest.title, locale);

  const message =
    tryIt.kind === "prompt" || tryIt.kind === "audit"
      ? tryItApi.preview(tryIt, chosenProject, locale)
      : null;

  const workflowName =
    tryIt.kind === "workflow"
      ? (workflows.find((workflow) => workflow.manifest.id === tryIt.workflow)?.manifest.name ??
        tryIt.workflow)
      : "";

  const start = async () => {
    const resolved: TryItTarget | null =
      tryIt.kind === "open"
        ? { kind: "practice" }
        : target === PRACTICE
          ? { kind: "practice" }
          : chosenProject
            ? { kind: "project", project: chosenProject }
            : null;
    if (resolved === null) {
      setError(strings.noFolders);
      return;
    }
    setError(null);
    setStarting(true);
    const failure = await tryItApi.run({
      lesson: props.lesson,
      target: resolved,
      locale,
      companyId: props.companyId,
      workflows,
    });
    setStarting(false);
    if (failure) setError(failure);
    else props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !starting && props.onClose()}>
      <DialogPopup className="sm:max-w-lg" data-testid="academy-try-it-dialog">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <FlaskConicalIcon className="size-4.5 text-primary" aria-hidden />
              {strings.tryItTitle(title)}
            </span>
          </DialogTitle>
          <DialogDescription>
            {tryIt.kind === "workflow"
              ? strings.tryItWorkflow(workflowName)
              : tryIt.kind === "open"
                ? strings.openPage(tryIt.to)
                : tryIt.kind === "audit" && message?.usedCommand
                  ? strings.tryItAuditCommand(tryIt.command)
                  : tryIt.kind === "audit"
                    ? strings.tryItAuditFallback(tryIt.command)
                    : strings.tryItPrompt}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            {message ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">
                {message.text}
              </pre>
            ) : null}
            {tryIt.kind !== "open" ? (
              <div className="flex flex-col gap-2">
                <label className="text-muted-foreground text-sm" htmlFor="academy-target">
                  {strings.runIn}
                </label>
                <Select value={target} onValueChange={(value) => setTarget(value ?? "")}>
                  <SelectTrigger id="academy-target" aria-label={strings.runIn}>
                    <FolderIcon aria-hidden className="size-4 text-muted-foreground" />
                    <SelectValue>
                      {target === PRACTICE
                        ? tryIt.kind === "audit"
                          ? strings.practiceProject
                          : strings.practiceFolder
                        : (chosenProject?.title ?? strings.chooseFolder)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {practice ? (
                      <SelectItem value={PRACTICE}>
                        {tryIt.kind === "audit" ? strings.practiceProject : strings.practiceFolder}
                      </SelectItem>
                    ) : null}
                    {projects.map((project) => (
                      <SelectItem key={projectKey(project)} value={projectKey(project)}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {target === PRACTICE ? (
                  <p className="text-muted-foreground text-xs">
                    {strings.tryItPracticeNote}{" "}
                    <span className="text-foreground/80">
                      {strings.tryItPracticeFiles}:{" "}
                      {props.lesson.exerciseFiles.map(practiceFileName).join(", ")}
                    </span>
                  </p>
                ) : null}
                {!practice && projects.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{strings.noFolders}</p>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose} disabled={starting}>
            {strings.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            data-testid="academy-try-it-start"
          >
            <PlayIcon />
            {starting ? strings.starting : strings.start}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
