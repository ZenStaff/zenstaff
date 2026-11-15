// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off -- Small owner-only files and a promise boundary around the website reader.
// Zen Staff onboarding interview service (`zen.onboarding.call {op, input}`): keeps each company's
// interview (resumable, skippable), reads the website and documents to prefill it, and saves the
// company profile: `company-profile.md` in the company folder, the company's local memory folder
// (Claude Code's autoMemoryDirectory) and, when connected, the hosted company memory through the
// memory client's queue. The flow itself is pure (contracts/zenOnboarding.ts); the web drives it.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import {
  ZEN_ONBOARDING_WS_METHODS,
  ZEN_PERSONAL_COMPANY_ID,
  ZenOnboardingError,
  buildCompanyProfile,
  initialOnboarding,
  sanitizeAnswers,
  sanitizeState,
  type OnboardingPrefill,
  type OnboardingState,
  type ZenOnboardingCallInput,
} from "@t3tools/contracts/zenCompanies";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { resolveCompanyMemoryDirectory, type StoredCompany } from "../companies/companiesStore.ts";
import { zenMemoryWriter } from "../memory/memoryWriter.ts";
import { companyWorkFolder } from "./workFolder.ts";
import {
  ONBOARDING_MODEL,
  basicPrefill,
  buildPrefillPrompt,
  documentText,
  parsePrefillReply,
  readWebsite,
} from "./prefill.ts";

export class ZenOnboarding extends Context.Service<
  ZenOnboarding,
  {
    readonly call: (input: ZenOnboardingCallInput) => Effect.Effect<unknown, ZenOnboardingError>;
  }
>()("t3/zen/onboarding/ZenOnboarding") {}

const isOnboardingError = Schema.is(ZenOnboardingError);
const fail = (reason: ZenOnboardingError["reason"], detail: string) =>
  new ZenOnboardingError({ reason, detail });

type Json = Record<string, unknown>;
const asInput = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};
const companyIdOf = (input: Json): string => {
  const value = input.companyId;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    throw fail("invalid-input", "companyId is not valid.");
  return value;
};
const localeOf = (input: Json): "en" | "ro" => (input.locale === "en" ? "en" : "ro");

