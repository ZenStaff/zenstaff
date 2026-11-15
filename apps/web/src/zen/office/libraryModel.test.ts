import type { ZenMarketplaceEntry, ZenRegistryEntry } from "@t3tools/contracts/zenOffice";
import { describe, expect, it } from "vite-plus/test";

import {
  creditParts,
  libraryOrder,
  matchesOrigin,
  nextVersion,
  originOf,
  packIdFromTitle,
  publishedVersion,
  screenshotProblem,
  statusTone,
  type LibraryPackView,
} from "./libraryModel";

const entry = (
  id: string,
  community?: Partial<NonNullable<ZenRegistryEntry["community"]>>,
): ZenRegistryEntry => ({
  id,
  name: id,
  description: "",
  category: "social",
  icon: "sparkles",
  version: "1.0.0",
  author: "ZED-ZEN",
  kind: "pack",
  ...(community
    ? {
        community: {
          slug: id,
          origin: "community",
          verified: true,
          featured: false,
          installs: 0,
          ...community,
        },
      }
    : {}),
});
const item = (value: ZenRegistryEntry): ZenMarketplaceEntry => ({
  entry: value,
  installed: false,
  installedVersion: null,
});

describe("library model", () => {
  it("tells Zen Staff packs from community ones and filters by origin", () => {
    expect(originOf(entry("a"))).toBe("zen");
    expect(originOf(entry("b", {}))).toBe("community");
    expect(matchesOrigin(item(entry("a")), "community")).toBe(false);
    expect(matchesOrigin(item(entry("b", {})), "community")).toBe(true);
    expect(matchesOrigin(item(entry("a")), "all")).toBe(true);
  });

  it("credits the author with company and installs", () => {
    expect(creditParts(entry("a"))).toBeNull();
    expect(
      creditParts(
        entry("b", {
          installs: 120,
          author: { slug: "ana-pop", name: "Ana Pop", company: "Bistro Ana" },
        }),
      ),
    ).toEqual({ author: "Ana Pop", company: "Bistro Ana", installs: 120 });
  });

  it("keeps Zen Staff first, then featured and most installed community packs; a shared pack goes first", () => {
    const items = [
      item(entry("zen-1")),
      item(entry("few", { installs: 3 })),
      item(entry("many", { installs: 300 })),
      item(entry("zen-2")),
      item(entry("star", { installs: 1, featured: true })),
    ];
    expect(libraryOrder(items, null).map((value) => value.entry.id)).toEqual([
      "zen-1",
      "zen-2",
      "star",
      "many",
      "few",
    ]);
    expect(libraryOrder(items, "few").map((value) => value.entry.id)).toEqual([
      "few",
      "zen-1",
      "zen-2",
      "star",
      "many",
    ]);
    expect(libraryOrder(items, "unknown").map((value) => value.entry.id)[0]).toBe("zen-1");
  });

  it("maps statuses to tones and offers the next version", () => {
    expect(statusTone("pending")).toBe("waiting");
    expect(statusTone("changes_requested")).toBe("action");
    expect(statusTone("published")).toBe("done");
    expect(statusTone("rejected")).toBe("refused");
    expect(nextVersion(null)).toBe("1.0.0");
    expect(nextVersion("1.2.3")).toBe("1.3.0");
    const pack: LibraryPackView = {
      slug: "x",
      packId: "x",
      state: "published",
      installs: 4,
      featured: false,
      unpublishedReason: null,
      shareUrl: null,
      versions: [
        {
          id: "2",
          version: "1.1.0",
          title: "X",
          status: "pending",
          reviewNote: null,
          submittedAt: "",
          decidedAt: null,
        },
        {
          id: "1",
          version: "1.0.0",
          title: "X",
          status: "published",
          reviewNote: null,
          submittedAt: "",
          decidedAt: "",
        },
      ],
    };
    expect(publishedVersion(pack)).toBe("1.0.0");
  });

  it("accepts only small PNG, JPEG or WebP images, at most four", () => {
    expect(screenshotProblem({ type: "image/png", size: 1000 }, 0)).toBeNull();
    expect(screenshotProblem({ type: "image/gif", size: 1000 }, 0)).toBe("type");
    expect(screenshotProblem({ type: "image/webp", size: 700 * 1024 }, 0)).toBe("size");
    expect(screenshotProblem({ type: "image/jpeg", size: 10 }, 4)).toBe("count");
  });

  it("makes pack ids from titles with Romanian letters", () => {
    expect(packIdFromTitle("Oferta zilei pe Facebook")).toBe("oferta-zilei-pe-facebook");
    expect(packIdFromTitle("Inventarul săptămânii (bucătărie)")).toBe(
      "inventarul-saptamanii-bucatarie",
    );
  });
});
