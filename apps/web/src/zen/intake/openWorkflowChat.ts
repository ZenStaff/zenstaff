// Zen Staff chat-first task start from outside the Office home ("Folosește" in the Magazin, the
// sidebar's "My workflows", the command palette): hand the workflow to the Office home, which
// opens it the way its own card does (the chat in Office, the form in Code) in the folder chosen
// there. One path for every entry point.
import type { useNavigate } from "@tanstack/react-router";

import { setOfficeIntake } from "./intakeHandover";

export function openWorkflowChat(
  navigate: ReturnType<typeof useNavigate>,
  workflowId: string,
): Promise<void> {
  setOfficeIntake(workflowId);
  return navigate({ to: "/office" });
}
