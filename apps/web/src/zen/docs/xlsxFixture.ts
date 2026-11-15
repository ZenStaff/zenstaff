// A small workbook built the way Excel writes one (shared strings, styles with a date format,
// a shared formula, merged cells, calcChain, a defined name and a chart part), for tests.
import JSZip from "jszip";

export const CHART_XML =
  '<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:f>Vanzari!$B$2:$B$4</c:f></c:chartSpace>';

export async function buildWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="Vanzari" sheetId="1" r:id="rId1"/><sheet name="Rezumat lunar" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="Total">Vanzari!$B$5</definedName></definedNames><calcPr calcId="191029"/></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
  );
  zip.file(
    "xl/sharedStrings.xml",
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5"><si><t>Produs</t></si><si><t>Preț</t></si><si><r><t>Cior</t></r><r><rPr><b/></rPr><t>bă</t></r></si><si><t>Sarmale &amp; mămăligă</t></si><si><t>Total</t></si></sst>',
  );
  zip.file(
    "xl/styles.xml",
    '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="4" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C5"/><sheetData>' +
      '<row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Data</t></is></c></row>' +
      '<row r="2" spans="1:3"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>18.5</v></c><c r="C2" s="2"><v>45597</v></c></row>' +
      '<row r="3" spans="1:3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1"><v>32</v></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>Plăcintă</t></is></c><c r="B4" s="1"><v>12</v></c><c r="D4"><f t="shared" ref="D4:D5" si="0">B4*2</f><v>24</v></c></row>' +
      '<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5" s="1"><f>SUM(B2:B4)</f><v>62.5</v></c><c r="D5"><f t="shared" si="0"/><v>125</v></c></row>' +
      '</sheetData><mergeCells count="1"><mergeCell ref="A6:B6"/></mergeCells><conditionalFormatting sqref="B2:B4"><cfRule type="cellIs" priority="1"/></conditionalFormatting></worksheet>',
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>Vanzari!B5+\'Rezumat lunar\'!B1</f><v>62.5</v></c><c r="B1"><v>0</v></c><c r="C1" t="str"><f>"Vanzari!B2"&amp;"x"</f><v>Vanzari!B2x</v></c></row></sheetData></worksheet>',
  );
  zip.file(
    "xl/calcChain.xml",
    '<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B5" i="1"/></calcChain>',
  );
  zip.file("xl/charts/chart1.xml", CHART_XML);
  return zip.generateAsync({ type: "uint8array" });
}
