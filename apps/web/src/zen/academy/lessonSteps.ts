// Zen Staff Academy: a lesson's markdown as steps, examples, do/don't pairs, pictures, an exercise
// and a short quiz. Front matter `learn:` lists what you learn; every "## " heading starts a step;
// blocks open with ":::example|do|dont|tip|warn|picture|try|quiz" and close with ":::". Pure; the
// format is in ZEN.md ("Academy lesson format") and the 20 built-in lessons use it.
const LESSON_PICTURES = [
  "office-cards",
  "chat",
  "stop",
  "folder",
  "approval",
  "connect",
  "check",
  "iterate",
  "workflow",
  "shared",
  "data-safety",
  "code-diff",
  "secrets",
  "permissions",
  "injection",
] as const;
export type LessonPicture = (typeof LESSON_PICTURES)[number];

export type LessonBlock =
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "example"; readonly title: string | null; readonly text: string }
  | { readonly kind: "do" | "dont" | "tip" | "warn" | "try"; readonly text: string }
  | { readonly kind: "pair"; readonly dont: string; readonly do: string }
  | { readonly kind: "picture"; readonly name: LessonPicture; readonly caption: string | null };

export interface LessonStep {
  readonly title: string;
  readonly blocks: ReadonlyArray<LessonBlock>;
}

export interface QuizOption {
  readonly text: string;
  readonly correct: boolean;
}

export interface QuizQuestion {
  readonly question: string;
  readonly options: ReadonlyArray<QuizOption>;
  readonly explanation: string | null;
}

export interface StructuredLesson {
  readonly learn: ReadonlyArray<string>;
  readonly intro: string | null;
  readonly steps: ReadonlyArray<LessonStep>;
  readonly quiz: ReadonlyArray<QuizQuestion>;
  /** Plain-language problems for lesson authors (unknown blocks, a quiz with no right answer...). */
  readonly problems: ReadonlyArray<string>;
}

const BLOCK_KINDS = ["example", "do", "dont", "tip", "warn", "picture", "try", "quiz"] as const;
type BlockKind = (typeof BLOCK_KINDS)[number];
const isBlockKind = (value: string): value is BlockKind =>
  (BLOCK_KINDS as ReadonlyArray<string>).includes(value);
const isPicture = (value: string): value is LessonPicture =>
  (LESSON_PICTURES as ReadonlyArray<string>).includes(value);

/** Splits "---\n...\n---" front matter from the body. Only `learn:` (a list) is read. */
export function splitFrontMatter(source: string): {
  readonly learn: ReadonlyArray<string>;
  readonly body: string;
} {
  const text = source.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { learn: [], body: text };
  const learn: string[] = [];
  let inLearn = false;
  for (const line of match[1]!.split("\n")) {
    const key = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (key) {
      inLearn = key[1] === "learn";
      if (inLearn && key[2]!.trim()) {
        learn.push(
          ...key[2]!
            .split(";")
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }
      continue;
    }
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (inLearn && item) learn.push(item[1]!.trim());
  }
  return { learn, body: text.slice(match[0].length) };
}

function parseQuiz(text: string, problems: string[]): QuizQuestion | null {
  const question: string[] = [];
  const options: QuizOption[] = [];
  const explanation: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // "- [x]" / "- [ ]" (a task list, which the Markdown formatter keeps as written); "+ " / "- "
    // still read, but the formatter rewrites "+" lists, so lessons use the task list.
    const task = /^[-*+] \[([ xX])\] (.*)$/.exec(line);
    if (task) options.push({ text: task[2]!.trim(), correct: task[1] !== " " });
    else if (line.startsWith("+ ")) options.push({ text: line.slice(2).trim(), correct: true });
    else if (line.startsWith("- ")) options.push({ text: line.slice(2).trim(), correct: false });
    else if (line.startsWith("> ")) explanation.push(line.slice(2).trim());
    else if (options.length === 0) question.push(line);
    else explanation.push(line);
  }
  const label = question.join(" ") || "(no question)";
  if (question.length === 0) problems.push("A quiz block has no question.");
  if (options.length < 2) problems.push(`The quiz "${label}" needs at least 2 answers.`);
  if (!options.some((option) => option.correct)) {
    problems.push(`The quiz "${label}" has no right answer (mark it "- [x] ").`);
  }
  if (question.length === 0 || options.length < 2) return null;
  return {
    question: question.join(" "),
    options,
    explanation: explanation.length > 0 ? explanation.join(" ") : null,
  };
}

