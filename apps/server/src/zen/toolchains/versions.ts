// Zen Staff: version comparison and ranges for the tool catalog. Tool versions are dotted numbers
// ("8.1.3", "2026.10.21", "0.13.5"); a leading "v" and anything after "-" or "+" are ignored for
// ordering. Ranges: "*", "x", exact "1.2.3", ">=8", ">6 <9", "^4.0.500", "~3.12", "1.2.x",
// alternatives with "||". Kept tiny on purpose: the catalog is ours, not arbitrary npm ranges.

function parts(version: string): number[] {
  const core = version.trim().replace(/^v/i, "").split(/[-+]/, 1)[0] ?? "";
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isNaN(value) ? 0 : value;
  });
}

export function compareVersions(left: string, right: string): number {
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function isValidVersion(version: string): boolean {
  return /^v?\d+(\.\d+)*([-+].*)?$/.test(version.trim());
}

function matchesComparator(version: string, comparator: string): boolean {
  const text = comparator.trim();
  if (text === "" || text === "*" || text === "x") return true;
  const match = /^(>=|<=|>|<|=|\^|~)?\s*v?([\d.x*]+)$/.exec(text);
  if (!match) return false;
  const [, op = "=", target = ""] = match;
  const wildcard = target.split(".").findIndex((part) => part === "x" || part === "*");
  if (wildcard >= 0) {
    // "1.2.x": same leading parts.
    const want = parts(target.split(".").slice(0, wildcard).join("."));
    const have = parts(version);
    return want.every((part, index) => have[index] === part);
  }
  const cmp = compareVersions(version, target);
  switch (op) {
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    case "^": {
      // Same first non-zero part, and not lower.
      const want = parts(target);
      const have = parts(version);
      const lead = want.findIndex((part) => part !== 0);
      const fixed = lead === -1 ? want.length : lead + 1;
      return cmp >= 0 && want.slice(0, fixed).every((part, index) => have[index] === part);
    }
    case "~": {
      // Same major and minor (or same major when only a major is given), and not lower.
      const want = parts(target);
      const have = parts(version);
      const fixed = Math.min(2, target.split(".").length);
      return cmp >= 0 && want.slice(0, fixed).every((part, index) => have[index] === part);
    }
    default:
      return false;
  }
}

/** Whether `version` is in `range`. An unparsable range matches nothing. */
export function satisfiesRange(version: string, range: string | undefined): boolean {
  if (range === undefined || range.trim() === "") return true;
  return range.split("||").some((alternative) =>
    alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
      .split(/\s+/)
      .every((comparator) => matchesComparator(version, comparator)),
  );
}

/** Whether every comparator in the range parses. */
export function isValidRange(range: string): boolean {
  return range.split("||").every((alternative) =>
    alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
      .split(/\s+/)
      .every(
        (comparator) => comparator === "" || /^(>=|<=|>|<|=|\^|~)?v?[\d.x*]+$/.test(comparator),
      ),
  );
}
