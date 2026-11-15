// Chat-first task start, in both editions: the toolchain check runs first, then the server writes
// the first message (`workflow.start`) and the thread opens. No form: the agent asks in the chat
// (files are dropped there), with defaults from the company profile, memory and `known` answers.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { localizeWorkflowManifest, type ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { LoaderIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { companyOfProject } from "../companies/companiesModel";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { WorkflowIcon } from "../office/workflowIcons";
import { useZenToolchainGate } from "../toolchains/WorkflowPreparation";
import { intakeText } from "./intake.i18n";
import { useIntakeCall } from "./intakeClient";

export function IntakeStarter(props: {
  readonly workflow: ZenWorkflow;
  readonly project: EnvironmentProject;
  readonly onClose: () => void;
  /** Answers already given elsewhere (the onboarding hand-over), offered to the agent as known. */
  readonly known?: Readonly<Record<string, string>>;
}) {
  const t = useZenText(intakeText);
  const locale = useZenLocale();
  const call = useIntakeCall();
  const { index } = useOfficeCompany();
  const toolchain = useZenToolchainGate(props.workflow, props.project, props.onClose);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const manifest = localizeWorkflowManifest(props.workflow.manifest, locale);
  const ready = toolchain.preparing === null;

  const start = useEffectEvent(async () => {
    const project = toolchain.runProject;
    const failure = await toolchain.launch({}, locale, async (threadId, appendix) => {
      const result = await call<{ readonly message: string; readonly title: string }>(
        project.environmentId,
        "workflow.start",
        {
          threadId,
          workflowId: props.workflow.manifest.id,
          companyId: companyOfProject(index, project.environmentId, project.id),
          projectId: project.id,
          cwd: project.workspaceRoot,
          folderName: project.title,
          locale,
          appendix,
          ...(props.known && Object.keys(props.known).length > 0 ? { known: props.known } : {}),
        },
      ).then(
        (value) => ({ text: value.message, title: value.title }),
        (cause: unknown) => ({
          error: cause instanceof Error && cause.message ? cause.message : t.couldNotStart,
        }),
      );
      return result;
    });
    if (failure) setError(failure);
    else props.onClose();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the chat once, when the toolchain check lets the workflow run.
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void start();
  }, [ready]);

  if (toolchain.preparing) return toolchain.preparing;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="sm:max-w-sm" data-zen-intake-starting>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <WorkflowIcon name={manifest.icon} className="size-4.5 text-primary" />
              {manifest.name}
            </span>
          </DialogTitle>
          <DialogDescription>
            {error ?? (
              <span className="flex items-center gap-2">
                <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
                {t.startingChat}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogFooter>
            <Button onClick={props.onClose}>{t.ok}</Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
