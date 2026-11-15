// @effect-diagnostics nodeBuiltinImport:off globalDate:off extendsNativeError:off -- plain async code at the hub boundary (called from ZenHub.ts).
// Zen Staff: client approval links ("Trimite clientului spre aprobare"). A finished deliverable in a
// chat's folder (images, a video, a PDF, a post text) is copied to the hub for one of the person's
// hub companies; the client opens the link without an account and approves or asks for changes.
// This file: which files may go, reading them from the workspace (no `..`, no links out, size caps,
// the same kinds the hub accepts), the client's brand (name, color, logo from the company's brand
// profile) and the local list of links per chat (`<state dir>/zen/client-approvals.json`, 0600; it
// keeps the link, which the hub cannot show again). ZEN.md, "Client approval links".
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

/** The same caps as the hub (zen-hub `src/approvalFiles.ts`), checked here before uploading. */
const CLIENT_APPROVAL_LIMITS = {
  image: 15 * 1024 * 1024,
  video: 60 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  text: 512 * 1024,
  logo: 2 * 1024 * 1024,
  files: 10,
  total: 80 * 1024 * 1024,
} as const;

export type ApprovalFileKind = "image" | "video" | "pdf" | "text";

const KINDS: Record<string, ApprovalFileKind> = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".mp4": "video",
  ".m4v": "video",
  ".mov": "video",
  ".webm": "video",
  ".pdf": "pdf",
  ".md": "text",
  ".markdown": "text",
  ".txt": "text",
};

/** What a file name can be sent as; null = not sendable (Word, HTML, SVG, archives...). */
export function approvalKindOf(path: string): ApprovalFileKind | null {
  return KINDS[NodePath.extname(path).toLowerCase()] ?? null;
}

