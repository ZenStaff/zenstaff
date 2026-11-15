import { describe, expect, it } from "vite-plus/test";

import {
  COMPANY_API_KEY_REQUIRED,
  companyKeyEnv,
  companyWorkRefusal,
  startsCompanyWork,
} from "./companyAiPolicy.ts";

describe("company server AI account", () => {
  it("serves colleagues only on a company API key", () => {
    expect(companyWorkRefusal({ mode: "api-key", actorUserId: "maria", ownerUserId: "alex" })).toBe(
      null,
    );
    expect(companyWorkRefusal({ mode: "seat", actorUserId: "maria", ownerUserId: "alex" })).toBe(
      COMPANY_API_KEY_REQUIRED,
    );
    expect(companyWorkRefusal({ mode: null, actorUserId: "maria", ownerUserId: "alex" })).toBe(
      COMPANY_API_KEY_REQUIRED,
    );
    expect(COMPANY_API_KEY_REQUIRED).toMatch(/cheie API a firmei/);
  });

  it("lets the owner use the server alone on their own subscription", () => {
    expect(companyWorkRefusal({ mode: "seat", actorUserId: "alex", ownerUserId: "alex" })).toBe(
      null,
    );
    expect(companyWorkRefusal({ mode: null, actorUserId: "alex", ownerUserId: "alex" })).toBe(null);
    // No one signed in on the server: nobody is its owner.
    expect(companyWorkRefusal({ mode: "seat", actorUserId: "alex", ownerUserId: null })).toBe(
      COMPANY_API_KEY_REQUIRED,
    );
  });

  it("checks only requests that make the AI work", () => {
    expect(startsCompanyWork({ via: "company", op: "staff.task" })).toBe(true);
    expect(startsCompanyWork({ via: "company", op: "staff.run" })).toBe(true);
    expect(startsCompanyWork({ via: "company", op: "staff.list" })).toBe(false);
    expect(startsCompanyWork({ via: "company", op: "staff.follow" })).toBe(false);
    expect(startsCompanyWork({ via: "chat", op: "thread.prompt" })).toBe(true);
    expect(startsCompanyWork({ via: "chat", op: "thread.view" })).toBe(false);
  });

  it("gives a company chat the key for its provider, and nothing on a seat", () => {
    expect(companyKeyEnv({ provider: "claude", mode: "api-key" }, "k1")).toEqual({
      ANTHROPIC_API_KEY: "k1",
    });
    expect(companyKeyEnv({ provider: "codex", mode: "api-key" }, "k2")).toEqual({
      OPENAI_API_KEY: "k2",
    });
    expect(companyKeyEnv({ provider: "claude", mode: "seat" }, "k1")).toBe(null);
    expect(companyKeyEnv({ provider: "claude", mode: "api-key" }, null)).toBe(null);
    expect(companyKeyEnv(undefined, "k1")).toBe(null);
  });
});
