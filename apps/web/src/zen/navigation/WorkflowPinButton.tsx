// Zen Staff: the small pin on a workflow card (Office home, Magazin) that adds the workflow to the
// sidebar's "My workflows" or takes it off. A pack card pins all of its workflows on this machine.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenRegistryEntry } from "@t3tools/contracts/zenOffice";
import { AsyncResult } from "effect/reactivity";
import { PinIcon, PinOffIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { useZenText } from "../i18n/zenI18n";
import { entryWorkflows } from "../intake/UsePackButton";
import { officeWorkflows } from "../office/officeState";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { myWorkflowsText } from "./myWorkflows.i18n";
import { useMyWorkflowsStore } from "./myWorkflowsState";

export function WorkflowPinButton(props: {
  readonly workflowIds: ReadonlyArray<string>;
  readonly name: string;
  readonly className?: string;
}) {
  const t = useZenText(myWorkflowsText);
  const pins = useMyWorkflowsStore((state) => state.pins);
  const setPinned = useMyWorkflowsStore((state) => state.setPinned);
  if (props.workflowIds.length === 0) return null;
  const pinned = props.workflowIds.every((id) => pins.includes(id));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPinned(props.workflowIds, !pinned);
            }}
            aria-label={pinned ? t.unpinNamed(props.name) : t.pinNamed(props.name)}
            aria-pressed={pinned}
            data-zen-workflow-pin={props.workflowIds.join(" ")}
            data-pinned={pinned || undefined}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              pinned && "text-primary",
              props.className,
            )}
          />
        }
      >
        {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
      </TooltipTrigger>
      <TooltipPopup side="top">{pinned ? t.unpin : t.pin}</TooltipPopup>
    </Tooltip>
  );
}

/** The pin on a Magazin card: the entry's workflows that are on this machine. */
export function PackPinButton(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: ZenRegistryEntry;
}) {
  const { workflowsInput } = useOfficeCompany();
  const result = useAtomValue(
    officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
  );
  const ids = AsyncResult.isSuccess(result)
    ? entryWorkflows(props.entry, result.value.workflows).map((workflow) => workflow.manifest.id)
    : [];
  return <WorkflowPinButton workflowIds={ids} name={props.entry.name} />;
}
