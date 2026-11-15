// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The test serves a fake hub library over node:http.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ZenRegistryEntry } from "@t3tools/contracts/zenOffice";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { newDeviceIdentity, signText, verifyText } from "../hub/hubCrypto.ts";
import {
  CommunityLibrary,
  mergeCommunityEntries,
  packageForLibrary,
  parseCommunityCatalog,
  readPackFolder,
  submissionDigest,
  submissionStatementMessage,
  suggestPackId,
} from "./communityLibrary.ts";
import { writeTarGz } from "./devRegistry/tarGz.ts";
import { sha256Hex } from "./remoteRegistry.ts";
import * as ZenOffice from "./ZenOffice.ts";

const PACK_ID = "oferta-zilei";
const manifest = {
  id: PACK_ID,
  name: "Oferta zilei",
  description: "Scrie oferta zilei.",
  category: "social",
  icon: "utensils",
  version: "1.0.0",
  author: "Ana Pop",
  output: "Textul postării.",
  inputs: [{ id: "restaurant", label: "Restaurant", type: "text", required: true }],
};
const archive = writeTarGz([
  { path: "workflow.json", data: JSON.stringify(manifest) },
  { path: "prompt.md", data: "Scrie oferta zilei pentru {{restaurant}}." },
]);

const community = (overrides: Record<string, unknown> = {}) => ({
  id: PACK_ID,
  name: "Oferta zilei",
  description: "Scrie oferta zilei.",
  category: "social",
  icon: "utensils",
  version: "1.0.0",
  author: "Ana Pop",
  kind: "pack",
  tags: ["community"],
  download: {
    url: `packs/oferta-zilei/1.0.0.tar.gz`,
    sha256: sha256Hex(archive),
    format: "tar.gz",
  },
  community: {
    slug: "oferta-zilei",
    origin: "community",
    verified: true,
    featured: false,
    installs: 120,
    shareUrl: "https://hub.test/p/oferta-zilei",
    screenshots: ["packs/oferta-zilei/screens/0"],
    author: {
      slug: "ana-pop",
      name: "Ana Pop",
      company: "Bistro Ana",
      url: "https://hub.test/a/ana-pop",
    },
  },
  ...overrides,
});

describe("community library helpers", () => {
  it("reads the hub catalog: community packs only, absolute addresses, taken-down packs", () => {
    const text = JSON.stringify({
      version: 1,
      entries: [
        community(),
        { ...community({ id: "fake-builtin", kind: "builtin" }) },
        { ...community({ id: "no-credit" }), community: undefined },
      ],
      withdrawn: [{ id: "old-pack", slug: "old-pack", reason: "Cere parole." }, { nope: 1 }],
    });
    const catalog = parseCommunityCatalog(text, "https://hub.test/v1/library/catalog")!;
    expect(catalog.entries.map((entry) => entry.id)).toEqual([PACK_ID]);
    expect(catalog.entries[0]!.download!.url).toBe(
      "https://hub.test/v1/library/packs/oferta-zilei/1.0.0.tar.gz",
    );
    expect(catalog.entries[0]!.community!.screenshots).toEqual([
      "https://hub.test/v1/library/packs/oferta-zilei/screens/0",
    ]);
    expect(catalog.withdrawn).toEqual([{ id: "old-pack", reason: "Cere parole." }]);
    expect(parseCommunityCatalog("not json", "https://hub.test/x")).toBeNull();
  });

  it("never lets a community pack replace a Zen Staff pack or workflow", () => {
    const ours = [
      {
        entry: { ...community(), id: "newsletter-issue", community: undefined } as ZenRegistryEntry,
        origin: "local",
      },
      {
        entry: {
          ...community(),
          id: "website-health",
          workflows: ["website-gdpr-check"],
          community: undefined,
        } as ZenRegistryEntry,
        origin: "local",
      },
    ];
    const theirs = [
      { ...community(), id: "newsletter-issue" },
      { ...community(), id: "my-kit", workflows: ["website-gdpr-check"] },
      community(),
    ] as Array<ZenRegistryEntry>;
    const merged = mergeCommunityEntries(ours, theirs, (entry) => ({ entry, origin: "community" }));
    expect(merged.map((item) => [item.entry.id, item.origin])).toEqual([
      ["newsletter-issue", "local"],
      ["website-health", "local"],
      [PACK_ID, "community"],
    ]);
  });

  it("packages a workflow folder under the new id, without the app's own files", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "zen-library-pack-"));
    await NodeFSP.writeFile(
      NodePath.join(dir, "workflow.json"),
      JSON.stringify({ ...manifest, id: "newsletter-issue" }),
    );
    await NodeFSP.writeFile(NodePath.join(dir, "prompt.md"), "x");
    await NodeFSP.writeFile(NodePath.join(dir, ".zen-pack.json"), "{}");
    await NodeFSP.writeFile(NodePath.join(dir, ".zen-custom.json"), "{}");
    await NodeFSP.mkdir(NodePath.join(dir, ".zen-custom", "base"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(dir, ".zen-custom", "base", "prompt.md"), "old");
    await NodeFSP.mkdir(NodePath.join(dir, "template"));
    await NodeFSP.writeFile(NodePath.join(dir, "template", "run.mjs"), "console.log(1)");
    const files = await readPackFolder(dir);
    expect([...files.keys()].toSorted()).toEqual([
      "prompt.md",
      "template/run.mjs",
      "workflow.json",
    ]);
    const packaged = packageForLibrary(files, { packId: "newsletter-bistro", version: "1.2.0" });
    const workflow = JSON.parse(Buffer.from(packaged["workflow.json"]!, "base64").toString());
    expect(workflow).toMatchObject({
      id: "newsletter-bistro",
      version: "1.2.0",
      name: "Oferta zilei",
    });
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });

  it("suggests an id that is not a Zen Staff one", () => {
    expect(suggestPackId("Oferta zilei pe Facebook", new Set())).toBe("oferta-zilei-pe-facebook");
    expect(suggestPackId("Newsletter issue", new Set(["newsletter-issue"]))).toBe(
      "newsletter-issue-comunitate",
    );
  });

  it("signs the same digest the hub checks (cross-repo vector from zen-hub submissionDigest)", () => {
    const digest = submissionDigest({
      packId: "oferta-zilei",
      version: "1.0.0",
      meta: {
        title: "Oferta zilei",
        description: "d",
        category: "social",
        icon: "utensils",
        licence: "MIT",
        language: "ro",
        changelog: "",
        sampleOutput: "",
      },
      files: { "workflow.json": "e30=", "prompt.md": "eA==" },
      screenshots: [{ name: "a.png", mime: "image/png", data: "iVBO" }],
    });
    expect(digest).toBe("Q6aNroTfQ6222oGE-M-zeiLhL5eQdyT5L9rjU7t293I");
  });
});

