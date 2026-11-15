// @effect-diagnostics nodeBuiltinImport:off - checks mirror keys against the shipped catalog files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseCatalogEntry } from "./catalog.ts";
import {
  DEFAULT_TOOLS_MIRROR,
  downloadSources,
  isValidMirrorSetting,
  mirrorKey,
  mirrorUrl,
  normalizeMirrorBase,
  resolveMirrorBases,
} from "./mirror.ts";

const step = (url: string, extra: Record<string, unknown> = {}) =>
  ({ type: "download", url, sha256: "a".repeat(64), size: 1, ...extra }) as const;

describe("tool mirror", () => {
  it("chooses env, then the setting, then tools.zed-zen.com", () => {
    expect(resolveMirrorBases(undefined, undefined)).toEqual([DEFAULT_TOOLS_MIRROR]);
    expect(resolveMirrorBases("", "default")).toEqual([DEFAULT_TOOLS_MIRROR]);
    expect(resolveMirrorBases("off", "https://m.example.org")).toEqual([]);
    expect(resolveMirrorBases("0", undefined)).toEqual([]);
    expect(resolveMirrorBases(undefined, "off")).toEqual([]);
    expect(resolveMirrorBases(undefined, "https://m.example.org/zen/")).toEqual([
      "https://m.example.org/zen",
    ]);
    expect(
      resolveMirrorBases("https://a.example.org, https://b.example.org/x/,ftp://bad", "off"),
    ).toEqual(["https://a.example.org", "https://b.example.org/x"]);
  });

  it("accepts only https bases (http only on localhost)", () => {
    expect(normalizeMirrorBase("http://m.example.org")).toBeNull();
    expect(normalizeMirrorBase("https://m.example.org/?x=1")).toBeNull();
    expect(normalizeMirrorBase("https://user:pw@m.example.org")).toBeNull();
    expect(normalizeMirrorBase("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080");
    expect(isValidMirrorSetting("default")).toBe(true);
    expect(isValidMirrorSetting("off")).toBe(true);
    expect(isValidMirrorSetting("tools")).toBe(false);
  });

  it("lays objects out as tool/version/platform/file and encodes the URL", () => {
    const target = {
      toolId: "open-fonts",
      version: "2026.11.08+86aced9",
      os: "linux",
      arch: "x64",
    };
    const license = step("https://raw.githubusercontent.com/google/fonts/x/ofl/barlow/OFL.txt", {
      archive: "none",
      dest: "fonts/licenses/barlow-OFL.txt",
    });
    expect(mirrorKey(target, license)).toBe(
      "open-fonts/2026.11.08+86aced9/linux-x64/barlow-OFL.txt",
    );
    expect(mirrorUrl(DEFAULT_TOOLS_MIRROR, target, license)).toBe(
      "https://tools.zed-zen.com/open-fonts/2026.11.08%2B86aced9/linux-x64/barlow-OFL.txt",
    );
    const zip = step(
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/t/ffmpeg-N-1-win64-gpl.zip",
      { archive: "zip" },
    );
    const sources = downloadSources(
      [DEFAULT_TOOLS_MIRROR],
      { toolId: "ffmpeg", version: "9.1-dev.1", os: "windows", arch: "x64" },
      zip,
    );
    expect(sources.map((source) => [source.host, source.mirror])).toEqual([
      ["tools.zed-zen.com", true],
      ["github.com", false],
    ]);
    expect(sources[0]!.url).toBe(
      "https://tools.zed-zen.com/ffmpeg/9.1-dev.1/windows-x64/ffmpeg-N-1-win64-gpl.zip",
    );
    expect(downloadSources([DEFAULT_TOOLS_MIRROR], null, zip)).toHaveLength(1);
  });

  it("gives every shipped download its own mirror key", () => {
    const dir = NodePath.join(import.meta.dirname, "catalog", "tools");
    const keys = new Map<string, string>();
    for (const name of NodeFS.readdirSync(dir)) {
      const parsed = parseCatalogEntry(NodeFS.readFileSync(NodePath.join(dir, name), "utf8"));
      if (!("entry" in parsed)) throw new Error(`${name}: ${parsed.error}`);
      for (const version of parsed.entry.versions) {
        for (const recipe of version.recipes) {
          for (const s of recipe.steps) {
            if (s.type !== "download") continue;
            const key = mirrorKey(
              {
                toolId: parsed.entry.id,
                version: version.version,
                os: recipe.os,
                arch: recipe.arch,
              },
              s,
            );
            const seen = keys.get(key);
            expect(seen === undefined || seen === s.sha256, key).toBe(true);
            keys.set(key, s.sha256);
          }
        }
      }
    }
    expect(keys.size).toBeGreaterThan(100);
  });
});
