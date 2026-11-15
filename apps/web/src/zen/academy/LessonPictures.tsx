// Zen Staff Academy: small drawn pictures of the app for lessons (`:::picture <name>`). They are
// built from the Registru tokens, so they follow the light and dark theme and the lesson's
// language, and they never go stale like screenshots. Lucide icons only, no images.
import {
  ArrowRightIcon,
  CheckIcon,
  CircleCheckIcon,
  EyeOffIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  KeyRoundIcon,
  LockIcon,
  MessageSquareIcon,
  NewspaperIcon,
  PlugIcon,
  ShieldAlertIcon,
  SquareIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Stamp } from "../ui/Registru";
import type { LessonPicture as PictureName } from "./lessonSteps";
import type { lessonText } from "./lesson.i18n";

type Pic = (typeof lessonText)["en"]["pic"];

/** Sample values inside the drawings: file names, a site, app names, amounts (the same in every
 * language). */
const SAMPLE = {
  agent: "AI",
  diffFile: "checkout.ts",
  envFile: ".env",
  site: "casa-verde.ro",
  sourceTotal: "Total: 12.480 lei",
  summaryTotal: "Total: 21.480 lei",
  apps: ["Google Drive", "Gmail", "Facebook"],
} as const;

/** The agent: "AI" in a tile (no robots, by the brand rules). */
function AgentMark(props: { readonly large?: boolean }) {
  return (
    <span className={cn("font-bold tracking-tight", props.large ? "text-base" : "text-3xs")}>
      {SAMPLE.agent}
    </span>
  );
}

/** A calm app window: a thin title bar and the content. */
function Frame(props: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className="zr-card overflow-hidden" aria-hidden>
      <div className="zr-rule flex items-center gap-1.5 border-b px-3 py-2">
        <span className="size-2 rounded-full bg-zr-line" />
        <span className="size-2 rounded-full bg-zr-line" />
        <span className="size-2 rounded-full bg-zr-line" />
        {props.title ? <span className="zr-muted ml-2 text-2xs">{props.title}</span> : null}
      </div>
      <div className={cn("flex flex-col gap-3 p-4 text-xs", props.className)}>{props.children}</div>
    </div>
  );
}

function Line(props: { readonly w: string; readonly strong?: boolean }) {
  return (
    <span
      className={cn("block h-2 rounded-full", props.strong ? "bg-zr-ink-3" : "bg-zr-line")}
      style={{ width: props.w }}
    />
  );
}

function Bubble(props: { readonly who: "you" | "agent"; readonly children: ReactNode }) {
  return (
    <div className={cn("flex gap-2", props.who === "you" && "flex-row-reverse")}>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          props.who === "you" ? "bg-zr-ink text-zr-paper" : "zr-tint",
        )}
      >
        {props.who === "you" ? <UserIcon className="size-3.5" /> : <AgentMark />}
      </span>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2",
          props.who === "you" ? "bg-zr-ink text-zr-paper" : "zr-tint",
        )}
      >
        {props.children}
      </div>
    </div>
  );
}

function Steps(props: { readonly items: ReadonlyArray<string>; readonly working?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {props.items.map((item, index) => {
        const last = index === props.items.length - 1;
        return (
          <li key={item} className="zr-soft flex items-center gap-2">
            {last && props.working ? (
              <span className="size-3.5 animate-pulse rounded-full border-2 border-zr-ink-3" />
            ) : (
              <CircleCheckIcon className="size-3.5 text-zr-ok" />
            )}
            {item}
          </li>
        );
      })}
    </ul>
  );
}

function Toggle(props: { readonly on: boolean }) {
  return (
    <span
      className={cn(
        "flex h-4.5 w-8 items-center rounded-full p-0.5 transition-colors",
        props.on ? "justify-end bg-zr-ink" : "justify-start bg-zr-line",
      )}
    >
      <span className="size-3.5 rounded-full bg-zr-card" />
    </span>
  );
}

