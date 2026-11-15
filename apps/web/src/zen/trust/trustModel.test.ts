import { describe, expect, it } from "vite-plus/test";

import { isInFolderApprovalAction } from "../office/officeApprovals";
import {
  OFFICE_ADVANCED_RUNTIME_MODES,
  OFFICE_DEFAULT_RUNTIME_MODE,
  OFFICE_PLAIN_RUNTIME_MODES,
  officeRuntimeModeMigration,
} from "./trustModel";

describe("trust model", () => {
  it("defaults Office to auto, never full access, with full access only under Avansat", () => {
    expect(OFFICE_DEFAULT_RUNTIME_MODE).toBe("auto");
    expect(OFFICE_PLAIN_RUNTIME_MODES).toEqual(["auto", "approval-required"]);
    expect(OFFICE_PLAIN_RUNTIME_MODES).not.toContain("full-access");
    expect(OFFICE_ADVANCED_RUNTIME_MODES.at(-1)).toBe("full-access");
  });

  it("moves a saved full-access default to auto once, in Office only", () => {
    const office = { edition: "office", migrated: false } as const;
    expect(officeRuntimeModeMigration({ ...office, defaultRuntimeMode: "full-access" })).toBe(
      "auto",
    );
    expect(officeRuntimeModeMigration({ ...office, defaultRuntimeMode: "approval-required" })).toBe(
      null,
    );
    expect(
      officeRuntimeModeMigration({ ...office, migrated: true, defaultRuntimeMode: "full-access" }),
    ).toBe(null);
    expect(
      officeRuntimeModeMigration({
        edition: "code",
        migrated: false,
        defaultRuntimeMode: "full-access",
      }),
    ).toBe(null);
  });

  it("tells in-folder work apart from actions that may leave the company", () => {
    expect(isInFolderApprovalAction("editFile")).toBe(true);
    expect(isInFolderApprovalAction("readFile")).toBe(true);
    expect(isInFolderApprovalAction("download")).toBe(false);
    expect(isInFolderApprovalAction("useApp")).toBe(false);
    expect(isInFolderApprovalAction("deleteFiles")).toBe(false);
  });
});
