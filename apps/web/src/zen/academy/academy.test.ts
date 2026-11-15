import type { ZenLesson, ZenLessonManifest } from "@t3tools/contracts/zenAcademy";
import { describe, expect, it } from "vite-plus/test";

import { lessonsByTrack, nextLesson, searchLessons } from "./academyState";
import {
  EMPTY_PROGRESS,
  isLessonDone,
  parseProgress,
  setLessonDone,
  trackProgress,
} from "./progress";
import {
  detectPersonalData,
  detectSecrets,
  isValidCnp,
  looksLikeSecret,
  passesLuhn,
} from "./secretDetection";
import {
  addNoResultSearch,
  addTopics,
  emptySignals,
  sanitizeSearchQuery,
  topicLabelsFor,
} from "./signals";
import { academyMessages } from "./academy.i18n";

const { en, ro } = academyMessages;

import {
  ACADEMY_TIP_RULES,
  EMPTY_TIP_HISTORY,
  matchTip,
  recordTipDismissed,
  recordTipShown,
} from "./tipRules";

const lesson = (
  id: string,
  track: "office" | "code",
  order: number,
  extra: Partial<ZenLessonManifest> = {},
): ZenLesson => ({
  manifest: {
    id,
    track,
    order,
    title: { en: `Title ${id}`, ro: `Titlu ${id}` },
    summary: { en: "Summary", ro: "Rezumat" },
    minutes: 3,
    level: "beginner",
    tags: ["sample"],
    ...extra,
  },
  body: { en: "English body", ro: "Text în română despre parolă" },
  source: "builtin",
  exerciseFiles: [],
});

describe("secret detection", () => {
  const secrets = [
    "AKIAIOSFODNN7EXAMPLQ",
    "my key is ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nabc",
    "postgres://admin:S3cret!pw@db.example.com:5432/app",
    "password: Hunter2024!",
    'DB_PASSWORD="x7#kLm9q"',
    "parola mea este Mamaie#1987",
    "parola: Vara2026!",
    "the password is 83746592",
    "Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    "api_key = 'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY'",
  ];
  it.each(secrets)("flags: %s", (text) => expect(looksLikeSecret(text)).toBe(true));

  const normal = [
    "How do I reset my password?",
    "The password must have at least 8 characters and one digit.",
    "Parola mea e prea slabă, cum fac una bună?",
    "Am uitat parola de la email, ce fac?",
    "token: required",
    "Set API_KEY=<your key> in the .env file.",
    "const token = response.data.token;",
    "password = process.env.DB_PASSWORD",
    "apiKey: getApiKey()",
    "Commit 3f9a2c1d4e5b6a7980c1d2e3f4a5b6c7d8e9f0a1 fixed it",
    "User id 550e8400-e29b-41d4-a716-446655440000",
    "Scrie un comunicat de presă despre deschiderea brutăriei din Cluj, pe 12 noiembrie 2026.",
    "Write a report for October: revenue 48,250 lei, 1,240 orders, see https://example.com/report?id=42",
    "Send it to ana.pop@example.com and call 0722 123 456.",
    "password: ********",
    "secret: [hidden]",
    "Use sk_live_... keys only on the server.",
  ];
  it.each(normal)("ignores: %s", (text) => expect(detectSecrets(text)).toEqual([]));

  it("checks CNP control digits and card numbers with Luhn", () => {
    expect(isValidCnp("1800101221144")).toBe(true);
    expect(isValidCnp("1800101221145")).toBe(false);
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
    expect(detectPersonalData("CNP 1800101221144, card 4111 1111 1111 1111")).toEqual([
      "cnp",
      "card",
    ]);
    expect(detectPersonalData("Order 1234567890123 total 4500 lei, tel 0722123456")).toEqual([]);
  });
});

describe("contextual tips", () => {
  it("suggests the data safety lesson when a key is pasted, with a cooldown", () => {
    const event = {
      trigger: "paste" as const,
      text: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
      edition: "code" as const,
    };
    const first = matchTip(ACADEMY_TIP_RULES, event, EMPTY_TIP_HISTORY, 1_000);
    expect(first?.id).toBe("secret-pasted");
    expect(first?.lessonId).toBe("office-data-safety");
    const history = recordTipShown(EMPTY_TIP_HISTORY, "secret-pasted", 1_000);
    expect(matchTip(ACADEMY_TIP_RULES, event, history, 30_000)).toBeNull();
    expect(matchTip(ACADEMY_TIP_RULES, event, history, 62_000)?.id).toBe("secret-pasted");
    const dismissed = recordTipDismissed(history, "secret-pasted");
    expect(matchTip(ACADEMY_TIP_RULES, event, dismissed, 500_000)).toBeNull();
  });

  it("stays quiet for normal text", () => {
    for (const text of ["Scrie o postare pentru Instagram", "How do I change my password?"]) {
      expect(
        matchTip(
          ACADEMY_TIP_RULES,
          { trigger: "paste", text, edition: "office" },
          EMPTY_TIP_HISTORY,
          0,
        ),
      ).toBeNull();
    }
  });

  it("shows First steps once, only in Office, only when the lesson exists", () => {
    const event = { trigger: "route" as const, path: "/office", edition: "office" as const };
    expect(matchTip(ACADEMY_TIP_RULES, event, EMPTY_TIP_HISTORY, 0)?.id).toBe("first-office");
    expect(
      matchTip(ACADEMY_TIP_RULES, { ...event, edition: "code" }, EMPTY_TIP_HISTORY, 0),
    ).toBeNull();
    const shown = recordTipShown(EMPTY_TIP_HISTORY, "first-office", 0);
    expect(matchTip(ACADEMY_TIP_RULES, event, shown, 10 ** 12)).toBeNull();
    expect(matchTip(ACADEMY_TIP_RULES, event, EMPTY_TIP_HISTORY, 0, new Set(["other"]))).toBeNull();
  });

  it("has copy for every rule in both languages", () => {
    for (const rule of ACADEMY_TIP_RULES) {
      expect(rule.copy(en).title.length).toBeGreaterThan(0);
      expect(rule.copy(ro).title.length).toBeGreaterThan(0);
    }
  });
});

