// Zen Staff: what an agent asks permission for, in plain words, for the Office edition. A pending
// approval carries upstream's raw detail ("Bash: curl -sI https://...", "Write: /path/file.md",
// "mcp__server__tool: {...}"); this turns it into an action and a short subject the chat row
// shows, with the raw text behind "Details". Pure, tested in officeApprovals.test.ts.

export type OfficeApprovalAction =
  | "download"
  | "downloadVideo"
  | "checkSite"
  | "openWeb"
  | "searchWeb"
  | "editMedia"
  | "inspectMedia"
  | "runScript"
  | "installSoftware"
  | "deleteFiles"
  | "createFolder"
  | "copyFiles"
  | "moveFiles"
  | "listFiles"
  | "readFile"
  | "searchFiles"
  | "writeFile"
  | "editFile"
  | "convertDocument"
  | "archive"
  | "versionControl"
  | "changePermissions"
  | "stopProgram"
  | "scheduleTask"
  | "useApp"
  | "delegate"
  | "plan"
  | "runCommand"
  | "other";

export interface OfficeApprovalDescription {
  readonly action: OfficeApprovalAction;
  /** A file name, a site, an app or a program; short, never the whole command. */
  readonly subject: string | null;
  /** How many steps a chained command has (`a && b | c` = 3); 1 for anything else. */
  readonly steps: number;
}

/** Claude tool names that can open a detail ("Bash: ..."), lowercased without separators. */
const TOOL_ACTIONS: Readonly<Record<string, OfficeApprovalAction>> = {
  write: "writeFile",
  edit: "editFile",
  multiedit: "editFile",
  notebookedit: "editFile",
  read: "readFile",
  glob: "searchFiles",
  grep: "searchFiles",
  ls: "listFiles",
  webfetch: "openWeb",
  websearch: "searchWeb",
  task: "delegate",
  agent: "delegate",
  todowrite: "plan",
};

const PROGRAM_ACTIONS: Readonly<Record<string, OfficeApprovalAction>> = {
  curl: "download",
  wget: "download",
  http: "download",
  "yt-dlp": "downloadVideo",
  "youtube-dl": "downloadVideo",
  dig: "checkSite",
  nslookup: "checkSite",
  host: "checkSite",
  whois: "checkSite",
  openssl: "checkSite",
  ping: "checkSite",
  traceroute: "checkSite",
  lighthouse: "checkSite",
  ffmpeg: "editMedia",
  magick: "editMedia",
  convert: "editMedia",
  sox: "editMedia",
  ffprobe: "inspectMedia",
  exiftool: "inspectMedia",
  mediainfo: "inspectMedia",
  node: "runScript",
  python: "runScript",
  python3: "runScript",
  deno: "runScript",
  bun: "runScript",
  tsx: "runScript",
  sh: "runScript",
  bash: "runScript",
  rm: "deleteFiles",
  rmdir: "deleteFiles",
  unlink: "deleteFiles",
  trash: "deleteFiles",
  mkdir: "createFolder",
  cp: "copyFiles",
  rsync: "copyFiles",
  mv: "moveFiles",
  ls: "listFiles",
  find: "listFiles",
  tree: "listFiles",
  du: "listFiles",
  cat: "readFile",
  head: "readFile",
  tail: "readFile",
  less: "readFile",
  wc: "readFile",
  file: "readFile",
  stat: "readFile",
  jq: "readFile",
  grep: "searchFiles",
  rg: "searchFiles",
  pandoc: "convertDocument",
  libreoffice: "convertDocument",
  soffice: "convertDocument",
  pdftotext: "convertDocument",
  zip: "archive",
  unzip: "archive",
  tar: "archive",
  gzip: "archive",
  gunzip: "archive",
  "7z": "archive",
  git: "versionControl",
  chmod: "changePermissions",
  chown: "changePermissions",
  kill: "stopProgram",
  pkill: "stopProgram",
  killall: "stopProgram",
  touch: "writeFile",
  tee: "writeFile",
};

