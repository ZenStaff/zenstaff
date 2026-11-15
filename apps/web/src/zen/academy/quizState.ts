// Zen Staff Academy: the short check at the end of a lesson (1-3 questions). Pure state: pick an
// answer per question, check them all at once, see which were right with the explanation, retry
// only the wrong ones. Tested in quizState.test.ts.
import type { QuizQuestion } from "./lessonSteps";

export interface QuizState {
  /** The chosen option per question (null: not answered yet). */
  readonly answers: ReadonlyArray<number | null>;
  readonly checked: boolean;
}

export function initialQuiz(questions: ReadonlyArray<QuizQuestion>): QuizState {
  return { answers: questions.map(() => null), checked: false };
}

/** Picks an answer. After a check, a question that was right stays locked. */
export function chooseAnswer(
  state: QuizState,
  questions: ReadonlyArray<QuizQuestion>,
  question: number,
  option: number,
): QuizState {
  if (question < 0 || question >= state.answers.length) return state;
  if (option < 0 || option >= (questions[question]?.options.length ?? 0)) return state;
  if (state.checked) return state;
  const answers = state.answers.map((answer, index) => (index === question ? option : answer));
  return { ...state, answers };
}

export function canCheck(state: QuizState): boolean {
  return !state.checked && state.answers.length > 0 && state.answers.every((a) => a !== null);
}

export function checkQuiz(state: QuizState): QuizState {
  return canCheck(state) ? { ...state, checked: true } : state;
}

export function isAnswerRight(
  state: QuizState,
  questions: ReadonlyArray<QuizQuestion>,
  question: number,
): boolean {
  const answer = state.answers[question];
  return (
    answer !== null &&
    answer !== undefined &&
    questions[question]?.options[answer]?.correct === true
  );
}

export function quizScore(
  state: QuizState,
  questions: ReadonlyArray<QuizQuestion>,
): { readonly right: number; readonly total: number; readonly passed: boolean } {
  const right = questions.filter((_, index) => isAnswerRight(state, questions, index)).length;
  return { right, total: questions.length, passed: state.checked && right === questions.length };
}

/** Try again: the right answers stay, the wrong ones are cleared. */
export function retryQuiz(state: QuizState, questions: ReadonlyArray<QuizQuestion>): QuizState {
  return {
    answers: state.answers.map((answer, index) =>
      isAnswerRight(state, questions, index) ? answer : null,
    ),
    checked: false,
  };
}
