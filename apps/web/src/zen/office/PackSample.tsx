// Zen Staff: a pack's showcase sample (a short video or audio we made with a professional voice),
// on the marketplace card and the workflow form. Packs without a sample, or whose sample file is
// not there yet, show nothing.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeChatText } from "./officeChat.i18n";
import { officeSampleMedia } from "./officeState";

export function ZenPackSample(props: {
  readonly environmentId: EnvironmentId;
  readonly id: string;
}) {
  const t = useZenText(officeChatText);
  const locale = useZenLocale();
  const result = useAtomValue(
    officeSampleMedia({ environmentId: props.environmentId, input: { id: props.id } }),
  );
  if (!AsyncResult.isSuccess(result) || result.value === null) return null;
  const sample = result.value;
  const caption = sample.i18n?.[locale]?.caption ?? sample.caption;
  return (
    <figure className="flex flex-col gap-1.5" data-zen-pack-sample={props.id}>
      {sample.kind === "video" ? (
        <video
          src={sample.url}
          controls
          preload="metadata"
          className="w-full rounded-lg border bg-black"
          aria-label={t.sampleLabel}
        />
      ) : (
        <audio
          src={sample.url}
          controls
          preload="metadata"
          className="w-full"
          aria-label={t.sampleLabel}
        />
      )}
      <figcaption className="text-muted-foreground text-xs">
        <span className="font-medium text-foreground">{t.sampleLabel}</span>
        {caption ? <span>. {caption}</span> : null}
      </figcaption>
    </figure>
  );
}
