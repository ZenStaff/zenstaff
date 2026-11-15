import type { StaffAgent, StaffHuman } from "@t3tools/contracts/zenStaff";
import { describe, expect, it } from "vite-plus/test";

import { zenMessagesFor } from "../i18n/zenI18n";
import { staffText } from "./staff.i18n";
import {
  buildOrgChart,
  describeDays,
  latestRunOf,
  parseStaffSearch,
  pickStaffMachine,
  formatPriceList,
  hireKindFor,
  hireManagerId,
  highlightSegments,
  initials,
  lostHoursReportHtml,
  mergeHubMembers,
  parsePriceList,
  type OrgNode,
} from "./staffModel";

const human = (id: string, managerId: string | null = null): StaffHuman => ({
  id,
  name: id.toUpperCase(),
  email: `${id}@firma.example`,
  title: "",
  managerId,
  source: "local",
});
const agent = (id: string, managerId: string | null): StaffAgent =>
  ({ id, name: id, managerId }) as unknown as StaffAgent;

function shape(nodes: ReadonlyArray<OrgNode>): unknown {
  return nodes.map((node) =>
    node.kind === "human" ? { h: node.human.id, c: shape(node.children) } : { a: node.agent.id },
  );
}

describe("org chart", () => {
  it("puts people and agents under their managers", () => {
    const tree = buildOrgChart(
      [human("alex"), human("ioana", "alex")],
      [agent("maria", "ioana"), agent("ana", "alex"), agent("solo", null)],
    );
    expect(shape(tree)).toEqual([
      { h: "alex", c: [{ h: "ioana", c: [{ a: "maria" }] }, { a: "ana" }] },
      { a: "solo" },
    ]);
  });

  it("survives a manager loop and missing managers", () => {
    const tree = buildOrgChart(
      [human("a", "b"), human("b", "a"), human("c", "gone")],
      [agent("x", "gone")],
    );
    const ids = JSON.stringify(shape(tree));
    for (const id of ["a", "b", "c", "x"]) expect(ids).toContain(`"${id}"`);
  });

  it("merges hub members without duplicates", () => {
    const merged = mergeHubMembers(
      [human("alex")],
      [
        { userId: "u1", email: "ALEX@firma.example", name: "Alex", role: "owner" },
        { userId: "u2", email: "ioana@firma.example", name: "Ioana", role: "member" },
      ],
    );
    expect(merged.map((item) => [item.id, item.source])).toEqual([
      ["alex", "local"],
      ["hub-u2", "hub"],
    ]);
  });
});

describe("helpers", () => {
  it("highlights checker findings in the content", () => {
    const segments = highlightSegments("Ciorbă doar 29 lei! [link]", [
      { rule: "price", severity: "high", message: "32", excerpt: "29 lei", source: "rules" },
      { rule: "placeholder", severity: "high", message: "x", excerpt: "[link]", source: "rules" },
      { rule: "dup", severity: "low", message: "x", excerpt: "29", source: "ai" },
      { rule: "missing", severity: "low", message: "x", excerpt: "nu există", source: "ai" },
    ]);
    expect(segments.map((segment) => [segment.text, segment.finding?.rule ?? null])).toEqual([
      ["Ciorbă doar ", null],
      ["29 lei", "price"],
      ["! ", null],
      ["[link]", "placeholder"],
    ]);
  });

  it("reads and writes the price list", () => {
    const prices = parsePriceList("Ciorbă de burtă = 32\nPapanași: 24,50\nfără preț");
    expect(prices).toEqual([
      { item: "Ciorbă de burtă", price: 32 },
      { item: "Papanași", price: 24.5 },
    ]);
    expect(parsePriceList(formatPriceList(prices))).toEqual(prices);
  });

  it("makes initials and a printable report", () => {
    expect(initials("Ana Maria Pop")).toBe("AM");
    expect(initials("radu")).toBe("RA");
    const html = lostHoursReportHtml({
      title: "Harta orelor pierdute",
      subtitle: "Acme <SRL>",
      total: "ore",
      columns: ["Cine", "Ce", "Cât de des", "De fiecare dată", "Ore pe lună", "Propunere"],
      rows: [["Ana", "factur · furniz", "vineri", "2 h", "8.7", "Flux"]],
      footer: "f",
      date: "7.11.2026",
      lang: "ro",
      result: { hoursPerMonth: 8.7 },
    });
    expect(html).toContain("Acme &lt;SRL&gt;");
    expect(html).toContain("width:100%");
    expect(html).not.toMatch(/<script/);
  });

  it("speaks Romanian with comma-below diacritics", () => {
    const ro = zenMessagesFor(staffText, "ro");
    expect(ro.tabs.approvals).toBe("Aprobări");
    expect(ro.agentsCount(20)).toBe("20 de angajați AI");
    const all = JSON.stringify(staffText.ro);
    expect(all).not.toMatch(/[şţŞŢ]/);
  });
});

