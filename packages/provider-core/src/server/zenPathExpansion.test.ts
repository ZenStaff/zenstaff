import { describe, expect, it } from "vite-plus/test";

import { expandHomePath } from "./pathExpansion.ts";

// Zen: the Add folder dialog starts at `~/`; agents and people type a full path after it.
describe("expandHomePath with a path typed after ~/", () => {
  it("keeps absolute paths absolute instead of joining them to the home", () => {
    expect(expandHomePath("~//srv/proiecte/x", "/home/ana")).toBe("/srv/proiecte/x");
    expect(expandHomePath("/srv/proiecte/x", "/home/ana")).toBe("/srv/proiecte/x");
  });

  it("expands ~ once", () => {
    expect(expandHomePath("~/~/proiecte/x", "/home/ana")).toBe("/home/ana/proiecte/x");
    expect(expandHomePath("~/proiecte/x", "/home/ana")).toBe("/home/ana/proiecte/x");
    expect(expandHomePath("~", "/home/ana")).toBe("/home/ana");
  });
});
