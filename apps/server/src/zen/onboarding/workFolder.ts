// @effect-diagnostics nodeBuiltinImport:off -- A pure path helper used by the onboarding service.
// Zen Staff: the folder a company's first tasks work in, created on the first run so the first task
// just works (no "add a folder first"). It sits where people look for their files,
// `~/Zen Staff/<Company>`, not inside the hidden Zen home. ZEN.md, "First run".
import * as NodePath from "node:path";

const ZEN_WORK_ROOT_NAME = "Zen Staff";

/** A company name as a folder name on Windows, macOS and Linux: no reserved characters. */
export function workFolderName(companyName: string | null | undefined, fallback: string): string {
  const cleaned = (companyName ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 60)
    .trim();
  // Windows reserves these names whatever the extension.
  if (cleaned === "" || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return fallback;
  return cleaned;
}

/** `<home>/Zen Staff/<Company>`; the personal space gets `<home>/Zen Staff/<fallback>`. */
export function companyWorkFolder(
  userHome: string,
  companyName: string | null | undefined,
  fallback: string,
): string {
  return NodePath.join(userHome, ZEN_WORK_ROOT_NAME, workFolderName(companyName, fallback));
}
