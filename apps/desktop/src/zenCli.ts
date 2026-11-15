// Zen Staff: the desktop's "Install CLI command" installs ZEN_CLI_NAME plus its aliases
// (ZEN_CLI_ALIASES), never upstream's `t3`, so it cannot collide with an installed T3 Code.
// See ZEN.md "CLI command".
import { ZEN_CLI_ALIASES, ZEN_CLI_NAME } from "@t3tools/contracts/zen";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

export { ZEN_CLI_NAME };

/** File name of the launcher in `<base dir>/bin` (on Windows that folder is put on PATH). */
export const zenCliLauncherFileName = (windows: boolean) =>
  windows ? `${ZEN_CLI_NAME}.cmd` : ZEN_CLI_NAME;

/** What another install of the command is called in a folder (the first-launch check). */
export const zenCliCommandFileNames = (windows: boolean): ReadonlyArray<string> =>
  windows ? [`${ZEN_CLI_NAME}.cmd`, `${ZEN_CLI_NAME}.exe`] : [ZEN_CLI_NAME];

/** Every launcher this app writes starts its marker with this (older builds named another CLI). */
const ZEN_LAUNCHER_MARKER_PREFIX = "Written by Zen Staff:";

/**
 * Alias launchers next to the main one (`<home>/bin/zen`, `zenstaff`, `.cmd` on Windows), with the
 * same content. On Windows that folder is on PATH; on macOS/Linux the `zen` links made by
 * 0.2.0-0.2.7 point at `<home>/bin/zen`, so refreshing it keeps them working. A file there that
 * this app did not write is left alone.
 */
export const writeZenCliAliasLaunchers = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  shimPath: string,
  content: string,
  windows: boolean,
) =>
  Effect.forEach(
    ZEN_CLI_ALIASES,
    (alias) => {
      const aliasPath = path.join(path.dirname(shimPath), windows ? `${alias}.cmd` : alias);
      return fs.readFileString(aliasPath).pipe(
        Effect.option,
        Effect.flatMap((existing) =>
          existing._tag === "Some" && !existing.value.includes(ZEN_LAUNCHER_MARKER_PREFIX)
            ? Effect.void
            : fs.writeFileString(aliasPath, content, { mode: 0o755 }),
        ),
        Effect.ignore,
      );
    },
    { discard: true },
  );

/** macOS/Linux: alias links next to the main link; an existing file is left alone. */
export const linkZenCliAliases = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  launcher: string,
  directory: string,
) =>
  Effect.forEach(
    ZEN_CLI_ALIASES,
    (alias) => {
      const link = path.join(directory, alias);
      return fs.exists(link).pipe(
        Effect.flatMap((exists) => (exists ? Effect.void : fs.symlink(launcher, link))),
        Effect.ignore,
      );
    },
    { discard: true },
  );

/** Removes the alias links that point at this app's launcher. */
export const unlinkZenCliAliases = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  launcher: string,
  directory: string,
) =>
  Effect.forEach(
    ZEN_CLI_ALIASES,
    (alias) => {
      const link = path.join(directory, alias);
      return fs.readLink(link).pipe(
        Effect.flatMap((target) => (target === launcher ? fs.remove(link) : Effect.void)),
        Effect.ignore,
      );
    },
    { discard: true },
  );
