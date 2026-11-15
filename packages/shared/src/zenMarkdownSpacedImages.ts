// Zen Staff: `![poster](/home/ana/Zen Staff/Firma/afis final.png)` shows the image. CommonMark ends a
// destination at the first space, so agents' local paths with spaces rendered as raw text.
import type { Image, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";

// `![alt](destination "title")`, destination with a space, no newline, balanced single parens.
const SPACED_IMAGE =
  /!\[([^\]\n]*)\]\(\s*((?:[^()\s"<>]|\([^()\n]*\))(?:[^()\n"<>]|\([^()\n]*\))*?)(?:\s+"([^"\n]*)")?\s*\)/g;
const MEDIA_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico|heic|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|oga|opus|flac)$/i;
// A URL scheme (`https:`), but not a drive letter (`C:`).
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:/;

/** The destination as a local media path with a space in it, or null. */
function spacedMediaPath(destination: string): string | null {
  const path = destination.trim();
  if (!/\s/.test(path) || URL_SCHEME.test(path)) return null;
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? path;
  return MEDIA_EXTENSION.test(withoutQuery) ? path : null;
}

/** The text node split into text and image nodes, or null when it holds no spaced image. */
export function splitSpacedImages(value: string): PhrasingContent[] | null {
  const parts: PhrasingContent[] = [];
  let last = 0;
  for (const match of value.matchAll(SPACED_IMAGE)) {
    const url = spacedMediaPath(match[2] ?? "");
    if (url === null) continue;
    const start = match.index;
    if (start > last) parts.push({ type: "text", value: value.slice(last, start) } satisfies Text);
    parts.push({
      type: "image",
      url,
      alt: match[1] ?? "",
      title: match[3] ?? null,
    } satisfies Image);
    last = start + match[0].length;
  }
  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

/** Turns spaced local image paths left as text into image nodes (never inside code). */
export function remarkZenSpacedImages() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (!("children" in node)) return;
      const parent = node as Parent;
      const children: RootContent[] = [];
      let changed = false;
      for (const child of parent.children) {
        const split = child.type === "text" ? splitSpacedImages(child.value) : null;
        if (split) {
          children.push(...split);
          changed = true;
        } else {
          visit(child);
          children.push(child);
        }
      }
      if (changed) parent.children = children;
    };
    visit(tree);
  };
}
