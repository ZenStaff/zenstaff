// Zen Staff: the screen shown when a page crashes (the router's error view). Plain words in the
// app's language, "Încearcă din nou" first, the stack trace folded under "Detalii tehnice", and the
// report sent by e-mail instead of an issue on a private repository. Hooked into routes/__root.tsx.
import { ChevronRightIcon, CopyIcon, MailIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { StandalonePage, StandalonePageHeader } from "../../components/ui/standalone-page";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useZenText } from "../i18n/zenI18n";
import { errorsText } from "./errors.i18n";
import { supportMailto } from "./supportReport";

export function ZenErrorScreen(props: { readonly report: string; readonly onRetry: () => void }) {
  const t = useZenText(errorsText);
  const [open, setOpen] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "error-report" });
  return (
    <StandalonePage>
      <div data-zen-no-translate>
        <StandalonePageHeader title={t.title} description={t.body} />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={props.onRetry}>
            <RotateCcwIcon aria-hidden />
            {t.tryAgain}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            {t.reload}
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={
              <a
                href={supportMailto(t.mailSubject, t.mailIntro, props.report)}
                onClick={() => copyToClipboard(props.report)}
              />
            }
          >
            <MailIcon aria-hidden />
            {t.report}
          </Button>
        </div>
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          >
            <ChevronRightIcon
              aria-hidden
              className={open ? "size-3 rotate-90 transition-transform" : "size-3"}
            />
            {t.details}
          </button>
          {open ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-background/55">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <p className="text-muted-foreground text-xs">{t.detailsNote}</p>
                <Button size="xs" variant="ghost" onClick={() => copyToClipboard(props.report)}>
                  <CopyIcon aria-hidden />
                  {isCopied ? t.copied : t.copy}
                </Button>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border/70 bg-background/80 px-3 py-2 text-foreground/85 text-xs">
                {props.report}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </StandalonePage>
  );
}
