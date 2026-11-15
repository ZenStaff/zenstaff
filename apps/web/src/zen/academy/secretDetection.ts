// The detector moved to shared code (`@t3tools/contracts/zenSecrets`) so the server can redact
// company-memory summaries with the same rules; the Academy keeps importing it from here.
export {
  detectPersonalData,
  detectSecrets,
  isValidCnp,
  looksLikeSecret,
  passesLuhn,
  type SensitiveKind,
} from "@t3tools/contracts/zenSecrets";
