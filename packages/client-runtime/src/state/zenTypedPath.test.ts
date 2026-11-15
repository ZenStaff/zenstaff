import { describe, expect, it } from "vite-plus/test";

import { getFilesystemBrowsePath } from "./filesystem.ts";
import { resolveProjectPathForDispatch } from "./projects.ts";

// Zen: the Add folder dialog's field starts with `~/`; a full path typed after it is that path.
describe("Add folder with a path typed after ~/", () => {
  it("dispatches the absolute path, not one under the home", () => {
    expect(resolveProjectPathForDispatch("~//srv/proiecte/x")).toBe("/srv/proiecte/x");
    expect(resolveProjectPathForDispatch("  /srv/proiecte/x ")).toBe("/srv/proiecte/x");
    expect(resolveProjectPathForDispatch("~/~/proiecte/x")).toBe("~/proiecte/x");
    expect(resolveProjectPathForDispatch("~/proiecte/x")).toBe("~/proiecte/x");
  });

  it("browses the folder the typed path names", () => {
    const browse = getFilesystemBrowsePath("~//srv/proiecte/x");
    expect(browse.isBrowsing).toBe(true);
    expect(browse.directoryPath).toBe("/srv/proiecte/");
    expect(browse.filterQuery).toBe("x");
    expect(getFilesystemBrowsePath("~/~/projects/").directoryPath).toBe("~/projects/");
  });
});
