import { describe, expect, it } from "vite-plus/test";

import type { QuizQuestion } from "./lessonSteps";
import {
  canCheck,
  checkQuiz,
  chooseAnswer,
  initialQuiz,
  isAnswerRight,
  quizScore,
  retryQuiz,
} from "./quizState";

const questions: QuizQuestion[] = [
  {
    question: "One?",
    options: [
      { text: "a", correct: false },
      { text: "b", correct: true },
    ],
    explanation: null,
  },
  {
    question: "Two?",
    options: [
      { text: "c", correct: true },
      { text: "d", correct: false },
      { text: "e", correct: false },
    ],
    explanation: "Because.",
  },
];

describe("quiz state", () => {
  it("checks only when every question has an answer", () => {
    let state = initialQuiz(questions);
    expect(canCheck(state)).toBe(false);
    state = chooseAnswer(state, questions, 0, 1);
    expect(checkQuiz(state)).toBe(state);
    state = chooseAnswer(state, questions, 1, 2);
    expect(canCheck(state)).toBe(true);
    state = checkQuiz(state);
    expect(state.checked).toBe(true);
    expect(quizScore(state, questions)).toEqual({ right: 1, total: 2, passed: false });
    expect(isAnswerRight(state, questions, 0)).toBe(true);
    expect(isAnswerRight(state, questions, 1)).toBe(false);
  });

  it("locks answers after the check and keeps the right ones on retry", () => {
    let state = checkQuiz(
      chooseAnswer(chooseAnswer(initialQuiz(questions), questions, 0, 1), questions, 1, 2),
    );
    expect(chooseAnswer(state, questions, 1, 0)).toBe(state);
    state = retryQuiz(state, questions);
    expect(state).toEqual({ answers: [1, null], checked: false });
    state = checkQuiz(chooseAnswer(state, questions, 1, 0));
    expect(quizScore(state, questions)).toEqual({ right: 2, total: 2, passed: true });
  });

  it("ignores answers out of range", () => {
    const state = initialQuiz(questions);
    expect(chooseAnswer(state, questions, 5, 0)).toBe(state);
    expect(chooseAnswer(state, questions, 0, 9)).toBe(state);
  });

  it("an unchecked quiz never counts as passed", () => {
    const state = chooseAnswer(
      chooseAnswer(initialQuiz(questions), questions, 0, 1),
      questions,
      1,
      0,
    );
    expect(quizScore(state, questions).passed).toBe(false);
  });
});
