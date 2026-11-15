// Zen Staff server hooks (ZED-ZEN fork of T3 Code). See ZEN.md.
import { T3_PROJECT_FILE_NAME } from "@t3tools/contracts";
import { ZEN_APP_SCHEME, ZEN_PROJECT_FILE_NAME } from "@t3tools/contracts/zen";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

export const ZEN_DESKTOP_RENDERER_ORIGINS = [
  `${ZEN_APP_SCHEME}://app`,
  `${ZEN_APP_SCHEME}-dev://app`,
] as const;

/** zen.json wins over t3.json in the same folder; both use the t3.json schema. */
export const resolveProjectFilePath = (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  workspaceRoot: string,
) => {
  const zenPath = path.join(workspaceRoot, ZEN_PROJECT_FILE_NAME);
  return fileSystem.exists(zenPath).pipe(
    Effect.orElseSucceed(() => false),
    Effect.map((hasZen) => (hasZen ? zenPath : path.join(workspaceRoot, T3_PROJECT_FILE_NAME))),
  );
};

/** Clients ask for t3.json by name; serve and save zen.json instead when the project has one. */
export const preferZenProjectFile = <
  Input extends { readonly cwd: string; readonly relativePath: string },
>(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  input: Input,
): Effect.Effect<Input> =>
  input.relativePath.trim() !== T3_PROJECT_FILE_NAME
    ? Effect.succeed(input)
    : resolveProjectFilePath(fileSystem, path, input.cwd).pipe(
        Effect.map((filePath) =>
          path.basename(filePath) === ZEN_PROJECT_FILE_NAME
            ? { ...input, relativePath: ZEN_PROJECT_FILE_NAME }
            : input,
        ),
      );
