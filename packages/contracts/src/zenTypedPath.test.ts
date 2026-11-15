import { describe, expect, it } from "vite-plus/test";

import { zenTypedPath } from "./zen.ts";

describe("zenTypedPath", () => {
  it("keeps an absolute path typed after the dialog's ~/", () => {
    expect(zenTypedPath("~//srv/proiecte/x")).toBe("/srv/proiecte/x");
    expect(zenTypedPath("~///srv/data")).toBe("//srv/data");
    expect(zenTypedPath("~/C:\\Users\\ana\\docs")).toBe("C:\\Users\\ana\\docs");
    expect(zenTypedPath("~/\\\\server\\share")).toBe("\\\\server\\share");
  });

  it("expands ~ once when ~/ is typed again", () => {
    expect(zenTypedPath("~/~/proiecte/x")).toBe("~/proiecte/x");
    expect(zenTypedPath("~/~/~/x")).toBe("~/x");
    expect(zenTypedPath("~/~")).toBe("~");
  });

  it("leaves ordinary paths alone", () => {
    for (const value of ["~/projects/app", "~/", "~", "/srv/x", "./a", "../b", "", "C:\\x"]) {
      expect(zenTypedPath(value)).toBe(value);
    }
  });
});