describe("parseStaffSearch", () => {
  it("keeps the six areas and maps the old tab names", () => {
    expect(parseStaffSearch({ tab: "board" })).toEqual({ tab: "board" });
    expect(parseStaffSearch({ tab: "evaluation" })).toEqual({ tab: "performance" });
    expect(parseStaffSearch({ tab: "quality" })).toEqual({ tab: "performance" });
    expect(parseStaffSearch({ tab: "discover" })).toEqual({ tab: "hire" });
    expect(parseStaffSearch({ tab: "nope" })).toEqual({});
  });
  it("reads an employee's page and its tab, and drops bad values", () => {
    expect(
      parseStaffSearch({ agent: "mihai", profile: "schedule", company: "bistro-casa-verde" }),
    ).toEqual({ agent: "mihai", profile: "schedule", company: "bistro-casa-verde" });
    expect(parseStaffSearch({ agent: "../x", profile: "salary", company: "Bad Co" })).toEqual({});
  });
});

describe("latestRunOf", () => {
  const run = (id: string, agentId: string, startedAt: string, status = "completed") => ({
    id,
    agentId,
    startedAt,
    status,
  });
  it("prefers a running task, then the newest", () => {
    const runs = [
      run("a", "ana", "2026-11-08T10:00:00Z"),
      run("b", "ana", "2026-11-08T12:00:00Z"),
      run("c", "ana", "2026-11-01T09:00:00Z", "running"),
      run("d", "ion", "2026-11-09T09:00:00Z"),
    ];
    expect(latestRunOf("ana", runs)?.id).toBe("c");
    expect(latestRunOf("ion", runs)?.id).toBe("d");
    expect(latestRunOf("maria", runs)).toBeNull();
  });
});

describe("describeDays", () => {
  const names = ["Lu", "Ma", "Mi", "Jo", "Vi", "Sâ", "Du"];
  it("joins runs of days", () => {
    expect(describeDays([1, 2, 3, 4, 5], names)).toBe("Lu-Vi");
    expect(describeDays([6, 7], names)).toBe("Sâ, Du");
    expect(describeDays([1, 3, 4, 5, 7], names)).toBe("Lu, Mi-Vi, Du");
    expect(describeDays([], names)).toBe("");
  });
});

describe("hiring without a dialog", () => {
  it("hires a company role as a company employee only where the company can run one", () => {
    expect(hireKindFor("company", true)).toBe("company");
    expect(hireKindFor("company", false)).toBe("personal");
    expect(hireKindFor("personal", true)).toBe("personal");
  });

  it("makes the person hiring the manager, else the first person", () => {
    const humans: StaffHuman[] = [
      { id: "owner", name: "Ana", email: null, title: "", managerId: null, source: "local" },
      { id: "h2", name: "alexd", email: null, title: "", managerId: null, source: "local" },
    ];
    expect(hireManagerId(humans, "Alexd")).toBe("h2");
    expect(hireManagerId(humans, "someone")).toBe("owner");
    expect(hireManagerId([], "alexd")).toBeNull();
  });
});

describe("pickStaffMachine", () => {
  const pc = "pc";
  const server = "90dcb72f-b664-4b74-808b-e85b451cfd73";
  it("opens where the company's AI employees work", () => {
    const machines = [
      { environmentId: pc, agents: 0 },
      { environmentId: server, agents: 20 },
    ];
    expect(pickStaffMachine(machines, undefined, pc)).toBe(server);
    expect(pickStaffMachine(machines, pc, pc)).toBe(pc);
    expect(pickStaffMachine(machines, "gone", pc)).toBe(server);
  });
  it("prefers this computer on a tie and with no AI employees anywhere", () => {
    expect(
      pickStaffMachine(
        [
          { environmentId: server, agents: 2 },
          { environmentId: pc, agents: 2 },
        ],
        undefined,
        pc,
      ),
    ).toBe(pc);
    expect(pickStaffMachine([{ environmentId: server, agents: 0 }], undefined, pc)).toBe(pc);
  });
  it("waits while a machine has not answered", () => {
    expect(
      pickStaffMachine(
        [
          { environmentId: pc, agents: 1 },
          { environmentId: server, agents: null },
        ],
        undefined,
        pc,
      ),
    ).toBeNull();
  });
  it("keeps a valid machine id from the address", () => {
    expect(parseStaffSearch({ machine: server }).machine).toBe(server);
    expect(parseStaffSearch({ machine: "a b" }).machine).toBeUndefined();
  });
});
