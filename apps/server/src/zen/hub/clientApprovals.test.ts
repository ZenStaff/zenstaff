// @effect-diagnostics nodeBuiltinImport:off -- a plain filesystem fixture for the workspace rules.
// Client approval links on the app side: which files may go, reading them from the workspace
// (no escaping the folder, caps), the client's brand from the company profile, the local list.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "@effect/vitest";

import {
  approvalKindOf,
  defaultApprovalTitle,
  loadApprovalRecords,
  readBrandColor,
  readCompanyLogo,
  readDeliverables,
  saveApprovalRecords,
  type LocalApprovalRecord,
} from "./clientApprovals.ts";

const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-approvals-"));
afterAll(() => NodeFS.rmSync(root, { recursive: true, force: true }));
const work = NodePath.join(root, "work");
NodeFS.mkdirSync(NodePath.join(work, "out"), { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(work, "out", "afis.png"),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]),
);
NodeFS.writeFileSync(NodePath.join(work, "postare.md"), "Textul postării");
NodeFS.writeFileSync(NodePath.join(work, "oferta.docx"), "x");
NodeFS.writeFileSync(NodePath.join(root, "secret.txt"), "nu");
NodeFS.symlinkSync(NodePath.join(root, "secret.txt"), NodePath.join(work, "link.txt"));

describe("client approval links (app side)", () => {
  it("knows which kinds can be sent", () => {
    expect(approvalKindOf("a/b/afis.JPG")).toBe("image");
    expect(approvalKindOf("reel.mov")).toBe("video");
    expect(approvalKindOf("x.svg")).toBeNull();
    expect(approvalKindOf("x.docx")).toBeNull();
  });

  it("reads files inside the folder only", async () => {
    const files = await readDeliverables(work, ["out/afis.png", "postare.md"]);
    expect(files.map((file) => [file.name, file.kind])).toEqual([
      ["afis.png", "image"],
      ["postare.md", "text"],
    ]);
    await expect(readDeliverables(work, ["../secret.txt"])).rejects.toThrow(/outside the folder/);
    await expect(readDeliverables(work, ["link.txt"])).rejects.toThrow(/links outside/);
    await expect(readDeliverables(work, [NodePath.join(root, "secret.txt")])).rejects.toThrow(
      /inside the folder/,
    );
    await expect(readDeliverables(work, ["oferta.docx"])).rejects.toThrow(
      /Export a document to PDF/,
    );
    await expect(readDeliverables(work, [])).rejects.toThrow(/Choose a file/);
    await expect(
      readDeliverables(
        work,
        Array.from({ length: 11 }, (_, index) => `f${index}.png`),
      ),
    ).rejects.toThrow(/At most 10/);
  });

  it("refuses files over the cap", async () => {
    NodeFS.writeFileSync(NodePath.join(work, "mare.md"), Buffer.alloc(600 * 1024, 97));
    await expect(readDeliverables(work, ["mare.md"])).rejects.toThrow(/larger than 512 KB/);
  });

  it("takes the client's logo and first brand color from the brand profile", async () => {
    const home = NodePath.join(root, "home");
    const state = NodePath.join(root, "state");
    NodeFS.mkdirSync(NodePath.join(home, "companies", "brutaria", "brand"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(home, "companies", "brutaria", "brand", "logo.png"),
      Buffer.from([1, 2, 3]),
    );
    NodeFS.mkdirSync(NodePath.join(state, "zen", "onboarding"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(state, "zen", "onboarding", "brutaria.json"),
      JSON.stringify({ answers: { brandColors: ["#7C3AED", "#E2401E"] } }),
    );
    expect((await readCompanyLogo(home, "brutaria"))?.name).toBe("logo.png");
    expect(await readCompanyLogo(home, "../etc")).toBeNull();
    expect(await readBrandColor(state, "brutaria", "#2F6F5E")).toBe("#7C3AED");
    expect(await readBrandColor(state, "altul", "#2F6F5E")).toBe("#2F6F5E");
  });

  it("keeps the links per chat in an owner-only file", async () => {
    const file = NodePath.join(root, "state", "zen", "client-approvals.json");
    const record: LocalApprovalRecord = {
      id: "apr_x",
      url: "https://hub/aprobare/t",
      threadId: "thread-1",
      hubCompanyId: "c_1",
      localCompanyId: "brutaria",
      title: "Afiș",
      clientName: "Brutăria",
      files: [{ name: "afis.png", kind: "image" }],
      createdAt: "2026-11-08T10:00:00.000Z",
      lastStatus: "sent",
    };
    await saveApprovalRecords(file, [record]);
    expect(await loadApprovalRecords(file)).toEqual([record]);
    expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
    expect(defaultApprovalTitle(["afis-craciun.png", "b.png"])).toBe("Afis craciun (+1)");
  });
});
