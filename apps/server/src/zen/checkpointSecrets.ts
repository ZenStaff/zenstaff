import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

/**
 * Zen Staff: secret-looking files checkpoints never store unless the repository tracks them.
 * Gitignore syntax: capture adds them to `git add` as excludes and restore to `git clean -e`, so
 * they only apply to untracked files. See ZEN.md "Checkpoints skip secret files".
 */
const CHECKPOINT_SECRET_FILE_PATTERNS: ReadonlyArray<string> = [
  ".env",
  ".env.*",
  "!.env.example",
  "!.env.sample",
  "!.env.template",
  ".envrc",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "*.jks",
  "id_rsa*",
  "id_dsa*",
  "id_ecdsa*",
  "id_ed25519*",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "_netrc",
  ".pgpass",
  ".git-credentials",
  "credentials.json",
  "service-account*.json",
  "secrets.json",
  "secrets.yml",
  "secrets.yaml",
  "secrets.toml",
  "secrets.env",
];

/** `["-x", p1, "-x", p2, ...]` for ls-files, `["-e", ...]` for clean. */
export const checkpointSecretPatternArgs = (flag: "-x" | "-e"): Array<string> =>
  CHECKPOINT_SECRET_FILE_PATTERNS.flatMap((pattern) => [flag, pattern]);

/**
 * The global excludes file Git reads when `core.excludesFile` is unset:
 * `$XDG_CONFIG_HOME/git/ignore`, else `~/.config/git/ignore`.
 */
const defaultGlobalExcludesFile = (
  env: NodeJS.ProcessEnv,
  join: (...segments: Array<string>) => string,
): string | undefined => {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "") return join(xdg, "git", "ignore");
  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, ".config", "git", "ignore") : undefined;
};

/** The user's global ignore rules first, then the checkpoint secret rules (later rules win). */
const checkpointExcludesFileContents = (userExcludes: string): string =>
  `${userExcludes}${userExcludes === "" || userExcludes.endsWith("\n") ? "" : "\n"}` +
  `# Zen Staff: checkpoints never store untracked secret files\n` +
  `${CHECKPOINT_SECRET_FILE_PATTERNS.join("\n")}\n`;

/**
 * Writes the excludes file the checkpoint `git add -A` reads through `-c core.excludesFile=`.
 * That setting replaces the user's global excludes file, so its rules are copied in first.
 */
export const writeCheckpointExcludesFile = Effect.fn("ZenCheckpointSecrets.writeExcludesFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly env: NodeJS.ProcessEnv;
    readonly cwd: string;
    /** `git config --path --get core.excludesFile`, empty when unset. */
    readonly configured: string;
    readonly target: string;
  }) {
    const userExcludesFile =
      input.configured !== ""
        ? input.path.resolve(input.cwd, input.configured)
        : defaultGlobalExcludesFile(input.env, input.path.join);
    const userExcludes =
      userExcludesFile === undefined
        ? ""
        : yield* input.fileSystem
            .readFileString(userExcludesFile)
            .pipe(Effect.orElseSucceed(() => ""));
    yield* input.fileSystem.writeFileString(
      input.target,
      checkpointExcludesFileContents(userExcludes),
    );
  },
);