export class ClientApprovalError extends Error {
  readonly reason: "invalid-input" | "not-found" | "forbidden";
  constructor(reason: ClientApprovalError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

const inside = (root: string, target: string) => {
  const relative = NodePath.relative(root, target);
  return relative === "" ? false : !relative.startsWith("..") && !NodePath.isAbsolute(relative);
};

export interface ReadDeliverable {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: ApprovalFileKind;
  readonly bytes: Buffer;
}

/**
 * Reads the files to send from `cwd` (a known workspace, checked by the caller). Relative paths
 * only, resolved through links, refused outside the folder or inside `.git`, sendable kinds only,
 * per-kind and total caps.
 */
export async function readDeliverables(
  cwd: string,
  relativePaths: ReadonlyArray<string>,
): Promise<Array<ReadDeliverable>> {
  if (relativePaths.length === 0)
    throw new ClientApprovalError("invalid-input", "Choose a file to send.");
  if (relativePaths.length > CLIENT_APPROVAL_LIMITS.files) {
    throw new ClientApprovalError(
      "invalid-input",
      `At most ${CLIENT_APPROVAL_LIMITS.files} files per link.`,
    );
  }
  const root = await NodeFSP.realpath(NodePath.resolve(cwd)).catch(() => {
    throw new ClientApprovalError("not-found", "The folder could not be opened.");
  });
  const files: Array<ReadDeliverable> = [];
  let total = 0;
  for (const relativePath of new Set(relativePaths)) {
    if (NodePath.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) {
      throw new ClientApprovalError("forbidden", "Only files inside the folder can be sent.");
    }
    const kind = approvalKindOf(relativePath);
    const name = NodePath.basename(relativePath);
    if (kind === null) {
      throw new ClientApprovalError(
        "invalid-input",
        `${name}: only images, video, PDF and text can be sent for approval. Export a document to PDF first.`,
      );
    }
    const lexical = NodePath.resolve(root, relativePath);
    if (
      !inside(root, lexical) ||
      NodePath.relative(root, lexical).split(NodePath.sep).includes(".git")
    ) {
      throw new ClientApprovalError("forbidden", "The file is outside the folder.");
    }
    const real = await NodeFSP.realpath(lexical).catch(() => {
      throw new ClientApprovalError("not-found", `${name} is no longer there.`);
    });
    if (!inside(root, real))
      throw new ClientApprovalError("forbidden", "The file links outside the folder.");
    const stat = await NodeFSP.stat(real);
    if (!stat.isFile()) throw new ClientApprovalError("invalid-input", `${name} is not a file.`);
    const cap = CLIENT_APPROVAL_LIMITS[kind];
    if (stat.size > cap) {
      throw new ClientApprovalError(
        "invalid-input",
        `${name} is larger than ${cap >= 1024 * 1024 ? `${cap / 1024 / 1024} MB` : `${cap / 1024} KB`}.`,
      );
    }
    total += stat.size;
    if (total > CLIENT_APPROVAL_LIMITS.total) {
      throw new ClientApprovalError(
        "invalid-input",
        `One link holds at most ${CLIENT_APPROVAL_LIMITS.total / 1024 / 1024} MB.`,
      );
    }
    files.push({
      name,
      relativePath: NodePath.relative(root, real).split(NodePath.sep).join("/"),
      kind,
      bytes: await NodeFSP.readFile(real),
    });
  }
  return files;
}

/** The client's brand as the link shows it: name, color, logo (from the company's brand profile). */
export interface ClientBrand {
  readonly name: string;
  readonly color: string | null;
  readonly logo: { readonly name: string; readonly bytes: Buffer } | null;
}

const LOGO_NAMES = ["logo.png", "logo.jpg", "logo.jpeg", "logo.webp", "logo.gif"];

/** `<zen home>/companies/<id>/brand/logo.<ext>`, written by the "Adaugă primul client" form. */
export async function readCompanyLogo(
  zenHome: string,
  companyId: string,
): Promise<ClientBrand["logo"]> {
  if (!/^[a-z0-9-]{1,80}$/.test(companyId)) return null;
  const folder = NodePath.join(zenHome, "companies", companyId, "brand");
  for (const name of LOGO_NAMES) {
    try {
      const bytes = await NodeFSP.readFile(NodePath.join(folder, name));
      if (bytes.length > 0 && bytes.length <= CLIENT_APPROVAL_LIMITS.logo) return { name, bytes };
    } catch {
      // next
    }
  }
  return null;
}

/** The first brand color of the company's onboarding answers, else the company's own color. */
export async function readBrandColor(
  stateDir: string,
  companyId: string,
  companyColor: string | null,
): Promise<string | null> {
  const valid = (value: unknown) =>
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
  if (/^[a-z0-9-]{1,80}$/.test(companyId)) {
    try {
      const raw = JSON.parse(
        await NodeFSP.readFile(
          NodePath.join(stateDir, "zen", "onboarding", `${companyId}.json`),
          "utf8",
        ),
      ) as { answers?: { brandColors?: unknown } };
      const colors = raw.answers?.brandColors;
      if (Array.isArray(colors) && valid(colors[0]) !== null) return colors[0] as string;
    } catch {
      // no profile
    }
  }
  return valid(companyColor);
}

export interface LocalApprovalRecord {
  readonly id: string;
  readonly url: string;
  readonly threadId: string | null;
  readonly hubCompanyId: string;
  readonly localCompanyId: string | null;
  readonly title: string;
  readonly clientName: string;
  readonly files: ReadonlyArray<{ readonly name: string; readonly kind: ApprovalFileKind }>;
  readonly createdAt: string;
  /** The last status this machine saw (for "status changed" notices in the app). */
  readonly lastStatus: string;
}

interface ApprovalsFile {
  readonly version: 1;
  readonly records: ReadonlyArray<LocalApprovalRecord>;
}

export async function loadApprovalRecords(file: string): Promise<Array<LocalApprovalRecord>> {
  try {
    const raw = JSON.parse(await NodeFSP.readFile(file, "utf8")) as Partial<ApprovalsFile>;
    return Array.isArray(raw.records)
      ? raw.records.filter(
          (record): record is LocalApprovalRecord =>
            typeof record?.id === "string" && typeof record.url === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** At most 500 links are remembered (the oldest go first). */
export async function saveApprovalRecords(
  file: string,
  records: ReadonlyArray<LocalApprovalRecord>,
): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const body: ApprovalsFile = { version: 1, records: records.slice(-500) };
  const temp = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temp, JSON.stringify(body, null, 2), { mode: 0o600 });
  await NodeFSP.rename(temp, file);
}

/** The deliverable's title: what the person typed, else the first file's name without extension. */
export function defaultApprovalTitle(names: ReadonlyArray<string>): string {
  const first = names[0] ?? "Material";
  const base = first
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const title = base === "" ? first : base.charAt(0).toUpperCase() + base.slice(1);
  return names.length > 1 ? `${title} (+${names.length - 1})` : title;
}
