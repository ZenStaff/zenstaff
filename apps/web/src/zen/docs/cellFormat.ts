// Zen Staff document editing: an XLSX number shown with its cell's number format in the grid
// (11% instead of 0.11, 1,234.50 lei instead of 1234.5), so editing looks like the file. Covers the
// common codes: decimals, thousands, percent, scientific, quoted text and [$lei-418] currency
// tags. Anything else (dates are shown as dates already, fractions, conditions) shows the raw value.
import type { GridCellFormat } from "./gridModel";

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function section(code: string, value: number): string {
  const sections = code.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (value < 0 && sections[1] !== undefined && sections[1] !== "") return sections[1];
  if (value === 0 && sections[2] !== undefined && sections[2] !== "") return sections[2];
  return sections[0] ?? code;
}

/** `display` formatted for the grid, or `display` itself when it is not a plain number. */
export function formatCellDisplay(
  display: string,
  format: GridCellFormat | undefined,
  locale?: string,
): string {
  const code = format?.numFmt;
  if (code === null || code === undefined || !NUMERIC.test(display.trim())) return display;
  const value = Number(display);
  if (!Number.isFinite(value)) return display;
  const raw = section(code, value);
  // A negative section with its own sign or parentheses shows the absolute value.
  const ownSign = value < 0 && raw !== code.split(";")[0];
  // Literal text: "lei", \x, [$lei-418]; colors and conditions are dropped.
  const literals: string[] = [];
  const pattern = raw
    .replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, (_m, symbol: string) => {
      literals.push(symbol);
      return String.fromCharCode(0xe100 + literals.length - 1);
    })
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"([^"]*)"/g, (_m, text: string) => {
      literals.push(text);
      return String.fromCharCode(0xe100 + literals.length - 1);
    })
    .replace(/\\(.)/g, (_m, char: string) => {
      literals.push(char);
      return String.fromCharCode(0xe100 + literals.length - 1);
    })
    .replace(/_./g, " ")
    .replace(/\*./g, "");
  const numberPart = /[#0?][#0?,.]*%*|\.[#0?]+%*/.exec(pattern);
  if (numberPart === null || /[dmyhs]/i.test(pattern)) {
    return display;
  }
  const body = numberPart[0];
  const percent = (pattern.match(/%/g) ?? []).length;
  const scientific = /E[+-]/i.test(pattern);
  const decimals = /\.([0#?]*)/.exec(body)?.[1]?.length ?? 0;
  const minDecimals = /\.(0*)/.exec(body)?.[1]?.length ?? 0;
  const grouping = /[#0],[#0]/.test(body);
  const scaled = (ownSign ? Math.abs(value) : value) * 100 ** percent;
  if (scientific) {
    return scaled
      .toExponential(decimals)
      .toUpperCase()
      .replace(/E([+-])(\d)$/, "E$10$2");
  }
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  }).format(scaled);
  // The number goes where the pattern had it; the percent signs and literal text stay around it.
  const start = pattern.indexOf(body);
  const before = start < 0 ? "" : pattern.slice(0, start);
  const after = start < 0 ? "" : pattern.slice(start + body.length);
  const bodyPercent = "%".repeat((body.match(/%/g) ?? []).length);
  return `${before}${number}${bodyPercent}${after}`
    .replaceAll(/[\ue100-\ue1ff]/g, (marker) => literals[marker.charCodeAt(0) - 0xe100] ?? "")
    .trim();
}

/** "#rrggbb" saturation (HSL), 0 for grays, black and white. */
function saturation(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * light - 1));
}

/**
 * The inline colors of a cell in the grid. A filled cell keeps its fill and its text color
 * (black when the file leaves it to the theme); without a fill only a real color (red, green)
 * is kept, so black or gray text stays readable in the dark theme.
 */
export function cellColors(
  format: GridCellFormat | undefined,
): { readonly backgroundColor?: string; readonly color?: string } | undefined {
  if (format === undefined) return undefined;
  if (format.fill !== null)
    return { backgroundColor: format.fill, color: format.color ?? "#111827" };
  if (format.color !== null && saturation(format.color) > 0.3) return { color: format.color };
  return undefined;
}
