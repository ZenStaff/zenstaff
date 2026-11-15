#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Manual-test fixture, not shipped.
// Zen Staff: a tiny remote marketplace for trying the remote registry by hand. Packs the
// invoice-reminder folder next to this file as a .tar.gz and serves:
//   GET /registry.json                 the index (one remote pack, sha256 filled in)
//   GET /registry.json.sig             its Ed25519 signature, from a key made at start; run the
//                                      server with the printed ZEN_REGISTRY_PUBLIC_KEY
//   GET /packs/invoice-reminder.tar.gz the archive
// Run from the repo root:  node apps/server/src/zen/workflows/devRegistry/serve.ts [port]
// then set the registry URL in the app (or ZEN_REGISTRY_URL) to http://127.0.0.1:<port>/registry.json.
// Add --bad-checksum to serve a wrong sha256 (install must be refused), --remote-packs to also
// serve the packs in ../remote-packs (client-radar, outreach-approved, competitor-radar). See ZEN.md.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { writeTarGz } from "./tarGz.ts";

const args = process.argv.slice(2);
const port = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 3990);
const badChecksum = args.includes("--bad-checksum");
const packDir = NodePath.join(import.meta.dirname, "invoice-reminder");

const remotePacks = args.includes("--remote-packs");

/** Every file under `dir`, as archive entries under `prefix`. */
function collect(dir: string, prefix: string): Array<{ path: string; data: Uint8Array }> {
  return NodeFS.readdirSync(dir, { withFileTypes: true })
    .toSorted((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) =>
      entry.isDirectory()
        ? collect(NodePath.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [
            {
              path: `${prefix}${entry.name}`,
              data: NodeFS.readFileSync(NodePath.join(dir, entry.name)),
            },
          ],
    );
}

const archives = new Map<string, Uint8Array>();
archives.set("invoice-reminder", writeTarGz(collect(packDir, "invoice-reminder/")));
const sha256 = NodeCrypto.createHash("sha256")
  .update(archives.get("invoice-reminder")!)
  .digest("hex");
const manifest = JSON.parse(NodeFS.readFileSync(NodePath.join(packDir, "workflow.json"), "utf8"));

const remoteDir = NodePath.join(import.meta.dirname, "..", "remote-packs");
const remoteEntries = remotePacks
  ? (
      JSON.parse(NodeFS.readFileSync(NodePath.join(remoteDir, "index.json"), "utf8"))
        .entries as Array<Record<string, unknown> & { id: string }>
    ).map(({ path: _path, ...entry }) => {
      const archive = writeTarGz(collect(NodePath.join(remoteDir, entry.id), `${entry.id}/`));
      archives.set(entry.id, archive);
      return {
        ...entry,
        download: {
          url: `packs/${entry.id}.tar.gz`,
          sha256: NodeCrypto.createHash("sha256").update(archive).digest("hex"),
          format: "tar.gz",
          size: archive.byteLength,
        },
      };
    })
  : [];

const registry = {
  version: 1,
  entries: [
    {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      icon: manifest.icon,
      version: manifest.version,
      author: manifest.author,
      kind: "pack",
      tags: ["remote"],
      download: {
        url: "packs/invoice-reminder.tar.gz",
        sha256: badChecksum ? "0".repeat(64) : sha256,
        format: "tar.gz",
        size: archives.get("invoice-reminder")!.byteLength,
      },
      i18n: { ro: { name: manifest.i18n.ro.name, description: manifest.i18n.ro.description } },
    },
    ...remoteEntries,
  ],
};
const registryJson = `${JSON.stringify(registry, null, 2)}\n`;
// The app accepts only a signed index: a throwaway key for this fixture.
const signingKeys = NodeCrypto.generateKeyPairSync("ed25519");
const registrySig = NodeCrypto.sign(
  null,
  Buffer.from(registryJson),
  signingKeys.privateKey,
).toString("base64");
const publicKey = signingKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64");

const server = NodeHttp.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  console.log(`${request.method} ${url.pathname}`);
  if (url.pathname === "/registry.json") {
    response.writeHead(200, { "content-type": "application/json" }).end(registryJson);
  } else if (url.pathname === "/registry.json.sig") {
    response.writeHead(200, { "content-type": "text/plain" }).end(registrySig);
  } else if (
    /^\/packs\/[a-z0-9-]+\.tar\.gz$/.test(url.pathname) &&
    archives.has(url.pathname.slice(7, -7))
  ) {
    const archive = archives.get(url.pathname.slice(7, -7))!;
    response
      .writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(archive.byteLength),
      })
      .end(archive);
  } else {
    response.writeHead(404).end("not found");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Dev registry on http://127.0.0.1:${port}/registry.json`);
  console.log(`Pack sha256 ${sha256}${badChecksum ? " (serving a wrong checksum)" : ""}`);
  console.log(`Start the Zen server with ZEN_REGISTRY_PUBLIC_KEY=${publicKey}`);
  for (const entry of remoteEntries)
    console.log(`Remote pack ${entry.id} ${entry.download.sha256}`);
});
