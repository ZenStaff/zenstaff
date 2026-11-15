// Page helpers shared by explore and capture: cookie banners, blockers, targets, the cursor.

const COOKIE_ACCEPT =
  /^(accept|accept all|accept all cookies|allow all|agree|i agree|ok|got it|accept[aă] tot|accept[aă] toate|accept[aă]|sunt de acord|de acord|am în?țeles|permite toate|alle akzeptieren|akzeptieren)$/i;
const COOKIE_REJECT =
  /^(reject|reject all|decline|refuz|refuză|resping|respinge toate|doar necesare|only necessary|necessary only|ablehnen)$/i;

/** Clicks a cookie banner button if one is showing. mode: accept | reject | leave. */
export async function handleCookies(page, mode = "accept") {
  if (mode === "leave") return null;
  const pattern = mode === "reject" ? COOKIE_REJECT : COOKIE_ACCEPT;
  for (const frame of page.frames()) {
    const buttons = frame.getByRole("button");
    const count = Math.min(await buttons.count().catch(() => 0), 60);
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const name = ((await button.innerText().catch(() => "")) || "").trim();
      if (pattern.test(name) && (await button.isVisible().catch(() => false))) {
        await button.click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        return name;
      }
    }
  }
  return null;
}

const BLOCKERS = [
  [
    /just a moment|checking your browser|verify you are human|cf-chl|attention required/i,
    "a Cloudflare or bot check page",
  ],
  [
    /error 1015|you are being rate limited|too many requests/i,
    "a rate-limit page (too many visits)",
  ],
  [/captcha/i, "a CAPTCHA"],
  [/access denied|403 forbidden/i, "an access-denied page"],
  [/404|page not found|pagina nu a fost găsită|pagina nu există/i, "a page-not-found error"],
];

/** Plain reasons why the page is not what a tutorial should show. */
export async function pageProblems(page, { status, allowLogin = false } = {}) {
  const problems = [];
  const title = await page.title().catch(() => "");
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const head = `${title}\n${text.slice(0, 1500)}`;
  for (const [pattern, label] of BLOCKERS) {
    if (pattern === BLOCKERS[4][0] && text.length > 1500) continue;
    if (pattern.test(head)) problems.push(`The page shows ${label}.`);
  }
  if (status && status >= 400) problems.push(`The page answered with HTTP ${status}.`);
  if (text.trim().length < 30) problems.push("The page looks empty (almost no text).");
  if (!allowLogin) {
    const passwords = await page
      .locator('input[type="password"]:visible')
      .count()
      .catch(() => 0);
    if (passwords > 0) problems.push("A login form is showing (a password field is visible).");
  }
  return problems;
}

/** A locator from a storyboard target. */
export function locate(page, target) {
  if (typeof target === "string") return page.getByText(target, { exact: false });
  let locator;
  if (target.role)
    locator = page.getByRole(target.role, { name: target.name, exact: target.exact ?? false });
  else if (target.label) locator = page.getByLabel(target.label, { exact: target.exact ?? false });
  else if (target.placeholder)
    locator = page.getByPlaceholder(target.placeholder, { exact: target.exact ?? false });
  else if (target.text) locator = page.getByText(target.text, { exact: target.exact ?? false });
  else if (target.selector) locator = page.locator(target.selector);
  else throw new Error("A target needs role+name, label, placeholder, text or selector.");
  return target.nth !== undefined ? locator.nth(target.nth) : locator;
}

/** Resolves a target to exactly one visible element, or explains why not. */
export async function resolveTarget(page, target) {
  const locator = locate(page, target);
  const count = await locator.count().catch(() => 0);
  if (count === 0) return { error: `Nothing on the page matches ${JSON.stringify(target)}.` };
  const visible = [];
  for (let i = 0; i < Math.min(count, 20); i++) {
    if (
      await locator
        .nth(i)
        .isVisible()
        .catch(() => false)
    )
      visible.push(i);
  }
  if (visible.length === 0)
    return {
      error: `${JSON.stringify(target)} exists but is hidden (maybe inside a closed menu).`,
    };
  if (visible.length > 1 && target.nth === undefined) {
    // Prefer the first visible one, but say so: the storyboard can pin it with "nth".
    return {
      locator: locator.nth(visible[0]),
      note: `${visible.length} visible matches; used the first (add "nth" to pick another).`,
    };
  }
  return { locator: target.nth === undefined ? locator.nth(visible[0]) : locator };
}

/** Injected into every page: a cursor, a click ripple and a highlight box, all above the page. */
export const CURSOR_SCRIPT = `
(() => {
  if (window.__zenCursor) return;
  const install = () => {
    if (!document.body || document.getElementById('__zen_cursor')) return;
    const c = document.createElement('div');
    c.id = '__zen_cursor';
    c.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    const pos = window.__zenCursorPos || { x: innerWidth * 0.5, y: innerHeight * 0.6 };
    Object.assign(c.style, { position: 'fixed', left: pos.x + 'px', top: pos.y + 'px', zIndex: 2147483647, pointerEvents: 'none', transition: 'left .7s cubic-bezier(.22,1,.36,1), top .7s cubic-bezier(.22,1,.36,1)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' });
    document.body.appendChild(c);
  };
  window.__zenCursor = {
    moveTo(x, y) { install(); const c = document.getElementById('__zen_cursor'); window.__zenCursorPos = { x, y }; c.style.left = x + 'px'; c.style.top = y + 'px'; },
    ripple(x, y, color) {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: (x - 22) + 'px', top: (y - 22) + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '4px solid ' + color, zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .5s ease-out, opacity .5s ease-out', opacity: '1' });
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 700);
    },
    highlight(box, color) {
      this.clear();
      const h = document.createElement('div');
      h.id = '__zen_highlight';
      Object.assign(h.style, { position: 'fixed', left: (box.x - 8) + 'px', top: (box.y - 8) + 'px', width: (box.width + 16) + 'px', height: (box.height + 16) + 'px', border: '4px solid ' + color, borderRadius: '12px', boxShadow: '0 0 0 9999px rgba(0,0,0,.28)', zIndex: 2147483645, pointerEvents: 'none', opacity: '0', transition: 'opacity .35s' });
      document.body.appendChild(h);
      requestAnimationFrame(() => { h.style.opacity = '1'; });
    },
    clear() { document.getElementById('__zen_highlight')?.remove(); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
`;
