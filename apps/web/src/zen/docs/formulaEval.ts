// @effect-diagnostics extendsNativeError:off - the formula parser's own control flow, never an Effect failure.
// Zen Staff document editing: a small spreadsheet formula engine, so an edited value updates the
// formulas that depend on it on screen and in the saved file's cached results (an agent or a
// library reading the file sees the new numbers; Excel and LibreOffice recalculate anyway because
// the save sets `fullCalcOnLoad`). Common functions only: anything it does not know (a function,
// a name, a whole-column range, a date in arithmetic) leaves that cell's last result untouched.
import { parseAddress } from "./cellRefs";
import type { GridCell, GridSheet } from "./gridModel";

export type FormulaError = { readonly error: string };
type Scalar = number | string | boolean | null | FormulaError;
interface RangeValue {
  readonly range: ReadonlyArray<ReadonlyArray<Scalar>>;
}
type Value = Scalar | RangeValue;

/** Thrown for anything the engine does not support; the cell keeps its cached result. */
class Unsupported extends Error {}

const isError = (value: unknown): value is FormulaError =>
  typeof value === "object" && value !== null && "error" in value;
function isRange(value: Value): value is RangeValue {
  return typeof value === "object" && value !== null && "range" in value;
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

type Token =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  | {
      readonly kind: "ref";
      readonly sheet: string | null;
      readonly from: string;
      readonly to: string | null;
    }
  | { readonly kind: "fn"; readonly name: string }
  | { readonly kind: "op"; readonly value: string };

const REF = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`;
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!`;
const REF_TOKEN = new RegExp(`^(?:${SHEET})?(${REF})(?::(${REF}))?`);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"') {
      let end = index + 1;
      let text = "";
      for (;;) {
        if (end >= source.length) throw new Unsupported("unterminated string");
        if (source[end] === '"') {
          if (source[end + 1] === '"') {
            text += '"';
            end += 2;
            continue;
          }
          break;
        }
        text += source[end];
        end += 1;
      }
      tokens.push({ kind: "str", value: text });
      index = end + 1;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number !== null) {
      tokens.push({ kind: "num", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const ref = REF_TOKEN.exec(rest);
    // A name like LOG10( is a function, not the cell LOG10.
    if (ref !== null && source[index + ref[0].length] !== "(") {
      const sheet = ref[1] !== undefined ? ref[1].replaceAll("''", "'") : (ref[2] ?? null);
      tokens.push({ kind: "ref", sheet, from: ref[3]!, to: ref[4] ?? null });
      index += ref[0].length;
      continue;
    }
    const word = /^[A-Za-z_][\w.]*/.exec(rest);
    if (word !== null) {
      const upper = word[0].toUpperCase();
      if (source[index + word[0].length] === "(") {
        tokens.push({ kind: "fn", name: upper.replace(/^_XLFN\./, "").replace(/^_XLWS\./, "") });
      } else if (upper === "TRUE" || upper === "FALSE") {
        tokens.push({ kind: "bool", value: upper === "TRUE" });
      } else {
        // Defined names, whole columns, structured references.
        throw new Unsupported(`name ${word[0]}`);
      }
      index += word[0].length;
      continue;
    }
    const op = /^(?:<>|<=|>=|[-+*/^&=<>%(),;])/.exec(rest);
    if (op === null) throw new Unsupported(`character ${char}`);
    tokens.push({ kind: "op", value: op[0] === ";" ? "," : op[0] });
    index += op[0].length;
  }
  return tokens;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

type Node =
  | { readonly type: "lit"; readonly value: Scalar }
  | {
      readonly type: "ref";
      readonly sheet: string | null;
      readonly from: string;
      readonly to: string | null;
    }
  | { readonly type: "unary"; readonly op: string; readonly arg: Node }
  | { readonly type: "percent"; readonly arg: Node }
  | { readonly type: "bin"; readonly op: string; readonly left: Node; readonly right: Node }
  | { readonly type: "call"; readonly name: string; readonly args: ReadonlyArray<Node> };

const LEVELS: ReadonlyArray<ReadonlyArray<string>> = [
  ["=", "<>", "<", ">", "<=", ">="],
  ["&"],
  ["+", "-"],
  ["*", "/"],
  ["^"],
];

function parse(source: string): Node {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => {
    const token = peek();
    return token?.kind === "op" && token.value === value;
  };
  const expect = (value: string) => {
    if (!isOp(value)) throw new Unsupported(`expected ${value}`);
    position += 1;
  };
  const binary = (level: number): Node => {
    if (level >= LEVELS.length) return unary();
    let left = binary(level + 1);
    for (;;) {
      const token = peek();
      if (token?.kind !== "op" || !LEVELS[level]!.includes(token.value)) return left;
      position += 1;
      left = { type: "bin", op: token.value, left, right: binary(level + 1) };
    }
  };
  const unary = (): Node => {
    if (isOp("-") || isOp("+")) {
      const op = (peek() as { value: string }).value;
      position += 1;
      return { type: "unary", op, arg: unary() };
    }
    let node = primary();
    while (isOp("%")) {
      position += 1;
      node = { type: "percent", arg: node };
    }
    return node;
  };
  const primary = (): Node => {
    const token = peek();
    if (token === undefined) throw new Unsupported("unexpected end");
    position += 1;
    switch (token.kind) {
      case "num":
      case "str":
      case "bool":
        return { type: "lit", value: token.value };
      case "ref":
        return { type: "ref", sheet: token.sheet, from: token.from, to: token.to };
      case "fn": {
        expect("(");
        const args: Node[] = [];
        if (!isOp(")")) {
          for (;;) {
            // An empty argument (IF(A1,,2)) is a blank.
            args.push(isOp(",") || isOp(")") ? { type: "lit", value: null } : binary(0));
            if (isOp(",")) {
              position += 1;
              continue;
            }
            break;
          }
        }
        expect(")");
        return { type: "call", name: token.name, args };
      }
      case "op":
        if (token.value === "(") {
          const inner = binary(0);
          expect(")");
          return inner;
        }
        throw new Unsupported(`operator ${token.value}`);
    }
  };
  const node = binary(0);
  if (position !== tokens.length) throw new Unsupported("trailing tokens");
  return node;
}

// ─── Values ─────────────────────────────────────────────────────────────────

const DIV0: FormulaError = { error: "#DIV/0!" };
const VALUE: FormulaError = { error: "#VALUE!" };
const NA: FormulaError = { error: "#N/A" };
const NUM: FormulaError = { error: "#NUM!" };

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** A cell's shown text as a value. */
function literalOf(display: string): Scalar {
  if (display === "") return null;
  if (NUMERIC.test(display.trim())) return Number(display);
  if (display === "TRUE" || display === "FALSE") return display === "TRUE";
  if (/^#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!)$/.test(display)) return { error: display };
  return display;
}

function toNumber(value: Scalar): number | FormulaError {
  if (isError(value)) return value;
  if (value === null) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (NUMERIC.test(value.trim())) return Number(value);
  // Dates are shown as text here; Excel would use their serial number.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) throw new Unsupported("date arithmetic");
  return VALUE;
}

function toText(value: Scalar): string | FormulaError {
  if (isError(value)) return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatResult(value);
  return value;
}

function toBool(value: Scalar): boolean | FormulaError {
  if (isError(value)) return value;
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const upper = value.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") return upper === "TRUE";
  return VALUE;
}

/** Plain number text without float noise (0.1 + 0.2 shows 0.3, as in Excel). */
function formatResult(value: number): string {
  if (!Number.isFinite(value)) return "#NUM!";
  return String(Number(value.toPrecision(15)));
}

function scalar(value: Value): Scalar {
  if (!isRange(value)) return value as Scalar;
  // A range used as one value: its single cell (implicit intersection is not supported).
  if (value.range.length === 1 && value.range[0]!.length === 1) return value.range[0]![0]!;
  throw new Unsupported("range as a value");
}

function flatten(values: ReadonlyArray<Value>): Array<{ value: Scalar; fromRange: boolean }> {
  const result: Array<{ value: Scalar; fromRange: boolean }> = [];
  for (const value of values) {
    if (!isRange(value)) {
      result.push({ value: value as Scalar, fromRange: false });
      continue;
    }
    for (const row of value.range)
      for (const cell of row) result.push({ value: cell, fromRange: true });
  }
  return result;
}

/** Numbers a SUM-like function counts: numbers in ranges, numbers and numeric text typed in. */
function numbersOf(values: ReadonlyArray<Value>): number[] | FormulaError {
  const result: number[] = [];
  for (const { value, fromRange } of flatten(values)) {
    if (isError(value)) return value;
    if (typeof value === "number") result.push(value);
    else if (!fromRange && value !== null) {
      const number = toNumber(value);
      if (isError(number)) return number;
      result.push(number);
    }
  }
  return result;
}

function compare(left: Scalar, right: Scalar): number {
  const rank = (value: Scalar) =>
    typeof value === "number" || value === null ? 0 : typeof value === "string" ? 1 : 2;
  const l = left === null && typeof right === "string" ? "" : left;
  const r = right === null && typeof left === "string" ? "" : right;
  if (rank(l) !== rank(r)) return rank(l) - rank(r);
  if (typeof l === "string" && typeof r === "string") {
    return l.toLowerCase() < r.toLowerCase() ? -1 : l.toLowerCase() > r.toLowerCase() ? 1 : 0;
  }
  const a = Number(l ?? 0);
  const b = Number(r ?? 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** SUMIF/COUNTIF criteria: ">5", "<>x", "=abc", "abc", 5. Wildcards are not supported. */
function matcher(criterion: Scalar): (value: Scalar) => boolean {
  if (typeof criterion !== "string") return (value) => compare(value, criterion) === 0;
  const match = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(criterion)!;
  const op = match[1] ?? "=";
  const raw = match[2]!;
  if (/[*?]/.test(raw)) throw new Unsupported("wildcards");
  const target: Scalar = raw === "" ? null : NUMERIC.test(raw.trim()) ? Number(raw) : raw;
  return (value) => {
    if (isError(value)) return false;
    // Numbers only match numbers; text only text.
    if (typeof target === "number" && typeof value !== "number") return op === "<>";
    const order = compare(value, target);
    switch (op) {
      case "<":
        return order < 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      case ">=":
        return order >= 0;
      case "<>":
        return order !== 0;
      default:
        return order === 0;
    }
  };
}

function rounder(mode: "round" | "up" | "down") {
  return (number: number, digits: number) => {
    const factor = 10 ** Math.trunc(digits);
    const scaled = Number((Math.abs(number) * factor).toPrecision(15));
    const rounded =
      mode === "round"
        ? Math.round(scaled)
        : mode === "up"
          ? Math.ceil(scaled)
          : Math.floor(scaled);
    return (Math.sign(number) * rounded) / factor;
  };
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

interface Context {
  /** The value of a cell; recursion through formulas happens here. */
  cell(sheet: string, row: number, col: number): Scalar;
  readonly sheet: string;
}

function rangeValues(ctx: Context, node: Extract<Node, { type: "ref" }>): Value {
  const sheet = node.sheet ?? ctx.sheet;
  const from = parseAddress(node.from);
  const to = parseAddress(node.to ?? node.from);
  if (from === null || to === null) throw new Unsupported("reference");
  if (node.to === null) return ctx.cell(sheet, from.row, from.col);
  const top = Math.min(from.row, to.row);
  const bottom = Math.max(from.row, to.row);
  const left = Math.min(from.col, to.col);
  const right = Math.max(from.col, to.col);
  if ((bottom - top + 1) * (right - left + 1) > 200_000) throw new Unsupported("range too large");
  const range: Scalar[][] = [];
  for (let row = top; row <= bottom; row += 1) {
    const line: Scalar[] = [];
    for (let col = left; col <= right; col += 1) line.push(ctx.cell(sheet, row, col));
    range.push(line);
  }
  return { range };
}

function evaluate(node: Node, ctx: Context): Value {
  switch (node.type) {
    case "lit":
      return node.value;
    case "ref":
      return rangeValues(ctx, node);
    case "unary": {
      const number = toNumber(scalar(evaluate(node.arg, ctx)));
      if (isError(number)) return number;
      return node.op === "-" ? -number : number;
    }
    case "percent": {
      const number = toNumber(scalar(evaluate(node.arg, ctx)));
      return isError(number) ? number : number / 100;
    }
    case "bin": {
      const left = scalar(evaluate(node.left, ctx));
      const right = scalar(evaluate(node.right, ctx));
      if (node.op === "&") {
        const l = toText(left);
        const r = toText(right);
        if (isError(l)) return l;
        if (isError(r)) return r;
        return l + r;
      }
      if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) {
        if (isError(left)) return left;
        if (isError(right)) return right;
        const order = compare(left, right);
        switch (node.op) {
          case "=":
            return order === 0;
          case "<>":
            return order !== 0;
          case "<":
            return order < 0;
          case ">":
            return order > 0;
          case "<=":
            return order <= 0;
          default:
            return order >= 0;
        }
      }
      const a = toNumber(left);
      const b = toNumber(right);
      if (isError(a)) return a;
      if (isError(b)) return b;
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0 ? DIV0 : a / b;
        default: {
          const power = a ** b;
          return Number.isFinite(power) ? power : NUM;
        }
      }
    }
    case "call":
      return callFunction(node.name, node.args, ctx);
  }
}

function callFunction(name: string, args: ReadonlyArray<Node>, ctx: Context): Value {
  const all = () => args.map((arg) => evaluate(arg, ctx));
  const one = (index: number) => (index < args.length ? scalar(evaluate(args[index]!, ctx)) : null);
  const num = (index: number, fallback?: number) => {
    if (index >= args.length && fallback !== undefined) return fallback;
    return toNumber(one(index));
  };
  const aggregate = (reduce: (numbers: number[]) => Scalar) => {
    const numbers = numbersOf(all());
    return isError(numbers) ? numbers : reduce(numbers);
  };
  switch (name) {
    case "SUM":
      return aggregate((numbers) => numbers.reduce((sum, value) => sum + value, 0));
    case "PRODUCT":
      return aggregate((numbers) => numbers.reduce((product, value) => product * value, 1));
    case "AVERAGE":
      return aggregate((numbers) =>
        numbers.length === 0
          ? DIV0
          : numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
      );
    case "MIN":
      return aggregate((numbers) => (numbers.length === 0 ? 0 : Math.min(...numbers)));
    case "MAX":
      return aggregate((numbers) => (numbers.length === 0 ? 0 : Math.max(...numbers)));
    case "COUNT":
      return flatten(all()).filter(({ value }) => typeof value === "number").length;
    case "COUNTA":
      return flatten(all()).filter(({ value }) => value !== null && value !== "").length;
    case "COUNTBLANK":
      return flatten(all()).filter(({ value }) => value === null || value === "").length;
    case "IF": {
      const test = toBool(one(0));
      if (isError(test)) return test;
      if (test) return args.length > 1 ? scalar(evaluate(args[1]!, ctx)) : true;
      return args.length > 2 ? scalar(evaluate(args[2]!, ctx)) : false;
    }
    case "IFERROR": {
      const value = one(0);
      return isError(value) ? one(1) : value;
    }
    case "IFNA": {
      const value = one(0);
      return isError(value) && value.error === "#N/A" ? one(1) : value;
    }
    case "AND":
    case "OR": {
      const values = flatten(all()).filter(
        ({ value, fromRange }) => !(fromRange && value === null),
      );
      let result = name === "AND";
      for (const { value } of values) {
        const bool = toBool(value);
        if (isError(bool)) return bool;
        result = name === "AND" ? result && bool : result || bool;
      }
      return result;
    }
    case "NOT": {
      const bool = toBool(one(0));
      return isError(bool) ? bool : !bool;
    }
    case "ROUND":
    case "ROUNDUP":
    case "ROUNDDOWN": {
      const value = num(0);
      const digits = num(1, 0);
      if (isError(value)) return value;
      if (isError(digits)) return digits;
      const mode = name === "ROUND" ? "round" : name === "ROUNDUP" ? "up" : "down";
      return rounder(mode)(value, digits);
    }
    case "ABS": {
      const value = num(0);
      return isError(value) ? value : Math.abs(value);
    }
    case "INT": {
      const value = num(0);
      return isError(value) ? value : Math.floor(value);
    }
    case "MOD": {
      const value = num(0);
      const divisor = num(1);
      if (isError(value)) return value;
      if (isError(divisor)) return divisor;
      if (divisor === 0) return DIV0;
      return value - divisor * Math.floor(value / divisor);
    }
    case "SQRT": {
      const value = num(0);
      if (isError(value)) return value;
      return value < 0 ? NUM : Math.sqrt(value);
    }
    case "CONCATENATE":
    case "CONCAT": {
      let text = "";
      for (const { value } of flatten(all())) {
        const part = toText(value);
        if (isError(part)) return part;
        text += part;
      }
      return text;
    }
    case "LEN":
    case "UPPER":
    case "LOWER":
    case "TRIM": {
      const text = toText(one(0));
      if (isError(text)) return text;
      if (name === "LEN") return text.length;
      if (name === "UPPER") return text.toUpperCase();
      if (name === "LOWER") return text.toLowerCase();
      return text.trim().replaceAll(/ +/g, " ");
    }
    case "SUMIF":
    case "COUNTIF":
    case "AVERAGEIF": {
      const range = args[0] === undefined ? null : evaluate(args[0], ctx);
      if (range === null || !isRange(range)) throw new Unsupported(`${name} range`);
      const test = matcher(one(1));
      const sumRange =
        name === "COUNTIF" ? range : args[2] === undefined ? range : evaluate(args[2], ctx);
      if (!isRange(sumRange)) throw new Unsupported(`${name} sum range`);
      let count = 0;
      let sum = 0;
      range.range.forEach((row, rowIndex) =>
        row.forEach((value, colIndex) => {
          if (!test(value)) return;
          count += 1;
          const target = sumRange.range[rowIndex]?.[colIndex] ?? null;
          if (typeof target === "number") sum += target;
        }),
      );
      if (name === "COUNTIF") return count;
      if (name === "SUMIF") return sum;
      return count === 0 ? DIV0 : sum / count;
    }
    case "SUMPRODUCT": {
      const ranges = all();
      if (!ranges.every(isRange)) throw new Unsupported("SUMPRODUCT arguments");
      const [first, ...rest] = ranges as RangeValue[];
      if (first === undefined) return 0;
      let total = 0;
      for (let row = 0; row < first.range.length; row += 1) {
        for (let col = 0; col < first.range[row]!.length; col += 1) {
          let product = 1;
          for (const range of [first, ...rest]) {
            const cell = range.range[row]?.[col];
            if (cell === undefined) return VALUE;
            if (isError(cell)) return cell;
            product *= typeof cell === "number" ? cell : 0;
          }
          total += product;
        }
      }
      return total;
    }
    case "CEILING":
    case "CEILING.MATH":
    case "FLOOR":
    case "FLOOR.MATH": {
      const value = num(0);
      const step = num(1, 1);
      if (isError(value)) return value;
      if (isError(step)) return step;
      if (step === 0) return 0;
      const up = name.startsWith("CEILING");
      const unit = Math.abs(step);
      const ratio = Number((value / unit).toPrecision(15));
      return (up ? Math.ceil(ratio) : Math.floor(ratio)) * unit;
    }
    case "MATCH": {
      const target = one(0);
      const range = args[1] === undefined ? null : evaluate(args[1], ctx);
      if (range === null || !isRange(range)) throw new Unsupported("MATCH range");
      const mode = num(2, 1);
      if (isError(mode)) return mode;
      const list = range.range.length === 1 ? range.range[0]! : range.range.map((row) => row[0]!);
      if (mode === 0) {
        if (typeof target === "string" && /[*?]/.test(target)) throw new Unsupported("wildcards");
        const index = list.findIndex(
          (value) => !isError(value) && value !== null && compare(value, target) === 0,
        );
        return index < 0 ? NA : index + 1;
      }
      // Sorted lists: the last value not past the target (1) or not before it (-1).
      let found = -1;
      list.forEach((value, index) => {
        if (value === null || isError(value)) return;
        const order = compare(value, target);
        if (mode > 0 ? order <= 0 : order >= 0) found = index;
      });
      return found < 0 ? NA : found + 1;
    }
    case "INDEX": {
      const range = args[0] === undefined ? null : evaluate(args[0], ctx);
      if (range === null || !isRange(range)) throw new Unsupported("INDEX range");
      const row = num(1, 1);
      const col = num(2, 1);
      if (isError(row)) return row;
      if (isError(col)) return col;
      const single = range.range.length === 1 && args.length < 3;
      const r = single ? 1 : Math.trunc(row);
      const c = single ? Math.trunc(row) : Math.trunc(col);
      if (r < 1 || c < 1) throw new Unsupported("INDEX of a whole row or column");
      const value = range.range[r - 1]?.[c - 1];
      return value === undefined ? { error: "#REF!" } : value;
    }
    case "VLOOKUP": {
      const target = one(0);
      const range = args[1] === undefined ? null : evaluate(args[1], ctx);
      if (range === null || !isRange(range)) throw new Unsupported("VLOOKUP range");
      const col = num(2);
      if (isError(col)) return col;
      const exact = args.length > 3 ? toBool(one(3)) === false : false;
      if (!exact) throw new Unsupported("approximate VLOOKUP");
      const row = range.range.find(
        (line) => line[0] !== null && !isError(line[0]!) && compare(line[0]!, target) === 0,
      );
      if (row === undefined) return NA;
      const value = row[Math.trunc(col) - 1];
      return value === undefined ? { error: "#REF!" } : value;
    }
    case "NA":
      return NA;
    default:
      throw new Unsupported(`function ${name}`);
  }
}

// ─── Workbook recalculation ─────────────────────────────────────────────────

const parsed = new Map<string, Node | null>();

function parseCached(formula: string): Node | null {
  let node = parsed.get(formula);
  if (node === undefined) {
    try {
      node = parse(formula);
    } catch (cause) {
      if (!(cause instanceof Unsupported)) throw cause;
      node = null;
    }
    if (parsed.size > 5000) parsed.clear();
    parsed.set(formula, node);
  }
  return node;
}

/** What a formula result shows in the grid. */
function displayOfResult(value: Scalar): string {
  if (isError(value)) return value.error;
  if (value === null) return "0";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatResult(value);
  return value;
}

/**
 * Every formula cell recalculated from the current values. A cell the engine cannot work out
 * (unknown function, a cycle, a reference it does not follow) keeps its shown result and is not
 * marked `computed`; a recalculated one is, so the save writes its new cached result.
 */
export function recalculateSheets(sheets: ReadonlyArray<GridSheet>): ReadonlyArray<GridSheet> {
  const byName = new Map(sheets.map((sheet) => [sheet.name.toLowerCase(), sheet]));
  const results = new Map<string, Scalar | "unsupported">();
  const visiting = new Set<string>();
  /** A formula cell's new value, or "unsupported" when the engine cannot work it out. */
  const compute = (sheet: GridSheet, row: number, col: number, formula: string) => {
    const key = `${sheet.name}\0${row}\0${col}`;
    const known = results.get(key);
    if (known !== undefined) return known;
    // A cycle: every cell on it is left to the spreadsheet app.
    if (visiting.has(key)) throw new Unsupported("cycle");
    const node = parseCached(formula);
    let value: Scalar | "unsupported" = "unsupported";
    if (node !== null) {
      visiting.add(key);
      try {
        value = scalar(evaluate(node, { sheet: sheet.name, cell: valueOf }));
      } catch (cause) {
        if (!(cause instanceof Unsupported)) throw cause;
      } finally {
        visiting.delete(key);
      }
    }
    results.set(key, value);
    return value;
  };
  // A referenced formula the engine cannot work out counts with its last cached result.
  const valueOf = (sheetName: string, row: number, col: number): Scalar => {
    const sheet = byName.get(sheetName.toLowerCase());
    if (sheet === undefined) throw new Unsupported(`sheet ${sheetName}`);
    const cell = sheet.rows[row]?.[col] ?? null;
    if (cell === null) return null;
    if (cell.formula === null) return literalOf(cell.display);
    const value = compute(sheet, row, col, cell.formula);
    return value === "unsupported" ? literalOf(cell.display) : value;
  };
  return sheets.map((sheet) => {
    let changed = false;
    const rows = sheet.rows.map((row, rowIndex) => {
      let rowChanged = false;
      const next = row.map((cell, colIndex): GridCell | null => {
        if (cell === null || cell === undefined || cell.formula === null) return cell ?? null;
        const value = compute(sheet, rowIndex, colIndex, cell.formula);
        if (value === "unsupported") return cell;
        const display = displayOfResult(value);
        if (cell.display === display) return cell;
        rowChanged = true;
        return { ...cell, display, computed: true };
      });
      if (!rowChanged) return row;
      changed = true;
      return next;
    });
    return changed ? { ...sheet, rows } : sheet;
  });
}
