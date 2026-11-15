import { describe, expect, it } from "vite-plus/test";

import { hubErrorFor } from "./hubErrors";

describe("hub refusals in the person's language (review P1-18)", () => {
  it("turns a permission refusal into Romanian with who to ask", () => {
    expect(hubErrorFor("Your role does not allow this (angajati: creeaza).", "ro")).toBe(
      "Rolul tău nu permite asta (angajati: creeaza). Cere-i unui proprietar sau administrator al firmei.",
    );
    expect(hubErrorFor("Your role does not allow this.", "ro")).toBe(
      "Rolul tău nu permite asta. Cere-i unui proprietar sau administrator al firmei.",
    );
    expect(hubErrorFor("Your role does not allow comments here (chats: creeaza).", "ro")).toMatch(
      /^Rolul tău nu permite asta \(chats: creeaza\)\./,
    );
  });

  it("translates the hub's known sentences and the app's fallbacks", () => {
    expect(hubErrorFor("You cannot invite with that role.", "ro")).toBe(
      "Nu poți invita cu acest rol.",
    );
    expect(hubErrorFor("Only owners and admins change the company's details.", "ro")).toBe(
      "Doar proprietarii și administratorii schimbă datele firmei. Cere-i unui proprietar sau administrator al firmei.",
    );
    expect(hubErrorFor("Try again.", "ro")).toBe("Încearcă din nou.");
    expect(hubErrorFor("No machine is connected.", "ro")).toBe("Niciun calculator conectat.");
    expect(hubErrorFor("The hub is not available.", "ro")).not.toMatch(/hub/i);
    expect(
      hubErrorFor(
        "The company server is not set up yet: an owner or an admin must confirm which AI account and which connections it uses for the company.",
        "ro",
      ),
    ).toMatch(/^Serverul firmei nu e încă pregătit/);
  });

  it("keeps English in English and unknown messages as they are", () => {
    expect(hubErrorFor("You cannot invite with that role.", "en")).toBe(
      "You cannot invite with that role.",
    );
    expect(hubErrorFor("Something else happened.", "ro")).toBe("Something else happened.");
  });
});
