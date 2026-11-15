import { describe, expect, it } from "vite-plus/test";

import { folderTitleOf, nextFreeFolder, siblingFolder } from "./companyFolderModel";

describe("company folder paths", () => {
  it("titles a folder with its last part, on Windows and elsewhere", () => {
    expect(folderTitleOf("/home/ana/Zen Staff/Florăria Iris")).toBe("Florăria Iris");
    expect(folderTitleOf("C:\\Users\\Ana\\Zen Staff\\Iris\\")).toBe("Iris");
  });

  it("puts a named folder next to the company folder, with the same separator", () => {
    expect(siblingFolder("/home/ana/Zen Staff/Iris", "Oferte")).toBe("/home/ana/Zen Staff/Oferte");
    expect(siblingFolder("C:\\Users\\Ana\\Zen Staff\\Iris", "Oferte")).toBe(
      "C:\\Users\\Ana\\Zen Staff\\Oferte",
    );
  });

  it("numbers a folder another company already uses", () => {
    const taken = new Set(["/z/Iris", "/z/Iris (2)"]);
    expect(nextFreeFolder("/z/Iris", (path) => taken.has(path))).toBe("/z/Iris (3)");
    expect(nextFreeFolder("/z/Nou", (path) => taken.has(path))).toBe("/z/Nou");
  });
});
