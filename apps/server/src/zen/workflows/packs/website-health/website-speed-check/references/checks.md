# Speed checks ("Why is the website slow?")

Set `UA="Mozilla/5.0 (compatible; owner-website-check)"`, `SITE`, `HOST`. Public and keyless only.

## 1. Google's measurement (PageSpeed Insights, keyless)

`curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<SITE>&strategy=mobile&category=performance"` and again with `strategy=desktop`. It can take 30 to 60 seconds and may answer 429 when busy: wait 30 seconds and try once more, then fall back to section 2.

- Real visitors' data (`loadingExperience.metrics`, present only for busy sites): what real Chrome users experienced over 28 days. Prefer it over the lab numbers when present.
- Lab data (`lighthouseResult`): performance score, `largest-contentful-paint`, `cumulative-layout-shift`, `total-blocking-time`, `server-response-time`, and the failed audits (`score` < 0.9) with their `displayValue` and estimated savings. Lighthouse 13 names some audits as insights (`lcp-discovery-insight`, `render-blocking-insight`, `image-delivery-insight`, `document-latency-insight`).
  Thresholds (75th percentile of visits, mobile):
  | Measure | What people feel | Good | Poor | |---|---|---|---|
  | LCP, largest contentful paint | when the main content appears | 2.5 s or less | over 4 s |
  | INP, interaction to next paint | how fast a tap or click responds | 200 ms or less | over 500 ms |
  | CLS, cumulative layout shift | how much the page jumps while loading | 0.1 or less | over 0.25 |
  | TTFB, time to first byte | how long the server thinks before answering | 0.8 s or less | over 1.8 s |

## 2. Our own light measurements (always do these; they also work when PageSpeed refuses)

- Server answer time, 3 times: `curl -s -o /dev/null -A "$UA" -w "dns %{time_namelookup} connect %{time_connect} tls %{time_appconnect} first-byte %{time_starttransfer} total %{time_total} size %{size_download} http %{http_version}\n" "$SITE"`. Report the median. First byte over 0.8 s points to slow hosting, no page cache or a heavy platform.
- Compression: `curl -sI -A "$UA" -H "Accept-Encoding: br, gzip" "$SITE"` should show `content-encoding: br` or `gzip` for HTML, CSS and JS (missing is medium).
- HTTP version: 2 or 3 is good; 1.1 is low to medium.
- CDN (a network of servers near the visitor): headers such as `cf-cache-status`, `x-cache`, `server: cloudflare`, `x-served-by`. None and visitors far from the server: low to medium.
- Page weight: from the home page HTML, list images, scripts and stylesheets, with counts. Measure up to 25 of them (images and scripts first) with `curl -s -o /dev/null -A "$UA" -H "Accept-Encoding: br, gzip" -w "%{size_download} %{content_type}\n" <url>` (HEAD often has no size for compressed files). Report the measured total, the 5 heaviest files, and that unmeasured files are not counted. Over 3 MB on mobile is high; any single image over 300 KB is medium. Keep the whole run under about 80 requests to the site.
- Images: old formats (JPEG/PNG) where WebP/AVIF would be 30 to 70% smaller; images much larger than shown; no `loading="lazy"` on images below the first screen; the main (first) image lazy-loaded is bad (it delays LCP); images without `width`/`height` make the page jump.
- Caching: static files (images, CSS, JS, fonts) should have `cache-control: max-age` of at least a week (ideally a year with versioned names). `no-cache`/`max-age=0` on static files is medium.
- Render-blocking: `<script src>` in `<head>` without `defer` or `async`; many stylesheets in `<head>`.
- Fonts: number of font files and families; Google Fonts without `display=swap`.
- Third parties: count scripts from other domains (chat widgets, trackers, sliders, maps, video embeds). Over 10 is medium; name the heaviest ones.
- Platform hints: WordPress with many plugins (count distinct `/wp-content/plugins/<name>/`), page builders (Elementor, Divi, WPBakery) are heavy; a caching plugin's signature in the HTML is a good sign.

## 3. Mobile reality check

Most visitors are on phones over mobile data. Translate numbers into experience: "on a typical phone the main picture shows after about 5 seconds; many visitors leave before that".

## Code folder (only when given)

Heaviest images in the folder (`find . -type f \( -name "*.jpg" -o -name "*.png" \) -size +300k`), build settings (image optimisation, minification), large libraries loaded on every page, fonts bundled.

## Who fixes what

Hosting, server cache, compression, HTTP/2, CDN: the hosting company or web developer. Images: whoever uploads content (often the owner) with a free compressor, or the developer with automatic conversion. Plugins, scripts, fonts, caching rules: the web developer. Third-party widgets: the owner decides which are worth their cost in speed.

## Severity guide

Critical: pages over 10 s or timing out on mobile. High: LCP over 4 s, first byte over 1.8 s, pages over 3 MB. Medium: no compression, poor caching, oversized images, many third parties, CLS over 0.25. Low: the rest.
