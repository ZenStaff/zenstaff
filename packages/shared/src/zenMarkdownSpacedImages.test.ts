import { describe, expect, it } from "vite-plus/test";

import { chatMarkdownImageSources } from "./markdownPipeline.ts";
import { splitSpacedImages } from "./zenMarkdownSpacedImages.ts";

describe("spaced local image paths", () => {
  it("shows an image whose local path has raw spaces", () => {
    expect(chatMarkdownImageSources("![poster](/home/ana/Zen Staff/Firma/afis final.png)")).toEqual([
      "/home/ana/Zen%20Staff/Firma/afis%20final.png",
    ]);
    expect(
      chatMarkdownImageSources('Iată afișul: ![poster](~/Zen Staff/afis final.jpg "Afiș") gata.'),
    ).toEqual(["~/Zen%20Staff/afis%20final.jpg"]);
    expect(chatMarkdownImageSources("![a](Firma/poze (1)/afis final.webp)")).toEqual([
      "Firma/poze%20(1)/afis%20final.webp",
    ]);
  });

  it("keeps angle-bracket and encoded destinations as images", () => {
    expect(chatMarkdownImageSources("![poster](</home/ana/Zen Staff/Firma/afis final.png>)")).toEqual([
      "/home/ana/Zen%20Staff/Firma/afis%20final.png",
    ]);
    expect(chatMarkdownImageSources("![poster](/home/ana/Zen%20Staff/afis%20final.png)")).toEqual([
      "/home/ana/Zen%20Staff/afis%20final.png",
    ]);
  });

  it("leaves code, URLs and non-media paths alone", () => {
    expect(chatMarkdownImageSources("`![poster](/home/ana/Zen Staff/afis final.png)`")).toEqual([]);
    expect(chatMarkdownImageSources("```\n![poster](/home/ana/Zen Staff/afis final.png)\n```")).toEqual(
      [],
    );
    expect(splitSpacedImages("![x](https://example.com/a b.png)")).toBeNull();
    expect(splitSpacedImages("![x](/home/ana/Zen Staff/notes final.md)")).toBeNull();
    expect(splitSpacedImages("no image here")).toBeNull();
  });

  it("splits text around the image and keeps the title", () => {
    expect(splitSpacedImages('A ![p](/a b.png "T") B')).toEqual([
      { type: "text", value: "A " },
      { type: "image", url: "/a b.png", alt: "p", title: "T" },
      { type: "text", value: " B" },
    ]);
  });
});
