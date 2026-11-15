// Zen Staff: folder names and paths for the company folder (pure; companyFolder.ts uses them).

/** The folder title in the sidebar: the last part of the path ("Florăria Iris"). */
export function folderTitleOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts.at(-1) ?? path;
}

/**
 * A free variant of a folder path when the plain one already belongs to another company:
 * "<path> (2)", "<path> (3)" ...
 */
export function nextFreeFolder(path: string, taken: (candidate: string) => boolean): string {
  if (!taken(path)) return path;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${path} (${index})`;
    if (!taken(candidate)) return candidate;
  }
  return `${path} (${Date.now()})`;
}

/** A folder next to `path` ("~/Zen Staff/Iris" -> "~/Zen Staff/<name>"), same separator. */
export function siblingFolder(path: string, name: string): string {
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parent = cut > 0 ? path.slice(0, cut) : path;
  return `${parent}${separator}${name}`;
}