const PICTURES: Record<PictureName, (pic: Pic) => ReactNode> = {
  "office-cards": (pic) => (
    <Frame title={pic.office}>
      <div className="zr-sheet flex items-center gap-2 rounded-full px-3 py-2">
        <span className="zr-muted flex-1">{pic.ask}</span>
        <span className="flex size-6 items-center justify-center rounded-full bg-zr-loud text-white">
          <ArrowRightIcon className="size-3.5" />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {pic.cards.map((card, index) => (
          <div
            key={card}
            className={cn(
              "zr-sheet flex flex-col gap-2 p-2.5",
              index === 0 && "ring-2 ring-zr-loud",
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-zr-ink text-zr-paper">
              {index === 0 ? (
                <NewspaperIcon className="size-3.5" />
              ) : index === 1 ? (
                <FileSpreadsheetIcon className="size-3.5" />
              ) : (
                <MessageSquareIcon className="size-3.5" />
              )}
            </span>
            <span className="font-semibold text-xs leading-tight">{card}</span>
            <Line w="80%" />
          </div>
        ))}
      </div>
    </Frame>
  ),
  chat: (pic) => (
    <Frame>
      <Bubble who="you">{pic.chatAsk}</Bubble>
      <Bubble who="agent">
        <Steps items={pic.chatSteps} working />
      </Bubble>
    </Frame>
  ),
  stop: (pic) => (
    <Frame>
      <Bubble who="agent">
        <Steps items={pic.chatSteps} working />
      </Bubble>
      <div className="zr-sheet flex items-center gap-2 rounded-full px-3 py-2">
        <span className="zr-muted flex-1">{pic.working}…</span>
        <span className="flex items-center gap-1.5 rounded-full bg-zr-loud px-3 py-1 font-semibold text-white">
          <SquareIcon className="size-3 fill-current" />
          {pic.stop}
        </span>
      </div>
    </Frame>
  ),
  folder: (pic) => (
    <Frame>
      <div className="flex items-center gap-4">
        <div className="zr-sheet flex flex-1 flex-col gap-2 p-3">
          <span className="flex items-center gap-2 font-semibold">
            <FolderIcon className="size-4" />
            {pic.folder}
          </span>
          {["sedinta.md", "preturi.xlsx", "de-facut.txt"].map((file) => (
            <span key={file} className="zr-soft flex items-center gap-2 pl-5">
              <FileTextIcon className="size-3.5" />
              {file}
            </span>
          ))}
        </div>
        <ArrowRightIcon className="zr-muted size-5 shrink-0" />
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-zr-ink text-zr-paper">
          <AgentMark large />
        </span>
      </div>
      <span className="zr-muted flex items-center gap-2 text-xs">
        <PlugIcon className="size-3.5" />
        {pic.connected}
      </span>
    </Frame>
  ),
  approval: (pic) => (
    <Frame>
      <div className="relative flex flex-col gap-2">
        <span className="font-semibold">{pic.approval}</span>
        <div className="zr-sheet flex flex-col gap-1.5 p-2.5">
          <Line w="90%" />
          <Line w="70%" />
        </div>
        <div className="flex items-center gap-2">
          <span className="zr-sheet flex items-center gap-1 rounded-full px-2.5 py-1">
            <XIcon className="size-3" />
            {pic.reject}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-zr-loud px-2.5 py-1 font-semibold text-white">
            <CheckIcon className="size-3" />
            {pic.approve}
          </span>
          <span className="flex-1" />
          <Stamp>{pic.approved}</Stamp>
        </div>
      </div>
    </Frame>
  ),
  connect: () => (
    <Frame>
      {SAMPLE.apps.map((app, index) => (
        <div key={app} className="flex items-center gap-3">
          <span className="zr-tint flex size-7 items-center justify-center rounded-lg">
            <PlugIcon className="size-3.5" />
          </span>
          <span className="flex-1 font-medium">{app}</span>
          <Toggle on={index < 2} />
        </div>
      ))}
    </Frame>
  ),
  check: (pic) => (
    <Frame>
      <div className="grid grid-cols-2 gap-3">
        <div className="zr-sheet flex flex-col gap-1.5 p-3">
          <span className="zr-muted text-2xs">{pic.source}</span>
          <span className="font-mono text-xs">{SAMPLE.sourceTotal}</span>
          <Line w="70%" />
        </div>
        <div className="zr-sheet flex flex-col gap-1.5 p-3">
          <span className="zr-muted text-2xs">{pic.summary}</span>
          <span className="relative w-fit font-mono text-xs">
            {SAMPLE.summaryTotal}
            <svg
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              className="absolute -inset-x-2 -inset-y-1.5 h-[calc(100%+12px)] w-[calc(100%+16px)] overflow-visible"
            >
              <ellipse
                cx="50"
                cy="20"
                rx="48"
                ry="17"
                fill="none"
                stroke="var(--zr-loud)"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                transform="rotate(-3 50 20)"
              />
            </svg>
          </span>
          <Line w="70%" />
        </div>
      </div>
    </Frame>
  ),
  iterate: (pic) => (
    <Frame>
      <div className="flex items-stretch gap-2">
        {pic.rounds.map((round, index) => (
          <div key={round} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "zr-sheet flex flex-1 flex-col gap-1.5 p-2.5",
                index === 2 && "ring-2 ring-zr-ink",
              )}
            >
              <span className="font-semibold text-xs">{round}</span>
              <Line w="90%" />
              <Line w={index === 0 ? "85%" : "60%"} />
              {index < 2 ? (
                <span className="zr-muted text-2xs">“{pic.feedback[index]}”</span>
              ) : (
                <span className="text-2xs text-zr-ok">{pic.feedback[2]}</span>
              )}
            </div>
            {index < 2 ? <ArrowRightIcon className="zr-muted size-4 shrink-0" /> : null}
          </div>
        ))}
      </div>
    </Frame>
  ),
  workflow: (pic) => (
    <Frame>
      {pic.workflowFields.map((field, index) => (
        <div key={field} className="flex flex-col gap-1">
          <span className="font-semibold text-xs">{field}</span>
          <div className="zr-sheet flex flex-col gap-1.5 px-2.5 py-2">
            <Line w={index === 0 ? "40%" : "85%"} />
            {index === 2 ? <Line w="65%" /> : null}
          </div>
        </div>
      ))}
    </Frame>
  ),
  shared: (pic) => (
    <Frame>
      <div className="grid grid-cols-2 gap-3">
        {[
          { title: pic.company, rows: pic.sharedRows, icon: UsersIcon },
          { title: pic.personal, rows: pic.personalRows, icon: UserIcon },
        ].map((column) => (
          <div key={column.title} className="zr-sheet flex flex-col gap-2 p-3">
            <span className="flex items-center gap-2 font-semibold">
              <column.icon className="size-4" />
              {column.title}
            </span>
            {column.rows.map((row) => (
              <span key={row} className="zr-soft text-xs">
                {row}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  ),
  "data-safety": (pic) => (
    <Frame>
      <div className="grid grid-cols-2 gap-3">
        <div className="zr-sheet flex flex-col gap-1.5 p-3">
          <span className="flex items-center gap-1.5 font-semibold text-zr-ok">
            <CheckIcon className="size-4" />
            {pic.safe}
          </span>
          {pic.safeRows.map((row) => (
            <span key={row} className="zr-soft text-xs">
              {row}
            </span>
          ))}
        </div>
        <div className="zr-sheet flex flex-col gap-1.5 p-3">
          <span className="flex items-center gap-1.5 font-semibold text-zr-loud-text">
            <LockIcon className="size-4" />
            {pic.notSafe}
          </span>
          {pic.unsafeRows.map((row) => (
            <span key={row} className="zr-soft text-xs">
              {row}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  ),
  "code-diff": () => (
    <Frame title={SAMPLE.diffFile}>
      <div className="flex flex-col font-mono text-xs leading-6">
        <span className="zr-muted px-2"> const order = await getOrder(id);</span>
        <span className="rounded bg-zr-loud-soft px-2 text-zr-loud-text">
          - if (!user.canPay(order)) throw denied();
        </span>
        <span className="rounded bg-zr-ok-soft px-2 text-zr-ok">+ await chargeCard(order);</span>
        <span className="zr-muted px-2"> return order;</span>
      </div>
    </Frame>
  ),
  secrets: () => (
    <Frame title={SAMPLE.envFile}>
      <div className="flex flex-col gap-1.5 font-mono text-xs">
        <span className="flex items-center gap-2">
          <KeyRoundIcon className="zr-muted size-3.5" />
          STRIPE_KEY=
          <span className="rounded bg-zr-tint px-1.5">sk_live_••••••••••••</span>
          <EyeOffIcon className="zr-muted size-3.5" />
        </span>
        <span className="zr-muted pl-5.5">DATABASE_URL=••••••••</span>
        <span className="zr-muted pl-5.5"># .gitignore: .env</span>
      </div>
    </Frame>
  ),
  permissions: (pic) => (
    <Frame>
      {pic.modes.map((mode, index) => (
        <div
          key={mode}
          className={cn("flex items-center gap-3 rounded-xl px-2 py-1.5", index === 0 && "zr-tint")}
        >
          <span
            className={cn(
              "flex size-4 items-center justify-center rounded-full border-2",
              index === 0 ? "border-zr-ink" : "border-zr-line",
            )}
          >
            {index === 0 ? <span className="size-1.5 rounded-full bg-zr-ink" /> : null}
          </span>
          <span className="flex-1 font-medium">{mode}</span>
          <span className={cn("text-2xs", index === 2 ? "text-zr-loud-text" : "zr-muted")}>
            {pic.modesHelp[index]}
          </span>
        </div>
      ))}
    </Frame>
  ),
  injection: (pic) => (
    <Frame title={SAMPLE.site}>
      <span className="zr-h3">{pic.pageText}</span>
      <Line w="80%" />
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-zr-loud px-2.5 py-2 text-xs">
        <ShieldAlertIcon className="size-4 shrink-0 text-zr-loud-text" />
        <span className="zr-muted">{pic.hiddenLabel}:</span>
        <span className="italic">{pic.hidden}</span>
      </div>
    </Frame>
  ),
};

export function LessonPictureView(props: {
  readonly name: PictureName;
  readonly caption: string | null;
  readonly pic: Pic;
}) {
  return (
    <figure className="flex flex-col gap-2" data-lesson-picture={props.name}>
      <div className="mx-auto w-full max-w-xl">{PICTURES[props.name](props.pic)}</div>
      {props.caption ? (
        <figcaption className="zr-muted text-center text-sm">{props.caption}</figcaption>
      ) : null}
    </figure>
  );
}