describe("progress", () => {
  it("marks lessons done and not done, and computes track progress", () => {
    const lessons = [
      lesson("office-a", "office", 10),
      lesson("office-b", "office", 20),
      lesson("code-a", "code", 10),
    ];
    let progress = setLessonDone(EMPTY_PROGRESS, "office-a", true, "2026-11-07T10:00:00Z");
    expect(isLessonDone(progress, "office-a")).toBe(true);
    expect(setLessonDone(progress, "office-a", true, "later")).toBe(progress);
    expect(trackProgress(progress, lessons, "office")).toEqual({ done: 1, total: 2, percent: 50 });
    expect(trackProgress(progress, lessons, "code")).toEqual({ done: 0, total: 1, percent: 0 });
    // A done lesson that no longer exists does not count.
    progress = setLessonDone(progress, "office-gone", true, "x");
    expect(trackProgress(progress, lessons, "office").done).toBe(1);
    progress = setLessonDone(progress, "office-a", false, "x");
    expect(isLessonDone(progress, "office-a")).toBe(false);
    expect(trackProgress(progress, [], "office")).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("reads stored progress defensively", () => {
    expect(parseProgress(null)).toEqual({});
    expect(parseProgress("not json")).toEqual({});
    expect(parseProgress("[1]")).toEqual({});
    expect(parseProgress('{"a":{"doneAt":"t"},"b":{"x":1},"c":3}')).toEqual({ a: { doneAt: "t" } });
  });
});

describe("lesson lists", () => {
  const lessons = [
    lesson("office-a", "office", 10, { tags: ["excel"] }),
    lesson("office-b", "office", 20),
    lesson("code-a", "code", 10),
  ];

  it("shows only the Office track in Office and both in Code", () => {
    expect(lessonsByTrack(lessons, "office").map((group) => group.track)).toEqual(["office"]);
    expect(lessonsByTrack(lessons, "code").map((group) => group.track)).toEqual(["office", "code"]);
  });

  it("searches titles, tags and bodies without accents", () => {
    expect(searchLessons(lessons, "excel", "en").map((item) => item.manifest.id)).toEqual([
      "office-a",
    ]);
    expect(searchLessons(lessons, "parola", "ro")).toHaveLength(3);
    expect(searchLessons(lessons, "kubernetes", "en")).toEqual([]);
  });

  it("finds the next lesson in the same track", () => {
    expect(nextLesson(lessons, "office-a")?.manifest.id).toBe("office-b");
    expect(nextLesson(lessons, "office-b")).toBeNull();
  });
});

describe("learning signals (local)", () => {
  it("reduces messages to topic labels only", () => {
    expect(topicLabelsFor("Fă-mi un raport din fișierul Excel cu vânzările")).toEqual([
      "spreadsheets",
      "reports",
    ]);
    expect(topicLabelsFor("Check the RLS policies in Supabase")).toEqual(["database-rls"]);
    expect(topicLabelsFor("Bună dimineața")).toEqual([]);
    const counted = addTopics(addTopics(emptySignals("t"), ["reports"]), ["reports", "email"]);
    expect(counted.topics).toEqual({ reports: 2, email: 1 });
  });

  it("strips names, numbers, links and secrets from no-result searches", () => {
    expect(sanitizeSearchQuery("Facturi în SAGA 2026")).toBe("facturi in saga");
    expect(sanitizeSearchQuery("ana.pop@example.com contract")).toBe("contract");
    expect(sanitizeSearchQuery("https://intranet.local/x kubernetes")).toBe("kubernetes");
    expect(sanitizeSearchQuery("password: Hunter2024!")).toBeNull();
    expect(sanitizeSearchQuery("1800101221144")).toBeNull();
    expect(sanitizeSearchQuery("a")).toBeNull();
    const signals = addNoResultSearch(
      addNoResultSearch(emptySignals("t"), "Kubernetes"),
      "kubernetes ",
    );
    expect(signals.noResultSearches).toEqual({ kubernetes: 2 });
  });
});
