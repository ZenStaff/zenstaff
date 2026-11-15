import { describe, expect, it } from "vite-plus/test";

import { speaksOfClients } from "../clients/workMode";
import { zenMessagesFor } from "../i18n/zenI18n";
import { approvalsText } from "./approvals.i18n";
import {
  approvalKindOf,
  approvalSteps,
  cardStatus,
  dominantColors,
  newStatuses,
  pickHubWorkspace,
  type ApprovalItem,
  type ApprovalStatus,
} from "./approvalsModel";

const item = (status: ApprovalStatus, active = true): ApprovalItem => ({
  record: {
    id: "apr_1",
    url: "https://hub/aprobare/x",
    threadId: "t1",
    title: "Afiș",
    clientName: "Brutăria Bunicii",
    files: [{ name: "afis.png", kind: "image" }],
    createdAt: "2026-11-08T10:00:00.000Z",
    lastStatus: "sent",
  },
  approval: {
    id: "apr_1",
    status,
    active,
    comment: status === "changes" ? "Logo mai mare" : null,
    decidedByName: null,
    decidedAt: null,
    firstViewedAt: null,
    expiresAt: "2026-11-22T10:00:00.000Z",
    revokedAt: null,
  },
});

describe("client approval links", () => {
  it("sends only images, video, PDF and text", () => {
    expect(approvalKindOf("out/afis.PNG")).toBe("image");
    expect(approvalKindOf("reel.mp4")).toBe("video");
    expect(approvalKindOf("oferta.pdf")).toBe("pdf");
    expect(approvalKindOf("postare.md")).toBe("text");
    expect(approvalKindOf("oferta.docx")).toBeNull();
    expect(approvalKindOf("logo.svg")).toBeNull();
    expect(approvalKindOf("pagina.html")).toBeNull();
  });

  it("picks the hub workspace: the linked company, else the only one, else asks; guests cannot send", () => {
    const companies = [
      { id: "h1", name: "Studio", role: "owner" },
      { id: "h2", name: "Agenția", role: "member" },
      { id: "h3", name: "Alt client", role: "guest" },
    ];
    expect(
      pickHubWorkspace({ localCompanyId: "brutaria", links: { brutaria: "h2" }, companies }),
    ).toMatchObject({ kind: "chosen", id: "h2" });
    expect(pickHubWorkspace({ localCompanyId: "brutaria", links: {}, companies }).kind).toBe(
      "choose",
    );
    expect(
      pickHubWorkspace({ localCompanyId: null, links: {}, companies: companies.slice(0, 1) }),
    ).toMatchObject({ kind: "chosen", id: "h1" });
    expect(
      pickHubWorkspace({ localCompanyId: null, links: {}, companies: companies.slice(2) }).kind,
    ).toBe("none");
  });

  it("shows Trimis -> Văzut -> Aprobat / Modificări cerute, and a closed link", () => {
    expect(approvalSteps("sent")).toEqual({ viewed: false, answered: null });
    expect(approvalSteps("viewed")).toEqual({ viewed: true, answered: null });
    expect(approvalSteps("changes")).toEqual({ viewed: true, answered: "changes" });
    expect(cardStatus(item("approved", false))).toBe("approved");
    expect(cardStatus(item("viewed", false))).toBe("closed");
    expect(cardStatus({ ...item("sent"), approval: null })).toBe("unknown");
  });

  it("announces a status once it changes, not on the first look", () => {
    expect(newStatuses(null, [item("viewed")])).toEqual([]);
    expect(newStatuses(new Map([["apr_1", "viewed"]]), [item("viewed")])).toEqual([]);
    expect(
      newStatuses(new Map([["apr_1", "viewed"]]), [item("changes")]).map((change) => change.status),
    ).toEqual(["changes"]);
  });

  it("reads brand colors from a logo, skipping the white background and merging shades", () => {
    const pixels: Array<number> = [];
    const push = (r: number, g: number, b: number, a = 255, times = 1) => {
      for (let index = 0; index < times; index += 1) pixels.push(r, g, b, a);
    };
    push(255, 255, 255, 255, 50);
    push(0, 0, 0, 0, 50);
    push(124, 58, 237, 255, 30);
    push(126, 60, 235, 255, 10);
    push(226, 64, 30, 255, 20);
    push(20, 200, 90, 255, 2);
    expect(dominantColors(pixels)).toEqual(["#7D3BED", "#E2401E"]);
  });

  it("writes the changes message for the agent in both languages", () => {
    expect(
      zenMessagesFor(approvalsText, "ro").changesMessage("Afiș", "Brutăria", "Logo mai mare"),
    ).toContain("Brutăria a cerut modificări la „Afiș”");
    expect(
      zenMessagesFor(approvalsText, "en").changesMessage("Poster", "Bakery", "Bigger logo"),
    ).toContain('Bakery asked for changes to "Poster"');
    expect(zenMessagesFor(approvalsText, "ro").days(20)).toBe("20 de zile");
  });

  it("the switcher speaks of clients only for people who chose it", () => {
    expect(speaksOfClients("clients")).toBe(true);
    expect(speaksOfClients("self")).toBe(false);
    expect(speaksOfClients(null)).toBe(false);
  });
});
