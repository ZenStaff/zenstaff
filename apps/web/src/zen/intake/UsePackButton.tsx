// Zen Staff chat-first task start: "Folosește" on a Magazin card (built-ins and installed packs).
// It hands the workflow to the Office home, which opens its chat in the chosen folder; a pack of
// several workflows asks which one first.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  localizeWorkflowManifest,
  type ZenRegistryEntry,
  type ZenWorkflow,
} from "@t3tools/contracts/zenOffice";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { MessageCircleIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeWorkflows } from "../office/officeState";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { WorkflowIcon } from "../office/workflowIcons";
import { intakeText } from "./intake.i18n";
import { openWorkflowChat } from "./openWorkflowChat";

/** The workflows of a marketplace entry that are on this machine, in the entry's order. */
export function entryWorkflows(
  entry: Pick<ZenRegistryEntry, "id" | "workflows">,
  workflows: ReadonlyArray<ZenWorkflow>,
): ReadonlyArray<ZenWorkflow> {
  const ids = entry.workflows && entry.workflows.length > 0 ? entry.workflows : [entry.id];
  return ids.flatMap((id) => workflows.filter((workflow) => workflow.manifest.id === id));
}

export function UsePackButton(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: ZenRegistryEntry;
}) {
  const t = useZenText(intakeText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const { workflowsInput } = useOfficeCompany();
  const result = useAtomValue(
    officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
  );
  const available = AsyncResult.isSuccess(result)
    ? entryWorkflows(props.entry, result.value.workflows)
    : [];
  if (available.length === 0) return null;
  const use = (workflow: ZenWorkflow) => {
    void openWorkflowChat(navigate, workflow.manifest.id);
  };
  if (available.length === 1) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => use(available[0]!)}
        data-zen-use={props.entry.id}
      >
        <MessageCircleIcon />
        {t.use}
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="outline" data-zen-use={props.entry.id} />}>
        <MessageCircleIcon />
        {t.use}
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        <p className="px-2 py-1.5 text-muted-foreground text-xs">{t.chooseWorkflow}</p>
        {available.map((workflow) => {
          const manifest = localizeWorkflowManifest(workflow.manifest, locale);
          return (
            <MenuItem key={manifest.id} onClick={() => use(workflow)}>
              <WorkflowIcon name={manifest.icon} className="size-4" />
              {manifest.name}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}
