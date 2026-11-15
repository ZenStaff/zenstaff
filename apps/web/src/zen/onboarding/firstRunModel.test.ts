import { describe, expect, it } from "vite-plus/test";

import { firstRunRoles, hubOfInviteLink, interviewBelongsToSomeoneElse } from "./firstRunModel";

const hub = (
  companies: ReadonlyArray<{ id: string; role: "owner" | "admin" | "member" | "guest" }>,
  links: Record<string, string> = {},
) => ({
  signedIn: true,
  links,
  companies: companies.map((company) => ({ ...company, name: company.id })),
});

describe("first run: whose company interview it is", () => {
  it("never gives the owner's interview to a member or a guest of a linked hub company", () => {
    const status = hub([{ id: "hub-iris", role: "member" }], { iris: "hub-iris" });
    expect(interviewBelongsToSomeoneElse(status, "iris", "new-company")).toBe(true);
    expect(
      interviewBelongsToSomeoneElse(
        hub([{ id: "hub-iris", role: "guest" }], { iris: "hub-iris" }),
        "iris",
        "first-run",
      ),
    ).toBe(true);
  });

  it("keeps the interview for owners, admins and companies of this computer only", () => {
    expect(
      interviewBelongsToSomeoneElse(
        hub([{ id: "hub-iris", role: "owner" }], { iris: "hub-iris" }),
        "iris",
        "new-company",
      ),
    ).toBe(false);
    expect(
      interviewBelongsToSomeoneElse(hub([{ id: "x", role: "member" }]), "mine", "new-company"),
    ).toBe(false);
    expect(interviewBelongsToSomeoneElse(null, "iris", "first-run")).toBe(false);
    expect(
      interviewBelongsToSomeoneElse(
        { ...hub([{ id: "x", role: "member" }]), signedIn: false },
        "personal",
        "first-run",
      ),
    ).toBe(false);
  });

  it("skips the first-run interview of someone who only belongs to other people's companies", () => {
    expect(
      interviewBelongsToSomeoneElse(hub([{ id: "x", role: "member" }]), "personal", "first-run"),
    ).toBe(true);
    expect(
      interviewBelongsToSomeoneElse(
        hub([
          { id: "x", role: "member" },
          { id: "y", role: "owner" },
        ]),
        "personal",
        "first-run",
      ),
    ).toBe(false);
  });
});

describe("first run: invitation links", () => {
  it("reads the hub from the link in the e-mail", () => {
    expect(hubOfInviteLink(" https://zenhub.zed-zen.com/invite#inv_abc ")).toBe(
      "https://zenhub.zed-zen.com",
    );
    expect(hubOfInviteLink("http://localhost:4100/invite#inv_abc")).toBe("http://localhost:4100");
  });

  it("refuses anything that is not an invitation link", () => {
    expect(hubOfInviteLink("https://zenhub.zed-zen.com/invite")).toBeNull();
    expect(hubOfInviteLink("https://zenhub.zed-zen.com/app#x")).toBeNull();
    expect(hubOfInviteLink("javascript:alert(1)#x")).toBeNull();
    expect(hubOfInviteLink("inv_abc")).toBeNull();
  });
});

describe("first run: two AI colleagues", () => {
  it("offers two roles from what takes the most time", () => {
    expect(firstRunRoles({ timeSinks: ["social", "invoices"] })).toEqual([
      "social-media-manager",
      "junior-accountant",
    ]);
    expect(firstRunRoles({})).toHaveLength(2);
  });
});
