// Zen Staff: the chat header's company-memory indicator. Shown only for a chat in a company project
// whose company memory is connected; a click toggles "Don't save this chat".
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { BrainIcon } from "lucide-react";
import { useContext } from "react";

import { Button } from "../../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZenText } from "../i18n/zenI18n";
import { memoryText } from "./memory.i18n";
import { memorySetThreadSkip, memoryThreadState } from "./memoryState";

export function ZenThreadMemoryToggle({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  const t = useZenText(memoryText);
  const registry = useContext(RegistryContext);
  const atom = memoryThreadState({ environmentId, input: { threadId } });
  const state = AsyncResult.getOrElse(useAtomValue(atom), () => null);
  const setSkip = useAtomCommand(memorySetThreadSkip, { reportFailure: false });
  if (state === null || state.companyId === null) return null;
  const saving = !state.skip;
  const toggle = async () => {
    const response = await setSkip({ environmentId, input: { threadId, skip: saving } });
    if (response._tag === "Success") {
      registry.refresh(atom);
      return;
    }
    toastManager.add({ type: "error", title: t.toggleFailed });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant={saving ? "ghost" : "ghost-muted"}
            aria-pressed={!saving}
            aria-label={saving ? t.dontSave : t.saveAgain}
            data-zen-thread-memory={saving ? "saving" : "skipped"}
            onClick={() => void toggle()}
            className="relative shrink-0"
          />
        }
      >
        <BrainIcon className={cn("size-4", !saving && "opacity-50")} aria-hidden />
        {saving ? null : (
          <span
            aria-hidden
            className="pointer-events-none absolute h-0.5 w-5 rotate-45 rounded bg-muted-foreground"
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-72">
        <span className="font-medium">{saving ? t.threadSaving : t.threadNotSaving}</span>
        <br />
        {saving ? t.threadSavingHint : t.threadNotSavingHint}
      </TooltipPopup>
    </Tooltip>
  );
}