/** Parses a lesson body. Lessons without markers still work: each "## " heading is a step. */
export function parseLesson(source: string): StructuredLesson {
  const { learn, body } = splitFrontMatter(source);
  const problems: string[] = [];
  const quiz: QuizQuestion[] = [];
  const steps: Array<{ title: string; blocks: LessonBlock[] }> = [];
  const intro: string[] = [];
  let current: { title: string; blocks: LessonBlock[] } | null = null;
  let markdown: string[] = [];
  let open: { kind: string; arg: string; lines: string[] } | null = null;

  const flushMarkdown = () => {
    const text = markdown.join("\n").trim();
    markdown = [];
    if (!text) return;
    if (current) current.blocks.push({ kind: "markdown", text });
    else intro.push(text);
  };
  const push = (block: LessonBlock) => {
    if (current) {
      current.blocks.push(block);
      return;
    }
    // Blocks before the first heading get an untitled step so nothing is lost.
    current = { title: "", blocks: [block] };
    steps.push(current);
  };
  const closeBlock = (block: { kind: string; arg: string; lines: string[] }) => {
    const text = block.lines.join("\n").trim();
    if (!isBlockKind(block.kind)) {
      problems.push(`Unknown block ":::${block.kind}".`);
      if (text) markdown.push(text);
      return;
    }
    flushMarkdown();
    switch (block.kind) {
      case "quiz": {
        const question = parseQuiz(text, problems);
        if (question) quiz.push(question);
        return;
      }
      case "picture": {
        if (!isPicture(block.arg)) {
          problems.push(`Unknown picture "${block.arg}".`);
          return;
        }
        push({ kind: "picture", name: block.arg, caption: text || null });
        return;
      }
      case "example":
        push({ kind: "example", title: block.arg || null, text });
        return;
      default:
        if (!text && block.kind !== "try") {
          problems.push(`The ":::${block.kind}" block is empty.`);
          return;
        }
        push({ kind: block.kind, text });
    }
  };

  for (const line of body.split("\n")) {
    if (open) {
      if (/^:::\s*$/.test(line)) {
        const block = open;
        open = null;
        closeBlock(block);
      } else open.lines.push(line);
      continue;
    }
    const start = /^:::\s*([a-z-]+)\s*(.*)$/.exec(line);
    if (start) {
      open = { kind: start[1]!, arg: start[2]!.trim(), lines: [] };
      continue;
    }
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushMarkdown();
      current = { title: heading[1]!, blocks: [] };
      steps.push(current);
      continue;
    }
    markdown.push(line);
  }
  if (open) {
    problems.push(`The ":::${(open as { kind: string }).kind}" block is not closed with ":::".`);
    closeBlock(open);
  }
  flushMarkdown();

  return {
    learn,
    intro: intro.length > 0 ? intro.join("\n\n") : null,
    steps: steps
      .map((step) => ({ title: step.title, blocks: pairDoDont(step.blocks) }))
      .filter((step) => step.blocks.length > 0),
    quiz,
    problems,
  };
}

/** A "dont" directly followed by a "do" (or the other way round) becomes one side-by-side pair. */
export function pairDoDont(blocks: ReadonlyArray<LessonBlock>): LessonBlock[] {
  const out: LessonBlock[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const next = blocks[index + 1];
    if (block.kind === "dont" && next?.kind === "do") {
      out.push({ kind: "pair", dont: block.text, do: next.text });
      index++;
    } else if (block.kind === "do" && next?.kind === "dont") {
      out.push({ kind: "pair", dont: next.text, do: block.text });
      index++;
    } else out.push(block);
  }
  return out;
}

/** Problems an author should fix: parse problems plus the shape the lesson page expects. */
export function lessonStructureProblems(source: string): string[] {
  const lesson = parseLesson(source);
  const problems = [...lesson.problems];
  if (lesson.steps.length === 0) problems.push("The lesson has no steps (start one with '## ').");
  if (lesson.steps.some((step) => step.title === "")) {
    problems.push("Start the lesson text with a '## ' heading.");
  }
  if (lesson.quiz.length > 3) problems.push("Use at most 3 quiz questions.");
  return problems;
}
