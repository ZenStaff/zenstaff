// Markdown article (with frontmatter) -> full HTML page, paste-in body, schema.json (Article, FAQPage,
// BreadcrumbList) and checks.json. Exits with code 2 while an ERROR check fails.
//   node article.mjs --in article.md --out <folder> [--site https://example.ro] [--lang en]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const fold = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value))
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    else value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(m[0].length) };
}

function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label, href) =>
        `<a href="${href.replace(/&amp;/g, "&").replace(/"/g, "%22")}">${label}</a>`,
    );
}

/** The markdown a blog article needs: headings, paragraphs, lists, quotes, tables, links. */
export function markdownToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = fold(text)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (l) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|\s*[-*]\s+|\s*\d+[.)]\s+|\s*>|\s*\|)/.test(lines[i])
    )
      para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

const FAQ_TITLES = [
  "intrebari frecvente",
  "faq",
  "frequently asked questions",
  "questions and answers",
  "intrebari si raspunsuri",
];

/** Questions and answers from the FAQ section (## heading, ### questions). */
export function faqOf(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const start = lines.findIndex(
    (l) =>
      /^##\s+/.test(l) &&
      FAQ_TITLES.includes(
        fold(l.replace(/^##\s+/, ""))
          .trim()
          .replace(/[?:.]$/, ""),
      ),
  );
  if (start < 0) return [];
  const faq = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const q = /^###\s+(.*)$/.exec(line);
    if (q) {
      current = { q: q[1].trim(), a: [] };
      faq.push(current);
    } else if (current && line.trim()) current.a.push(line.trim().replace(/^[-*]\s+/, ""));
  }
  return faq
    .map((f) => ({
      q: f.q,
      a: f.a
        .join(" ")
        .replace(/\*\*|\*|`/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    }))
    .filter((f) => f.a);
}

export function checkArticle(meta, body, site, lang) {
  const ro = lang !== "en";
  const words = body
    .replace(/[#>*`|\-[\]()]/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length;
  const links = [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => m[2]);
  const host = site ? new URL(site).host.replace(/^www\./, "") : null;
  const internal = links.filter((h) => h.startsWith("/") || (host && h.includes(host)));
  const external = links.filter((h) => /^https?:/.test(h) && !(host && h.includes(host)));
  const faq = faqOf(body);
  const keyword = fold(meta.keyword ?? "");
  const firstPara =
    fold(meta.answer ?? "") +
    " " +
    fold(body.split(/\n\s*\n/).find((p) => p.trim() && !/^#/.test(p.trim())) ?? "");
  const h2 = (body.match(/^##\s+/gm) ?? []).length;
  const checks = [];
  const add = (ok, en, roText, level = "error") =>
    checks.push({ ok, level: ok ? "ok" : level, message: ro ? roText : en });
  add(Boolean(meta.title), "title is set", "titlul există");
  add(
    (meta.seo_title ?? meta.title ?? "").length <= 60,
    `SEO title is ${String(meta.seo_title ?? meta.title ?? "").length} characters (at most 60)`,
    `titlul SEO are ${String(meta.seo_title ?? meta.title ?? "").length} caractere (cel mult 60)`,
  );
  const dl = String(meta.description ?? "").length;
  add(
    dl >= 120 && dl <= 160,
    `meta description is ${dl} characters (120-160)`,
    `descrierea meta are ${dl} caractere (120-160)`,
  );
  add(
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.slug ?? ""),
    `slug "${meta.slug ?? ""}" uses a-z, 0-9 and dashes`,
    `slug-ul „${meta.slug ?? ""}” folosește doar a-z, 0-9 și cratimă`,
  );
  add(
    Boolean(keyword) && fold(meta.title).includes(keyword),
    "the main keyword is in the title",
    "cuvântul cheie principal e în titlu",
    "warning",
  );
  add(
    Boolean(keyword) && fold(meta.description).includes(keyword),
    "the main keyword is in the meta description",
    "cuvântul cheie e în descrierea meta",
    "warning",
  );
  add(
    Boolean(keyword) && firstPara.includes(keyword.split(" ")[0]),
    "the first paragraph answers the search (keyword near the top)",
    "primul paragraf răspunde la căutare (cuvântul cheie sus)",
    "warning",
  );
  add(
    !/^#\s/m.test(body),
    "no H1 in the body (the title is the H1)",
    "fără H1 în corp (titlul e H1)",
  );
  add(h2 >= 4, `${h2} sections (H2), at least 4`, `${h2} secțiuni (H2), cel puțin 4`);
  const minWords = Number(meta.min_words ?? 900);
  add(
    words >= minWords,
    `${words} words (at least ${minWords})`,
    `${words} de cuvinte (cel puțin ${minWords})`,
  );
  add(
    faq.length >= 3 && faq.length <= 8,
    `${faq.length} FAQ questions (3-8)`,
    `${faq.length} întrebări în secțiunea FAQ (3-8)`,
  );
  add(
    internal.length >= 3,
    `${internal.length} internal links (at least 3)`,
    `${internal.length} linkuri interne (cel puțin 3)`,
    site ? "error" : "warning",
  );
  add(new Set(links).size === links.length, "no link repeated", "niciun link repetat", "warning");
  const placeholders = (body.match(/\[(?:LINK:|LINK |TODO)[^\]]*\]/g) ?? []).length;
  add(
    placeholders === 0,
    `${placeholders} placeholders left ([LINK ...] / [TODO])`,
    `${placeholders} locuri goale rămase ([LINK ...] / [TODO])`,
  );
  return {
    words,
    links: { internal, external },
    faq,
    checks,
    passed: checks.every((c) => c.ok || c.level !== "error"),
  };
}

const CSS = `:root{--ink:#1d2421;--muted:#5d6763;--line:#dfe5e2;--accent:#1f5c4a;--bg:#fbfcfb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.7 Georgia,'Source Serif 4',serif}
main{max-width:720px;margin:0 auto;padding:56px 20px 80px}
.crumbs{font:14px/1.4 system-ui,sans-serif;color:var(--muted);margin-bottom:28px}.crumbs a{color:var(--muted)}
h1{font:700 40px/1.15 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:-.01em;margin:0 0 16px}
.lede{font-size:20px;color:var(--muted);margin:0 0 12px}.meta{font:14px system-ui,sans-serif;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:32px}
h2{font:700 27px/1.25 system-ui,-apple-system,'Segoe UI',sans-serif;margin:48px 0 12px}h3{font:600 20px/1.35 system-ui,sans-serif;margin:28px 0 8px}
a{color:var(--accent);text-underline-offset:3px}ul,ol{padding-left:1.3em}li{margin:6px 0}
blockquote{margin:24px 0;padding:4px 20px;border-left:3px solid var(--accent);color:var(--muted)}
table{width:100%;border-collapse:collapse;font:16px/1.5 system-ui,sans-serif;margin:20px 0}th,td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
.answer{background:#eef4f1;border-radius:10px;padding:18px 20px;margin:0 0 28px;font:17px/1.6 system-ui,sans-serif}
@media (max-width:600px){body{font-size:17px}h1{font-size:31px}h2{font-size:23px}}`;

function main() {
  const lang = opt("lang", "ro") === "en" ? "en" : "ro";
  const input = opt("in");
  const outDir = opt("out");
  const site = opt("site");
  if (!input || !outDir)
    fail("Use --in article.md --out <folder> [--site https://example.ro] [--lang ro|en].");
  let text;
  try {
    text = NodeFS.readFileSync(input, "utf8");
  } catch (error) {
    fail(`${input} could not be read: ${error.message}`);
  }
  if (site && !/^https?:\/\/[^/]+/.test(site)) fail("--site must look like https://example.ro");
  const { meta, body } = parseFrontmatter(text);
  const report = checkArticle(meta, body, site, lang);
  const slug = meta.slug || "article";
  const base = site ? site.replace(/\/$/, "") : null;
  const url = base ? `${base}${meta.path ?? `/blog/${slug}/`}` : null;
  const bodyHtml = markdownToHtml(body);
  const today = new Date().toISOString().slice(0, 10);
  const graph = [
    {
      "@type": meta.type === "HowTo" ? "Article" : "BlogPosting",
      headline: meta.title,
      description: meta.description,
      inLanguage: meta.language ?? lang,
      datePublished: meta.published ?? today,
      dateModified: meta.updated ?? meta.published ?? today,
      ...(meta.author
        ? {
            author: {
              "@type": meta.author_type === "Organization" ? "Organization" : "Person",
              name: meta.author,
            },
          }
        : {}),
      ...(meta.publisher
        ? {
            publisher: {
              "@type": "Organization",
              name: meta.publisher,
              ...(base ? { url: base } : {}),
            },
          }
        : {}),
      ...(url ? { mainEntityOfPage: url, url } : {}),
      ...(meta.image ? { image: meta.image } : {}),
      ...(Array.isArray(meta.keywords) ? { keywords: meta.keywords.join(", ") } : {}),
    },
  ];
  if (report.faq.length)
    graph.push({
      "@type": "FAQPage",
      mainEntity: report.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  if (base) {
    const items = [{ name: lang === "ro" ? "Acasă" : "Home", item: `${base}/` }];
    if (meta.hub_url && meta.hub_name)
      items.push({
        name: meta.hub_name,
        item: meta.hub_url.startsWith("http") ? meta.hub_url : `${base}${meta.hub_url}`,
      });
    items.push({ name: meta.title, item: url });
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        item: it.item,
      })),
    });
  }
  const schema = { "@context": "https://schema.org", "@graph": graph };
  const schemaTag = `<script type="application/ld+json">\n${JSON.stringify(schema, null, 1).replace(/</g, "\\u003c")}\n</script>`;
  const crumbs = base
    ? `<nav class="crumbs" aria-label="breadcrumb"><a href="${esc(base)}/">${lang === "ro" ? "Acasă" : "Home"}</a>${meta.hub_name ? ` › <a href="${esc(meta.hub_url)}">${esc(meta.hub_name)}</a>` : ""} › ${esc(meta.title)}</nav>`
    : "";
  const dateText = new Date(
    `${meta.updated ?? meta.published ?? today}T12:00:00Z`,
  ).toLocaleDateString(lang === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const page = `<!doctype html>
<html lang="${esc(meta.language ?? lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.seo_title ?? meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
${url ? `<link rel="canonical" href="${esc(url)}">\n<meta property="og:url" content="${esc(url)}">\n` : ""}<meta property="og:type" content="article">
<meta property="og:title" content="${esc(meta.seo_title ?? meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
${meta.image ? `<meta property="og:image" content="${esc(meta.image)}">\n` : ""}<style>${CSS}</style>
${schemaTag}
</head>
<body>
<main>
${crumbs}
<article>
<h1>${inline(meta.title ?? "")}</h1>
<p class="meta">${lang === "ro" ? "Actualizat la" : "Updated"} ${esc(dateText)}${meta.author ? ` · ${esc(meta.author)}` : ""}</p>
${meta.answer ? `<p class="answer">${inline(meta.answer)}</p>\n` : ""}${bodyHtml}
</article>
</main>
</body>
</html>
`;
  NodeFS.mkdirSync(outDir, { recursive: true });
  const fragment = `${meta.answer ? `<p class="answer">${inline(meta.answer)}</p>\n` : ""}${bodyHtml}\n${schemaTag}\n`;
  NodeFS.writeFileSync(NodePath.join(outDir, `${slug}.html`), page);
  NodeFS.writeFileSync(NodePath.join(outDir, `${slug}-body.html`), fragment);
  NodeFS.writeFileSync(NodePath.join(outDir, "schema.json"), JSON.stringify(schema, null, 1));
  const result = {
    page: NodePath.resolve(outDir, `${slug}.html`),
    body: NodePath.resolve(outDir, `${slug}-body.html`),
    schema: NodePath.resolve(outDir, "schema.json"),
    words: report.words,
    internalLinks: report.links.internal,
    externalLinks: report.links.external,
    faqQuestions: report.faq.map((f) => f.q),
    passed: report.passed,
    checks: report.checks
      .filter((c) => !c.ok)
      .map(
        (c) =>
          `${c.level.toUpperCase()} (${lang === "ro" ? "neîndeplinit, de reparat" : "not met, fix it"}): ${c.message}`,
      ),
    ok: report.checks.filter((c) => c.ok).map((c) => c.message),
  };
  NodeFS.writeFileSync(NodePath.join(outDir, "checks.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  if (!report.passed) process.exit(2);
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("article.mjs")) main();