function writePrivate(file: string, text: string) {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, text, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** A file name without folders, control characters or a leading dot. */
export function safeDocumentName(name: string): string {
  const base = NodePath.basename(name.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return (base || "document").slice(0, 120);
}

/** The line in the memory folder's MEMORY.md index that points at the profile (added once). */
export function memoryIndexWithProfile(
  existing: string,
  name: string,
  locale: "en" | "ro",
): string {
  if (existing.includes("(company-profile.md)")) return existing;
  const line =
    locale === "ro"
      ? `- [Profilul companiei ${name}](company-profile.md): ce vindem, clienți, prețuri, vocea brandului; citește-l înainte de orice text pentru clienți`
      : `- [${name} company profile](company-profile.md): what we sell, customers, prices, brand voice; read it before writing for customers`;
  const base = existing.trim() === "" ? "# Memory\n" : existing.replace(/\s*$/, "\n");
  return `${base}${line}\n`;
}

interface GlobalState {
  readonly firstRunDone: boolean;
  /** Companies already offered the interview (new ones get it once). */
  readonly seenCompanies: ReadonlyArray<string>;
}

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const textGeneration = yield* Effect.serviceOption(TextGeneration.TextGeneration);
  const services = yield* Effect.context<never>();
  const runPromise = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(services)(effect);

  const dir = NodePath.join(serverConfig.stateDir, "zen", "onboarding");
  const globalFile = NodePath.join(dir, "global.json");
  const companiesFile = NodePath.join(serverConfig.stateDir, "zen", "companies.json");
  const companyFolder = (companyId: string) =>
    NodePath.join(serverConfig.baseDir, "companies", companyId);
  const stateFile = (companyId: string) => NodePath.join(dir, `${companyId}.json`);
  const nowIso = () => new Date().toISOString();

  const companies = (): StoredCompany[] => {
    const raw = asInput(readJson(companiesFile));
    return Array.isArray(raw.companies)
      ? (raw.companies as unknown[]).flatMap((item) => {
          const company = asInput(item);
          return typeof company.id === "string"
            ? [
                {
                  id: company.id,
                  name: typeof company.name === "string" ? company.name : company.id,
                  color: "",
                  icon: "",
                  memoryDirectory:
                    typeof company.memoryDirectory === "string" ? company.memoryDirectory : null,
                  createdAt: typeof company.createdAt === "string" ? company.createdAt : "",
                },
              ]
            : [];
        })
      : [];
  };

  const loadGlobal = (): GlobalState | null => {
    const raw = readJson(globalFile);
    if (raw === null) return null;
    const value = asInput(raw);
    return {
      firstRunDone: value.firstRunDone === true,
      seenCompanies: Array.isArray(value.seenCompanies)
        ? value.seenCompanies.filter((item): item is string => typeof item === "string")
        : [],
    };
  };
  const saveGlobal = (state: GlobalState) =>
    writePrivate(globalFile, JSON.stringify(state, null, 2));
  // On the very first look, companies that already exist are not "new" (an existing install
  // that updates does not get the interview for old companies; first run still asks once).
  const globalState = (): GlobalState => {
    const existing = loadGlobal();
    if (existing !== null) return existing;
    const seeded: GlobalState = {
      firstRunDone: false,
      seenCompanies: companies().map((company) => company.id),
    };
    saveGlobal(seeded);
    return seeded;
  };

  const loadState = (companyId: string): OnboardingState => {
    const raw = readJson(stateFile(companyId));
    return raw === null
      ? initialOnboarding(companyId, nowIso())
      : sanitizeState(raw, companyId, nowIso());
  };
  const saveState = (state: OnboardingState) => {
    writePrivate(stateFile(state.companyId), JSON.stringify(state, null, 2));
    if (state.status === "done" || state.status === "skipped") {
      const current = globalState();
      saveGlobal({
        firstRunDone: true,
        seenCompanies: [...new Set([...current.seenCompanies, state.companyId])],
      });
    }
  };

  const ask = async (prompt: string): Promise<string | null> => {
    if (Option.isNone(textGeneration)) return null;
    // The model runs in an empty folder: it must not read any project.
    const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-onboarding-"));
    try {
      const generated = await runPromise(
        textGeneration.value
          .generateTranscriptionPostProcessing({
            cwd,
            prompt,
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: ONBOARDING_MODEL,
            } as ModelSelection,
          })
          .pipe(
            Effect.map((result) => result.transcription as string | null),
            Effect.tapError((error) =>
              Effect.logWarning("Zen onboarding: the prefill model failed", error),
            ),
            Effect.orElseSucceed(() => null),
          ),
      );
      return generated;
    } finally {
      NodeFS.rmSync(cwd, { recursive: true, force: true });
    }
  };

  const prefillFrom = async (input: {
    kind: "website" | "document";
    label: string;
    text: string;
    title: string | null;
    description: string | null;
    siteName: string | null;
    locale: "en" | "ro";
  }): Promise<{ prefill: OnboardingPrefill; usedModel: boolean }> => {
    const reply = input.text.trim() === "" ? null : await ask(buildPrefillPrompt(input));
    const parsed = reply === null ? null : parsePrefillReply(reply);
    const fields = parsed ?? basicPrefill(input);
    return {
      prefill: { source: input.kind, label: input.label, fields, at: nowIso() },
      usedModel: parsed !== null,
    };
  };

  const run = async (op: ZenOnboardingCallInput["op"], raw: unknown): Promise<unknown> => {
    const input = asInput(raw);
    switch (op) {
      case "status": {
        const global = globalState();
        const all = companies();
        const states = Object.fromEntries(
          all.map((company) => {
            const state = loadState(company.id);
            return [
              company.id,
              { status: state.status, step: state.step, updatedAt: state.updatedAt },
            ];
          }),
        );
        return {
          firstRun: !global.firstRunDone,
          newCompanies: all
            .filter(
              (company) =>
                company.id !== ZEN_PERSONAL_COMPANY_ID &&
                !global.seenCompanies.includes(company.id) &&
                loadState(company.id).status === "not-started",
            )
            .map((company) => ({ id: company.id, name: company.name })),
          states,
        };
      }
      case "get": {
        const companyId = companyIdOf(input);
        const state = loadState(companyId);
        const company = companies().find((item) => item.id === companyId);
        return {
          state,
          memoryConnected: zenMemoryWriter()?.connected(companyId) ?? false,
          localMemory:
            company === undefined
              ? null
              : resolveCompanyMemoryDirectory(company, {
                  zenHome: serverConfig.baseDir,
                  userHome: NodeOS.homedir(),
                }),
          profilePath: NodePath.join(companyFolder(companyId), "company-profile.md"),
          // A folder for the company's first tasks when it has no project yet: ~/Zen Staff/<Company>.
          workFolder: companyWorkFolder(
            NodeOS.homedir(),
            companyId === ZEN_PERSONAL_COMPANY_ID ? null : company?.name,
            localeOf(input) === "en" ? "My work" : "Munca mea",
          ),
        };
      }
      case "save": {
        const companyId = companyIdOf(input);
        const state = sanitizeState(input.state, companyId, nowIso());
        saveState(state);
        return state;
      }
      case "dismissFirstRun": {
        const current = globalState();
        const companyId = typeof input.companyId === "string" ? input.companyId : null;
        saveGlobal({
          firstRunDone: true,
          seenCompanies: [
            ...new Set([...current.seenCompanies, ...(companyId === null ? [] : [companyId])]),
          ],
        });
        return { ok: true };
      }
      case "prefill.website": {
        const url = typeof input.url === "string" ? input.url : "";
        let reading;
        try {
          reading = await readWebsite(url);
        } catch (cause) {
          throw fail(
            "unreachable",
            cause instanceof Error ? cause.message : "The website could not be read.",
          );
        }
        const result = await prefillFrom({
          kind: "website",
          label: reading.url,
          text: reading.text,
          title: reading.title,
          description: reading.description,
          siteName: reading.siteName,
          locale: localeOf(input),
        });
        return { ...result, pages: reading.pages };
      }
      case "prefill.document": {
        const companyId = companyIdOf(input);
        const name = safeDocumentName(typeof input.name === "string" ? input.name : "document");
        const base64 = typeof input.base64 === "string" ? input.base64 : "";
        if (base64 === "" || base64.length > 14_000_000)
          throw fail("invalid-input", "The document is empty or larger than 10 MB.");
        const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
        // The document stays with the company, for its agents.
        const target = NodePath.join(companyFolder(companyId), "documents", name);
        NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true, mode: 0o700 });
        NodeFS.writeFileSync(target, bytes, { mode: 0o600 });
        const text = await documentText(name, bytes);
        if (text === null)
          throw fail(
            "invalid-input",
            "This file type cannot be read here. Try PDF, Word (.docx), text or CSV.",
          );
        const result = await prefillFrom({
          kind: "document",
          label: name,
          text,
          title: null,
          description: null,
          siteName: null,
          locale: localeOf(input),
        });
        return { ...result, path: target, chars: text.length };
      }
      case "profile.save": {
        const companyId = companyIdOf(input);
        const locale = localeOf(input);
        const answers = sanitizeAnswers(input.answers);
        const profile = buildCompanyProfile(answers, locale, nowIso().slice(0, 10));
        const folder = companyFolder(companyId);
        const profilePath = NodePath.join(folder, "company-profile.md");
        writePrivate(profilePath, profile.markdown);
        let memory: OnboardingState["memory"] = "file-only";
        let memoryDetail: string | null = null;
        if (input.toMemory !== false) {
          // Local memory: the company's Claude Code memory folder (agents read it every session).
          const company = companies().find((item) => item.id === companyId);
          const memoryDir =
            company === undefined
              ? null
              : resolveCompanyMemoryDirectory(company, {
                  zenHome: serverConfig.baseDir,
                  userHome: NodeOS.homedir(),
                });
          if (memoryDir !== null) {
            writePrivate(NodePath.join(memoryDir, "company-profile.md"), profile.markdown);
            const index = NodePath.join(memoryDir, "MEMORY.md");
            let existing = "";
            try {
              existing = NodeFS.readFileSync(index, "utf8");
            } catch {
              existing = "";
            }
            writePrivate(
              index,
              memoryIndexWithProfile(existing, answers.companyName ?? companyId, locale),
            );
            memory = "local";
          }
          // Hosted memory, when the company is connected: the same queue as conversations.
          const writer = zenMemoryWriter();
          if (writer !== null && writer.connected(companyId)) {
            const saved = await writer.saveDocument(companyId, {
              key: `onboarding:${companyId}`,
              title:
                locale === "ro" ? "Profilul companiei (interviu)" : "Company profile (interview)",
              text: profile.memoryText,
            });
            memory = "hosted";
            memoryDetail = [saved.status, saved.detail].filter(Boolean).join(": ");
          }
        }
        const state = loadState(companyId);
        saveState({ ...state, answers, profileSavedAt: nowIso(), memory, updatedAt: nowIso() });
        return { path: profilePath, memory, memoryDetail, profile };
      }
      case "brand.setLogo": {
        // The client's logo for the brand profile (and the approval page). Raster images only, 2 MB.
        const companyId = companyIdOf(input);
        const base64 = typeof input.base64 === "string" ? input.base64 : "";
        const bytes = Buffer.from(base64, "base64");
        const ext = logoExtension(bytes);
        if (base64 === "" || ext === null)
          throw fail("invalid-input", "The logo must be a PNG, JPEG, WebP or GIF image.");
        if (bytes.length > 2 * 1024 * 1024)
          throw fail("invalid-input", "The logo is larger than 2 MB.");
        const folder = NodePath.join(companyFolder(companyId), "brand");
        NodeFS.mkdirSync(folder, { recursive: true, mode: 0o700 });
        for (const name of NodeFS.readdirSync(folder)) {
          if (/^logo\.(png|jpe?g|webp|gif)$/.test(name)) NodeFS.rmSync(NodePath.join(folder, name));
        }
        const name = `logo.${ext}`;
        NodeFS.writeFileSync(NodePath.join(folder, name), bytes, { mode: 0o600 });
        return { name, path: NodePath.join(folder, name) };
      }
      default:
        throw fail("invalid-input", "Unknown operation.");
    }
  };

  const call = (input: ZenOnboardingCallInput) =>
    Effect.tryPromise({
      try: () => run(input.op, input.input),
      catch: (cause) =>
        isOnboardingError(cause)
          ? cause
          : fail("unavailable", cause instanceof Error ? cause.message : "Onboarding failed."),
    });

  return ZenOnboarding.of({ call });
});

/** The logo's file extension from its first bytes (never from the name). */
export function logoExtension(bytes: Uint8Array): "png" | "jpg" | "webp" | "gif" | null {
  const at = (offset: number, values: ReadonlyArray<number>) =>
    values.every((value, index) => bytes[offset + index] === value);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (at(0, [0xff, 0xd8, 0xff])) return "jpg";
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "webp";
  return null;
}

export const layer = Layer.effect(ZenOnboarding, make);

/** RPC handler for ws.ts; optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenOnboarding["Service"]>) => ({
  [ZEN_ONBOARDING_WS_METHODS.call]: (input: ZenOnboardingCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(
          fail("unavailable", "The onboarding interview is not available on this server."),
        ),
});
