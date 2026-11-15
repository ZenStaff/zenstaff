// @effect-diagnostics nodeBuiltinImport:off - reads the built-in lesson files on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { lessonStructureProblems, pairDoDont, parseLesson, splitFrontMatter } from "./lessonSteps";

describe("splitFrontMatter", () => {
  it("reads the learn list and leaves the body", () => {
    const { learn, body } = splitFrontMatter("---\nlearn:\n  - One\n  - Two\n---\n## Step\nText");
    expect(learn).toEqual(["One", "Two"]);
    expect(body).toBe("## Step\nText");
  });
  it("accepts an inline list separated by semicolons and CRLF line ends", () => {
    expect(splitFrontMatter("---\r\nlearn: A; B\r\n---\r\nx").learn).toEqual(["A", "B"]);
  });
  it("leaves text without front matter alone", () => {
    expect(splitFrontMatter("## Only\nbody")).toEqual({ learn: [], body: "## Only\nbody" });
  });
});

describe("parseLesson", () => {
  const source = [
    "---",
    "learn:",
    "  - Ask well",
    "---",
    "Intro line.",
    "",
    "## First",
    "Some **text**.",
    ":::example A good ask",
    "Read the file.",
    ":::",
    ":::dont",
    "Make a report.",
    ":::",
    ":::do",
    "Read sales.xlsx and list the top 5.",
    ":::",
    "## Second",
    ":::picture chat",
    "The thread.",
    ":::",
    ":::try",
    "Open the practice folder.",
    ":::",
    ":::quiz",
    "Which is better?",
    "- A vague ask",
    "+ A precise ask",
    "> Precise asks need fewer rounds.",
    ":::",
  ].join("\n");

  it("splits steps, blocks, pairs and the quiz", () => {
    const lesson = parseLesson(source);
    expect(lesson.learn).toEqual(["Ask well"]);
    expect(lesson.intro).toBe("Intro line.");
    expect(lesson.problems).toEqual([]);
    expect(lesson.steps.map((step) => step.title)).toEqual(["First", "Second"]);
    expect(lesson.steps[0]!.blocks).toEqual([
      { kind: "markdown", text: "Some **text**." },
      { kind: "example", title: "A good ask", text: "Read the file." },
      { kind: "pair", dont: "Make a report.", do: "Read sales.xlsx and list the top 5." },
    ]);
    expect(lesson.steps[1]!.blocks).toEqual([
      { kind: "picture", name: "chat", caption: "The thread." },
      { kind: "try", text: "Open the practice folder." },
    ]);
    expect(lesson.quiz).toEqual([
      {
        question: "Which is better?",
        options: [
          { text: "A vague ask", correct: false },
          { text: "A precise ask", correct: true },
        ],
        explanation: "Precise asks need fewer rounds.",
      },
    ]);
  });

  it("keeps an old lesson without markers working: every heading is a step", () => {
    const lesson = parseLesson("## One\nA\n\n## Two\n- b\n- c\n");
    expect(lesson.steps).toEqual([
      { title: "One", blocks: [{ kind: "markdown", text: "A" }] },
      { title: "Two", blocks: [{ kind: "markdown", text: "- b\n- c" }] },
    ]);
    expect(lesson.quiz).toEqual([]);
  });

  it("reports unknown blocks and pictures, unclosed blocks and quizzes with no right answer", () => {
    const lesson = parseLesson(
      "## S\n:::banner\nx\n:::\n:::picture robot\n:::\n:::quiz\nQ?\n- a\n- b\n:::\n:::tip\nopen",
    );
    expect(lesson.problems).toEqual([
      'Unknown block ":::banner".',
      'Unknown picture "robot".',
      'The quiz "Q?" has no right answer (mark it "- [x] ").',
      'The ":::tip" block is not closed with ":::".',
    ]);
    // The unknown block's text is kept as plain text, the unclosed tip still shows.
    expect(lesson.steps[0]!.blocks).toEqual([
      { kind: "markdown", text: "x" },
      { kind: "tip", text: "open" },
    ]);
  });

  it("does not pair a do and a dont that are apart", () => {
    expect(
      pairDoDont([
        { kind: "do", text: "a" },
        { kind: "markdown", text: "m" },
        { kind: "dont", text: "b" },
      ]).map((block) => block.kind),
    ).toEqual(["do", "markdown", "dont"]);
  });
});

describe("built-in lessons", () => {
  const root = NodePath.resolve(import.meta.dirname, "../../../../server/src/zen/academy/lessons");
  const folders = NodeFS.readdirSync(root).filter((name) =>
    NodeFS.statSync(NodePath.join(root, name)).isDirectory(),
  );

  it("finds the lessons", () => {
    expect(folders.length).toBeGreaterThanOrEqual(20);
  });

  const cases = folders.flatMap((folder) =>
    (["ro", "en"] as const)
      .map((locale) => ({ folder, locale, file: NodePath.join(root, folder, `${locale}.md`) }))
      .filter((entry) => NodeFS.existsSync(entry.file)),
  );
  it.each(cases)(
    "$folder ($locale) has steps, what you learn and a short quiz",
    ({ folder, file }) => {
      const text = NodeFS.readFileSync(file, "utf8");
      const manifest = JSON.parse(
        NodeFS.readFileSync(NodePath.join(root, folder, "lesson.json"), "utf8"),
      ) as { tryIt?: unknown };
      const lesson = parseLesson(text);
      expect(lessonStructureProblems(text)).toEqual([]);
      expect(lesson.learn.length).toBeGreaterThanOrEqual(2);
      expect(lesson.steps.length).toBeGreaterThanOrEqual(3);
      expect(lesson.quiz.length).toBeGreaterThanOrEqual(1);
      expect(lesson.quiz.length).toBeLessThanOrEqual(3);
      const tries = lesson.steps.flatMap((step) => step.blocks).filter((b) => b.kind === "try");
      expect(tries.length).toBe(manifest.tryIt ? 1 : 0);
    },
  );
});