const INSTALLERS = new Set(["npm", "pnpm", "yarn", "pip", "pip3", "uv", "apt", "apt-get", "brew"]);
const INSTALL_VERBS = new Set(["install", "i", "add", "ci"]);
/** Words that only set up the real program: `sudo`, `env`, `time`, `nice`, `npx`, `uvx`. */
const WRAPPERS = new Set(["sudo", "env", "time", "nice", "nohup", "npx", "pnpx", "uvx", "exec"]);

/** Commands that only look around or print; the step that matters comes after them. */
const TRIVIAL = new Set([
  "pwd",
  "echo",
  "printf",
  "true",
  "false",
  "test",
  "[",
  "which",
  "type",
  "date",
  "sleep",
  "whoami",
  "uname",
]);

const basename = (value: string) =>
  value
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop() ?? value;

function hostOf(text: string): string | null {
  const match = /https?:\/\/([^/\s"'`]+)/i.exec(text);
  if (match) return match[1]!.replace(/^www\./, "").toLowerCase();
  return null;
}

/** Splits a shell line into words, keeping quoted text together. Good enough to name things. */
function shellWords(segment: string): string[] {
  const words: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(segment); match; match = pattern.exec(segment)) {
    words.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return words;
}

function describeProgram(segment: string): OfficeApprovalDescription | null {
  const words = shellWords(segment.trim());
  // Leading variable assignments (`LANG=C ffmpeg ...`) and wrappers are not the program.
  while (
    words.length > 0 &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!) || WRAPPERS.has(words[0]!))
  ) {
    words.shift();
  }
  const program = words[0] ? basename(words[0]).toLowerCase() : "";
  if (!program || program === "cd" || program === "export" || program === "set") return null;
  if (TRIVIAL.has(program)) {
    // `echo text > notes.md` writes a file; a bare echo or pwd is not worth naming.
    const redirect = /\s>{1,2}\s*([^\s|;&]+)/.exec(segment);
    return redirect ? { action: "writeFile", subject: basename(redirect[1]!), steps: 1 } : null;
  }
  const args = words.slice(1);
  const notFlags = args.filter((word) => !word.startsWith("-"));
  if (INSTALLERS.has(program) && INSTALL_VERBS.has(notFlags[0] ?? "")) {
    return { action: "installSoftware", subject: notFlags.slice(1).join(" ") || null, steps: 1 };
  }
  const action = PROGRAM_ACTIONS[program];
  if (!action) {
    if (program.startsWith("python") || program.startsWith("node")) {
      return { action: "runScript", subject: notFlags[0] ? basename(notFlags[0]) : null, steps: 1 };
    }
    return { action: "runCommand", subject: program, steps: 1 };
  }
  switch (action) {
    case "download":
    case "checkSite":
    case "downloadVideo":
      return { action, subject: hostOf(segment) ?? notFlags.at(-1) ?? null, steps: 1 };
    case "runScript": {
      const script = notFlags.find((word) => /\.[a-z0-9]{1,5}$/i.test(word));
      if ((program === "sh" || program === "bash") && args[0] === "-c") {
        return { action: "runCommand", subject: null, steps: 1 };
      }
      return { action, subject: script ? basename(script) : null, steps: 1 };
    }
    case "editMedia":
    case "inspectMedia": {
      const files = notFlags.filter((word) => /\.[a-z0-9]{2,5}$/i.test(word));
      return { action, subject: files.length > 0 ? basename(files.at(-1)!) : null, steps: 1 };
    }
    case "versionControl":
    case "changePermissions":
    case "stopProgram":
      return { action, subject: null, steps: 1 };
    default: {
      const target = notFlags.at(-1);
      return { action, subject: target ? basename(target) : null, steps: 1 };
    }
  }
}

/** Describes a shell command: the first real program, and how many steps are chained. */
export function describeCommand(command: string): OfficeApprovalDescription {
  const segments = command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const described = segments
    .map(describeProgram)
    .filter((item): item is OfficeApprovalDescription => item !== null);
  const first =
    described.find((item) => item.action !== "readFile" && item.action !== "listFiles") ??
    described.find((item) => item.action === "readFile") ??
    described[0];
  if (!first) return { action: "runCommand", subject: null, steps: Math.max(1, segments.length) };
  return { ...first, steps: Math.max(1, described.length) };
}

