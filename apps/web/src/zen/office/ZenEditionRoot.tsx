// Zen Staff: mounted once in the chat layout. Follows the server's edition, marks <html> with
// data-zen-edition, adds the Office stylesheet, and opens the Office home instead of a blank
// draft. See ZEN.md, "Office edition".
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { startUpstreamTextRewriter, upstreamRewriteLocale } from "../i18n/upstreamText";
import { useZenLocale } from "../i18n/zenI18n";
import { OfficeRuntimeModeMigration } from "../trust/OfficeRuntimeModeMigration";
import { applyServerEdition } from "./editionStore";
import { NO_INPUT, officeSettings } from "./officeState";
import { useZenEdition } from "./useZenEdition";

/**
 * Developer surfaces hidden by selector instead of a React guard, because each one would cost an
 * upstream edit for a single button. Selectors use routes and aria-labels, which change rarely;
 * a missed one only means the control shows again. Listed in ZEN.md.
 */
const OFFICE_HIDE_CSS = `
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has([aria-label="Pull requests"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has([aria-label="Pull requesturi"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/source-control"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/worktrees"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/diffs"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/keybindings"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/snap-shot"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/devices"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/diagnostics"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/labs"]),
html[data-zen-edition="office"] [data-sidebar="menu-item"]:has(> [data-settings-section="/settings/beta"]),
html[data-zen-edition="office"] li:has(> [data-sidebar-row="settled:more"]),
html[data-zen-edition="office"] [aria-label="Toggle terminal drawer"],
html[data-zen-edition="office"] [aria-label="Usage metric"],
html[data-zen-edition="office"] [aria-label="Ce măsori"],
html[data-zen-edition="office"] [data-chat-provider-model-picker],
html[data-zen-edition="office"] [data-composer-shortcut="composer.mode"],
html[data-zen-edition="office"] [data-composer-shortcut="composer.host"],
html[data-zen-edition="office"] [data-composer-shortcut="composer.workspace"] {
  display: none !important;
}
`;

const STYLE_ID = "zen-office-edition-style";

function ServerEditionSync({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(officeSettings({ environmentId, input: NO_INPUT }));
  const edition = AsyncResult.isSuccess(result) ? result.value.edition : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the server's default edition into the localStorage-backed store that upstream guards read outside this subtree
  useEffect(() => {
    if (edition !== null) applyServerEdition(edition);
  }, [edition]);
  return null;
}

export function ZenEditionRoot() {
  const environmentId = usePrimaryEnvironmentId();
  const edition = useZenEdition();
  const locale = useZenLocale();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps <html data-zen-edition> and the Office stylesheet in step with the edition
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.zenEdition = edition;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = OFFICE_HIDE_CSS;
      document.head.append(style);
    }
  }, [edition]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps <html lang> on the app's language
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Upstream text: Office wording in Office, and Romanian in both editions when the app speaks it
  // (upstreamText.ts, upstreamRewriteLocale). Code in English keeps upstream's text untouched.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the DOM rewriter must follow the edition and language
  useEffect(() => {
    const rewriteTo = upstreamRewriteLocale(edition, locale);
    if (rewriteTo === null) return undefined;
    return startUpstreamTextRewriter(document.body, rewriteTo, edition);
  }, [edition, locale]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- router: the Office edition lands on /office instead of a blank draft
  useEffect(() => {
    if (edition === "office" && pathname === "/") void navigate({ to: "/office", replace: true });
  }, [edition, pathname, navigate]);

  return (
    <>
      {environmentId ? <ServerEditionSync environmentId={environmentId} /> : null}
      {edition === "office" ? <OfficeRuntimeModeMigration /> : null}
    </>
  );
}
