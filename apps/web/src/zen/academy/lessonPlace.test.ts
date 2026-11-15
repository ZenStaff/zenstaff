import { describe, expect, it } from "vite-plus/test";

import { continueLesson, parseLessonPlace } from "./lessonPlace";

const lessons = ["a", "b", "c"].map((id) => ({ manifest: { id } }));

describe("parseLessonPlace", () => {
  it("reads a stored place and drops bad ones", () => {
    expect(parseLessonPlace('{"lessonId":"a","step":2,"steps":5,"at":"x"}')).toEqual({
      lessonId: "a",
      step: 2,
      steps: 5,
      at: "x",
    });
    expect(parseLessonPlace('{"lessonId":"a","step":9,"steps":5,"at":"x"}')?.step).toBe(5);
    expect(parseLessonPlace('{"lessonId":"a","step":-1,"steps":5,"at":"x"}')).toBeNull();
    expect(parseLessonPlace("not json")).toBeNull();
    expect(parseLessonPlace(null)).toBeNull();
  });
});

describe("continueLesson", () => {
  const place = { lessonId: "b", step: 1, steps: 4, at: "x" };
  it("continues the lesson last opened when it is not done", () => {
    expect(continueLesson(place, lessons, () => false)?.lesson.manifest.id).toBe("b");
  });
  it("otherwise offers the first lesson not done", () => {
    const done = new Set(["a", "b"]);
    const next = continueLesson(place, lessons, (id) => done.has(id));
    expect(next?.lesson.manifest.id).toBe("c");
    expect(next?.place).toBeNull();
  });
  it("returns null when everything is done", () => {
    expect(continueLesson(null, lessons, () => true)).toBeNull();
  });
});
