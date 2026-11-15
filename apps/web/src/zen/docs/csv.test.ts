import { describe, expect, it } from "vite-plus/test";

import { parseCsv, serializeCsv, shiftQuoted } from "./csv";

describe("CSV", () => {
  it("round-trips byte for byte: quotes, embedded newlines, CRLF, BOM, final newline", () => {
    const samples = [
      'produs,pret\r\n"Ciorbă, de burtă",18\r\n"Spune ""da""",0\r\n',
      '﻿a;b;c\n1,5;2;"x\ny"\n',
      "a\tb\n\t\n",
      "no,final,newline",
      'x,"",y\n',
      "",
    ];
    for (const text of samples) {
      const name = text.includes("\t") ? "file.tsv" : "file.csv";
      expect(serializeCsv(parseCsv(text, name))).toBe(text);
    }
  });

  it("guesses the delimiter: tab for .tsv, semicolon for Romanian Excel exports", () => {
    expect(parseCsv("a;b\n1,5;2\n").delimiter).toBe(";");
    expect(parseCsv("a,b\n").delimiter).toBe(",");
    expect(parseCsv("a,b\tc\n", "x.tsv").delimiter).toBe("\t");
  });

  it("quotes new values that need it and moves remembered quotes with rows", () => {
    const document = parseCsv('a,b\n"1",2\n');
    const rows = document.rows.map((row) => [...row]);
    rows.splice(1, 0, ["Ana, Maria", " spațiu"]);
    const quoted = shiftQuoted(document.quoted, "row", 1, 1);
    expect(serializeCsv({ ...document, rows, quoted })).toBe(
      'a,b\n"Ana, Maria"," spațiu"\n"1",2\n',
    );
    expect([...shiftQuoted(new Set(["1:0", "2:1"]), "row", 1, -1)]).toEqual(["1:1"]);
  });
});