function humanizeToolName(name: string): string {
  return name.replace(/[_-]+/g, " ").trim();
}

function describeMcp(tool: string): OfficeApprovalDescription {
  // mcp__<server>__<tool>
  const [, server = "", name = ""] = tool.split("__");
  if (/schedule/i.test(name)) return { action: "scheduleTask", subject: null, steps: 1 };
  const app = humanizeToolName(server) || null;
  return {
    action: "useApp",
    subject: app && name ? `${app}: ${humanizeToolName(name)}` : app,
    steps: 1,
  };
}

/**
 * The plain-language reading of a pending approval. `detail` is upstream's text; when it starts
 * with a known tool name ("Bash: ", "Write: ", "mcp__x__y: ") the rest is that tool's input.
 */
export function describeApproval(approval: {
  /** Upstream's kind: command, file-change, file-read, permission, mcp-elicitation. */
  readonly requestKind: string;
  readonly detail?: string | undefined;
}): OfficeApprovalDescription {
  const detail = approval.detail?.trim() ?? "";
  const prefixed = /^([A-Za-z][\w.-]*?): ([\s\S]*)$/.exec(detail);
  const tool = prefixed?.[1] ?? null;
  const body = prefixed?.[2]?.trim() ?? detail;
  if (tool && tool.startsWith("mcp__")) return describeMcp(tool);
  const normalized = tool?.toLowerCase().replaceAll(/[\s_-]/g, "") ?? null;
  if (normalized === "bash" || normalized === "shell" || normalized === "monitor") {
    return describeCommand(body);
  }
  const toolAction = normalized ? TOOL_ACTIONS[normalized] : undefined;
  if (toolAction) {
    if (toolAction === "openWeb") {
      return { action: toolAction, subject: hostOf(body), steps: 1 };
    }
    if (toolAction === "searchWeb") {
      const query = /"query"\s*:\s*"([^"]{1,80})/.exec(body)?.[1] ?? null;
      return { action: toolAction, subject: query, steps: 1 };
    }
    if (toolAction === "delegate" || toolAction === "plan") {
      return { action: toolAction, subject: null, steps: 1 };
    }
    const path = body.startsWith("{") ? null : body;
    return { action: toolAction, subject: path ? basename(path) : null, steps: 1 };
  }
  switch (approval.requestKind) {
    case "file-change":
      return { action: "editFile", subject: detail ? basename(body) : null, steps: 1 };
    case "file-read":
      return { action: "readFile", subject: detail ? basename(body) : null, steps: 1 };
    case "command":
      // Codex and others send the bare command.
      if (!tool && detail) return describeCommand(detail);
      return { action: "other", subject: tool ? humanizeToolName(tool) : null, steps: 1 };
    default:
      return { action: "useApp", subject: tool ? humanizeToolName(tool) : null, steps: 1 };
  }
}

/** Actions that change or delete things, shown with a warning tone. */
export function isRiskyApprovalAction(action: OfficeApprovalAction): boolean {
  return (
    action === "deleteFiles" ||
    action === "installSoftware" ||
    action === "changePermissions" ||
    action === "stopProgram" ||
    action === "versionControl"
  );
}

/**
 * Actions that stay inside the folder (reading, writing, organizing the person's own files). In
 * the "Automat" mode they run alone; they only reach the chat when the person asked to be asked at
 * every step. Everything else may leave the company and waits for "Aprobă" (trust model).
 */
export function isInFolderApprovalAction(action: OfficeApprovalAction): boolean {
  return (
    action === "readFile" ||
    action === "listFiles" ||
    action === "searchFiles" ||
    action === "writeFile" ||
    action === "editFile" ||
    action === "createFolder" ||
    action === "copyFiles" ||
    action === "moveFiles" ||
    action === "convertDocument" ||
    action === "archive" ||
    action === "plan"
  );
}