/** A fake hub library: catalog, archive, install counter, and a submissions endpoint that checks the signature. */
interface FakeHub {
  readonly url: string;
  readonly installs: Array<string>;
  /** Resolves on the first install count (the app sends it without waiting). */
  readonly installed: Promise<void>;
  readonly submissions: Array<Record<string, unknown>>;
  withdrawn: Array<{ id: string; slug: string; reason: string }>;
  entries: Array<unknown>;
  publicKey: string;
  close(): Promise<void>;
}

async function startFakeHub(): Promise<FakeHub> {
  let markInstalled = () => {};
  const installed = new Promise<void>((resolve) => {
    markInstalled = resolve;
  });
  const hub = {
    installed,
    installs: [] as Array<string>,
    submissions: [] as Array<Record<string, unknown>>,
    withdrawn: [] as FakeHub["withdrawn"],
    entries: [community()] as Array<unknown>,
    publicKey: "",
  };
  const server = NodeHttp.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/v1/library/catalog")
        return send(200, { version: 1, entries: hub.entries, withdrawn: hub.withdrawn });
      if (request.url === "/v1/library/packs/oferta-zilei/1.0.0.tar.gz") {
        response.writeHead(200, { "content-type": "application/gzip" });
        return response.end(archive);
      }
      if (request.url === "/v1/library/packs/oferta-zilei/install") {
        hub.installs.push(request.headers.authorization ?? "anonymous");
        markInstalled();
        return send(200, { installs: 121 });
      }
      if (request.url === "/v1/library/me/author")
        return send(200, { author: { name: "Ana Pop" } });
      if (request.url === "/v1/library/submissions") {
        const submission = JSON.parse(body) as Record<string, any>;
        const { packId, version, meta, files, screenshots } = submission;
        const digest = submissionDigest({ packId, version, meta, files, screenshots });
        const message = submissionStatementMessage({
          packId: submission.packId,
          version: submission.version,
          digest,
          by: "user-ana",
          ts: submission.ts,
        });
        if (!verifyText(hub.publicKey, message, submission.signature))
          return send(400, { error: "The submission is not signed by this device." });
        hub.submissions.push(submission);
        if (submission.packId === "has-a-secret")
          return send(422, {
            error: "The pack did not pass the automatic checks.",
            code: "checks_failed",
            checks: [{ id: "secrets", level: "fail", findings: ["notes.md: looks like a key"] }],
          });
        return send(200, {
          id: "lv_1",
          slug: submission.packId,
          status: "pending",
          shareUrl: `https://hub.test/p/${submission.packId}`,
        });
      }
      send(404, { error: "Not found." });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as NodeNet.AddressInfo;
  return Object.assign(hub, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}

describe("community library publishing", () => {
  it("packages, signs with the device key and sends a submission; refused checks come back as an answer", async () => {
    const hub = await startFakeHub();
    const device = newDeviceIdentity();
    hub.publicKey = device.signPublicKey;
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "zen-library-src-"));
    await NodeFSP.writeFile(
      NodePath.join(dir, "workflow.json"),
      JSON.stringify({ ...manifest, id: "my-offer" }),
    );
    await NodeFSP.writeFile(NodePath.join(dir, "prompt.md"), "Scrie oferta.");
    const workflow = {
      manifest: { ...manifest, id: "my-offer" },
      prompt: "",
      skill: null,
      source: "user",
      packId: null,
      editable: true,
    } as never;
    const library = new CommunityLibrary({
      hubUrl: () => hub.url,
      token: () => "zhs_token",
      userId: () => "user-ana",
      sign: async (message) => signText(device, message),
      cacheFile: NodePath.join(dir, ".catalog-cache.json"),
      sources: async () => [{ workflow, dir }],
      reservedIds: async () => new Set(["newsletter-issue"]),
    });
    const sources = (await library.call("sources", {})) as {
      sources: Array<{ workflowId: string; kind: string }>;
    };
    expect(sources.sources).toEqual([
      expect.objectContaining({ workflowId: "my-offer", kind: "own" }),
    ]);
    const sent = (await library.call("publish", {
      workflowId: "my-offer",
      packId: "oferta-bistro",
      version: "1.0.0",
      authorName: "Ana Pop",
      meta: {
        title: "Oferta bistro",
        description: "Oferta zilei.",
        category: "social",
        licence: "CC-BY-4.0",
      },
      screenshots: [{ name: "a.png", mime: "image/png", data: "iVBORw0KGgo=" }],
    })) as Record<string, unknown>;
    expect(sent).toMatchObject({ status: "pending", slug: "oferta-bistro", refused: false });
    const submission = hub.submissions[0]!;
    expect(submission.meta).toMatchObject({
      title: "Oferta bistro",
      licence: "CC-BY-4.0",
      language: "ro",
    });
    const packaged = JSON.parse(
      Buffer.from(
        (submission.files as Record<string, string>)["workflow.json"]!,
        "base64",
      ).toString(),
    );
    expect(packaged).toMatchObject({ id: "oferta-bistro", author: "Ana Pop" });

    const refused = (await library.call("publish", {
      workflowId: "my-offer",
      packId: "has-a-secret",
    })) as Record<string, unknown>;
    expect(refused).toMatchObject({
      refused: true,
      checks: [expect.objectContaining({ id: "secrets", level: "fail" })],
    });
    await expect(
      library.call("publish", { workflowId: "my-offer", packId: "newsletter-issue" }),
    ).rejects.toThrow(/belongs to a Zen Staff pack/);
    await expect(library.call("publish", { workflowId: "not-mine" })).rejects.toThrow(
      /Only your own workflows/,
    );
    await hub.close();
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });

  it("asks to sign in before publishing", async () => {
    const library = new CommunityLibrary({
      hubUrl: () => "http://127.0.0.1:9",
      token: () => null,
      userId: () => null,
      sign: async () => "",
      cacheFile: NodePath.join(NodeOS.tmpdir(), "zen-library-none", "catalog.json"),
      sources: async () => [],
      reservedIds: async () => new Set(),
    });
    expect(await library.call("mine", {})).toMatchObject({ signedIn: false });
    await expect(library.call("report", { slug: "x", reason: "unsafe" })).rejects.toThrow(
      /Sign in/,
    );
  });
});

