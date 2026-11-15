import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";

import { applyDocxOp, canDelete, readDocx, saveDocx } from "./docx";

const BODY =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Ofertă</w:t></w:r></w:p>' +
  '<w:p><w:bookmarkStart w:id="0" w:name="intro"/><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Bună ziua, </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>domnule</w:t></w:r><w:r><w:tab/><w:t>Popescu</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>' +
  "<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>" +
  '<w:p><w:hyperlink r:id="rId5"><w:r><w:t>site</w:t></w:r></w:hyperlink></w:p>' +
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Celulă &amp; tabel</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
  "<w:p><w:r><w:t>Text box: </w:t></w:r><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p>" +
  '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr><w:r><w:t>Final</w:t></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="11906"/></w:sectPr>';

const STYLES =
  '<?xml version="1.0"?><w:styles xmlns:w="w"><w:style w:styleId="Heading1"/></w:styles>';

async function buildDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${BODY}</w:body></w:document>`,
  );
  zip.file("word/styles.xml", STYLES);
  return zip.generateAsync({ type: "uint8array" });
}

const documentXml = async (bytes: Uint8Array) =>
  (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");

describe("DOCX paragraphs", () => {
  it("lists paragraphs with style, table position and what locks them", async () => {
    const document = await readDocx(await buildDocx());
    expect(
      document.paragraphs.map((paragraph) => [
        paragraph.text,
        paragraph.style,
        paragraph.inTable,
        paragraph.locked,
      ]),
    ).toEqual([
      ["Ofertă", "Heading1", false, null],
      ["Bună ziua, domnule\tPopescu", null, false, null],
      ["", null, false, "picture"],
      ["site", null, false, "link"],
      ["Celulă & tabel", null, true, null],
      ["Text box: inside", null, false, "nested"],
      ["Final", null, false, null],
    ]);
    expect(canDelete(document.paragraphs[4]!)).toBe(false);
    expect(canDelete(document.paragraphs[6]!)).toBe(false);
    expect(canDelete(document.paragraphs[1]!)).toBe(true);
  });

  it("rewrites only edited paragraphs, keeping style, first-run formatting and bookmarks", async () => {
    const original = await buildDocx();
    const saved = await saveDocx(original, [
      { type: "set", index: 1, text: "Stimate <client> & partener\nrând nou" },
      { type: "insertAfter", index: 1, text: "Paragraf adăugat" },
      { type: "set", index: 5, text: "Celulă modificată" },
      { type: "set", index: 3, text: "ignored: picture paragraph" },
      { type: "delete", index: 7 },
    ]);
    const xml = await documentXml(saved);
    expect(xml).toContain(
      '<w:p><w:bookmarkStart w:id="0" w:name="intro"/><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Stimate &lt;client&gt; &amp; partener</w:t><w:br/><w:t xml:space="preserve">rând nou</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>',
    );
    expect(xml).toContain(
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Paragraf adăugat</w:t></w:r></w:p>',
    );
    expect(xml).toContain("Celulă modificată");
    expect(xml).toContain("<w:drawing>");
    // The section break paragraph cannot be removed.
    expect(xml).toContain("Final");
    expect(
      xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document'),
    ).toBe(true);
    expect(await (await JSZip.loadAsync(saved)).file("word/styles.xml")!.async("string")).toBe(
      STYLES,
    );
    const reread = await readDocx(saved);
    expect(reread.paragraphs.map((paragraph) => paragraph.text).slice(0, 3)).toEqual([
      "Ofertă",
      "Stimate <client> & partener\nrând nou",
      "Paragraf adăugat",
    ]);
  });

  it("keeps the editor's list in step with what the save does", async () => {
    const { paragraphs } = await readDocx(await buildDocx());
    const next = applyDocxOp(
      applyDocxOp(paragraphs, { type: "insertAfter", index: 0, text: "Nou" }),
      {
        type: "delete",
        index: 2,
      },
    );
    expect(next.map((paragraph) => paragraph.text).slice(0, 3)).toEqual(["Ofertă", "Nou", ""]);
    expect(next.map((paragraph) => paragraph.index)).toEqual(next.map((_, index) => index));
    expect(await saveDocx(await buildDocx(), [])).toBeInstanceOf(Uint8Array);
  });
});
