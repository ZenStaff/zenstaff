import { describe, expect, it } from "vite-plus/test";

import { detectSecrets, redactSensitive } from "./zenSecrets.ts";

describe("redactSensitive", () => {
  it("replaces known key formats and keeps the rest of the text", () => {
    const text =
      "Cheia Anthropic e sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 și GitHub ghp_abcdefghijklmnopqrstuvwxyz0123456789AB.";
    const result = redactSensitive(text);
    expect(result.text).toBe("Cheia Anthropic e [redacted api-key] și GitHub [redacted api-key].");
    expect(result.kinds).toEqual(["api-key"]);
  });

  it("redacts every occurrence, not only the first", () => {
    const key = "AKIAABCDEFGHIJKLMNOP";
    const result = redactSensitive(`${key} and again ${key}`);
    expect(result.text).toBe("[redacted api-key] and again [redacted api-key]");
  });

  it("redacts assigned passwords but keeps the name", () => {
    const result = redactSensitive("DB_PASSWORD=Sup3r-Secret!9 și parola mea este Mur3s2026!");
    expect(result.text).toContain("DB_PASSWORD=[redacted password]");
    expect(result.text).toContain("parola mea este [redacted password]");
    expect(result.text).not.toContain("Sup3r-Secret");
    expect(result.text).not.toContain("Mur3s2026");
  });

  it("redacts a password named a few words after 'parola'", () => {
    const result = redactSensitive(
      "Parola de la portalul lor de comenzi e Arcadia!2026x, n-o pune în mesaj.",
    );
    expect(result.text).toBe(
      "Parola de la portalul lor de comenzi e [redacted password], n-o pune în mesaj.",
    );
  });

  it("keeps the scheme and host of a connection string but not its credentials", () => {
    const result = redactSensitive("postgres://admin:hunter22@db.example.com:5432/app");
    expect(result.text).toBe("postgres://[redacted connection-string]@db.example.com:5432/app");
  });

  it("redacts a private key block whole", () => {
    const result = redactSensitive(
      "key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----\nend",
    );
    expect(result.text).toBe("key:\n[redacted private-key]\nend");
  });

  it("redacts valid CNPs and card numbers, not amounts or phone numbers", () => {
    const result = redactSensitive(
      "CNP 1800101221144, card 4111 1111 1111 1111, total 1.250,50 lei, tel 0722123456, comanda 2026",
    );
    expect(result.text).toContain("CNP [redacted cnp]");
    expect(result.text).toContain("card [redacted card]");
    expect(result.text).toContain("1.250,50 lei");
    expect(result.text).toContain("0722123456");
    expect(result.kinds).toEqual(expect.arrayContaining(["cnp", "card"]));
  });

  it("leaves ordinary business text alone", () => {
    const text =
      "Ioana a hotărât să cumpărăm făina de la Moara Verde cu 3,25 lei/kg din 1 aprilie. Cum resetez parola?";
    expect(redactSensitive(text)).toEqual({ text, kinds: [] });
    expect(detectSecrets(text)).toEqual([]);
  });
});