it.layer(Layer.mergeAll(NodeServices.layer, SqlitePersistence.layerMemory))(
  "ZenOffice with the community library",
  (it) => {
    it.effect(
      "merges the catalog, installs a community pack, counts it and warns when it is taken down",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const hub = yield* Effect.promise(() => startFakeHub());
          yield* Effect.addFinalizer(() => Effect.promise(() => hub.close()));
          const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-library-" });
          const office = yield* ZenOffice.make({
            defaultRegistryUrl: null,
            libraryHubUrl: hub.url,
          }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)));
          const market = yield* office.registry;
          expect(market.community).toMatchObject({
            available: true,
            source: `${hub.url}/v1/library/catalog`,
          });
          const item = market.entries.find((candidate) => candidate.entry.id === PACK_ID)!;
          expect(item.entry.community).toMatchObject({
            verified: true,
            installs: 120,
            author: { name: "Ana Pop" },
          });
          // Zen Staff's own entries are all still there, first.
          expect(
            market.entries.filter((candidate) => candidate.entry.kind === "builtin"),
          ).toHaveLength(7);
          expect(market.entries.at(-1)!.entry.id).toBe(PACK_ID);

          const installed = yield* office.installPack({ id: PACK_ID });
          expect(
            installed.entries.find((candidate) => candidate.entry.id === PACK_ID),
          ).toMatchObject({ installed: true });
          expect(yield* fs.exists(path.join(baseDir, "workflows", PACK_ID, "workflow.json"))).toBe(
            true,
          );
          yield* Effect.promise(() => hub.installed);
          expect(hub.installs).toHaveLength(1);

          // Taken down: gone from the catalog, the installed copy stays with the reason.
          hub.entries = [];
          hub.withdrawn = [{ id: PACK_ID, slug: PACK_ID, reason: "Cere parole." }];
          const office2 = yield* ZenOffice.make({
            defaultRegistryUrl: null,
            libraryHubUrl: hub.url,
          }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)));
          const after = yield* office2.registry;
          expect(after.entries.find((candidate) => candidate.entry.id === PACK_ID)).toMatchObject({
            installed: true,
            withdrawn: "Cere parole.",
          });
        }),
    );
  },
);
