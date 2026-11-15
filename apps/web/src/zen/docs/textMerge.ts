// Zen Staff document editing: three-way line merge for text documents (Markdown, HTML, CSV
// source). Base = what the editor opened, mine = the unsaved edit, theirs = what is on disk now.
// Changes on one side only are taken; lines both sides changed differently get conflict
// markers, to be resolved in the Source view.

/** Pairs of equal lines (index in a, index in b), in order: Myers' O(ND) diff. */
export function matchLines(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): Array<[number, number]> {
  // Common prefix and suffix first: most edits touch a small part of a long file.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < start; index += 1) pairs.push([index, index]);
  const middle = myers(a.slice(start, endA), b.slice(start, endB)).map(
    ([x, y]) => [x + start, y + start] as [number, number],
  );
  pairs.push(...middle);
  for (let offset = 0; offset < a.length - endA; offset += 1)
    pairs.push([endA + offset, endB + offset]);
  return pairs;
}

const MAX_EDIT_DISTANCE = 4_000;

function myers(a: ReadonlyArray<string>, b: ReadonlyArray<string>): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Array<Int32Array> = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
  }
  // Too different to diff cheaply: no lines in common (the merge then sees one big change).
  if (found < 0) return [];
  trace.push(v);
  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    pairs.push([x, y]);
  }
  return pairs.reverse();
}

export interface TextMerge {
  readonly text: string;
  readonly conflicts: number;
}

export function mergeText(
  base: string,
  mine: string,
  theirs: string,
  labels: { readonly mine: string; readonly theirs: string } = { mine: "mine", theirs: "theirs" },
): TextMerge {
  if (mine === theirs) return { text: mine, conflicts: 0 };
  if (mine === base) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: mine, conflicts: 0 };
  const b = base.split("\n");
  const m = mine.split("\n");
  const t = theirs.split("\n");
  const toMine = new Map(matchLines(b, m));
  const toTheirs = new Map(matchLines(b, t));
  // Base lines both sides kept unchanged anchor the merge.
  const anchors: Array<[number, number, number]> = [];
  for (let index = 0; index < b.length; index += 1) {
    const mi = toMine.get(index);
    const ti = toTheirs.get(index);
    if (mi === undefined || ti === undefined) continue;
    const last = anchors.at(-1);
    if (last === undefined || (mi > last[1] && ti > last[2])) anchors.push([index, mi, ti]);
  }
  anchors.push([b.length, m.length, t.length]);
  const out: Array<string> = [];
  let conflicts = 0;
  let previous: [number, number, number] = [-1, -1, -1];
  for (const anchor of anchors) {
    const baseHunk = b.slice(previous[0] + 1, anchor[0]);
    const mineHunk = m.slice(previous[1] + 1, anchor[1]);
    const theirsHunk = t.slice(previous[2] + 1, anchor[2]);
    const same = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
      left.length === right.length && left.every((line, index) => line === right[index]);
    if (same(mineHunk, baseHunk)) out.push(...theirsHunk);
    else if (same(theirsHunk, baseHunk) || same(mineHunk, theirsHunk)) out.push(...mineHunk);
    else {
      conflicts += 1;
      out.push(
        `<<<<<<< ${labels.mine}`,
        ...mineHunk,
        "=======",
        ...theirsHunk,
        `>>>>>>> ${labels.theirs}`,
      );
    }
    if (anchor[0] < b.length) out.push(b[anchor[0]]!);
    previous = anchor;
  }
  return { text: out.join("\n"), conflicts };
}
