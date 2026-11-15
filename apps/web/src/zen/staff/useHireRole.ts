// Chat-first hiring: a role click hires straight into its setup chat. The employee gets its own
// folder (`~/Zen Staff/<Company>/<Role>`, never an internal chat folder) and the current person as
// manager; name, publishing, accounts, approver and limits are asked in the chat.
import { useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import type { StaffAgent, StaffOverview, StaffRoleTemplate } from "@t3tools/contracts/zenStaff";

import { newProjectId } from "../../lib/utils";
import { readProjects, waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { companiesListAtom, companyAssignProject } from "../companies/companiesState";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { intakeText } from "../intake/intake.i18n";
import { useIntakeCall } from "../intake/intakeClient";
import { useStartChat } from "../intake/useStartChat";
import { staffErrorMessage, useStaffCall } from "./staffClient";
import { useStaffDefaults } from "./staffShared";
import { hireKindFor, hireManagerId } from "./staffModel";

export interface HireRoleInput {
  readonly role: StaffRoleTemplate;
  readonly companyId: string;
  /** The company's display name (its folder under `~/Zen Staff`). */
  readonly companyName: string;
  /** The company's staff overview: manager, approvals, company account, placement. */
  readonly overview: Pick<StaffOverview, "humans" | "me" | "settings" | "companyPlacement"> | null;
}

/** Resolves to an error message, or null once the setup chat opened. */
export function useHireRole(environmentId: EnvironmentId) {
  const locale = useZenLocale();
  const i = useZenText(intakeText);
  const intake = useIntakeCall();
  const startChat = useStartChat(environmentId);
  const defaultsFor = useStaffDefaults(environmentId);
  // The company is passed with every call, so one caller serves any company.
  const call = useStaffCall(environmentId, ZEN_PERSONAL_COMPANY_ID);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const assign = useAtomCommand(companyAssignProject, { reportFailure: false });
  const registry = useContext(RegistryContext);

  const folderFor = async (input: HireRoleInput): Promise<EnvironmentProject | string> => {
    const roleName = input.role.role[locale];
    const personal = input.companyId === ZEN_PERSONAL_COMPANY_ID;
    const folder = await intake<{ readonly path: string }>(environmentId, "hire.folder", {
      companyName: personal ? null : input.companyName,
      role: roleName,
    }).then(
      (value) => value.path,
      (cause: unknown) => ({ error: staffErrorMessage(cause, i.couldNotStart) }),
    );
    if (typeof folder !== "string") return folder.error;
    let project = findProjectByPath(
      readProjects().filter((item) => item.environmentId === environmentId),
      folder,
    );
    if (!project) {
      const projectId = newProjectId();
      const created = await createProject({
        environmentId,
        input: {
          projectId,
          title: roleName,
          workspaceRoot: folder,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      });
      if (created._tag === "Failure") return i.couldNotStart;
      project = await waitForProject(scopeProjectRef(environmentId, projectId));
    }
    if (!personal) {
      await assign({
        environmentId,
        input: { projectId: project.id, companyId: input.companyId },
      });
      registry.refresh(companiesListAtom(environmentId));
    }
    return project;
  };

  return async (input: HireRoleInput): Promise<string | null> => {
    const project = await folderFor(input);
    if (typeof project === "string") return project;
    const overview = input.overview;
    const kind = hireKindFor(input.role.suggestedKind, overview?.companyPlacement.ok === true);
    const managerId = overview ? hireManagerId(overview.humans, overview.me) : null;
    const hired = await call<StaffAgent>("agent.hire", {
      companyId: input.companyId,
      templateId: input.role.id,
      kind,
      name: input.role.name[locale],
      managerId,
      projectId: project.id,
      defaults: defaultsFor(project),
      setup: true,
    }).then(
      (agent) => agent,
      (cause: unknown) => staffErrorMessage(cause, i.couldNotStart),
    );
    if (typeof hired === "string") return hired;
    const manager = overview?.humans.find((human) => human.id === managerId) ?? null;
    return startChat({
      project,
      compose: (threadId) =>
        intake<{ readonly message: string; readonly title: string }>(environmentId, "hire.start", {
          threadId,
          companyId: input.companyId,
          projectId: project.id,
          cwd: project.workspaceRoot,
          folderName: project.title,
          locale,
          agent: {
            id: hired.id,
            name: hired.name,
            role: hired.role,
            templateId: hired.templateId,
            kind: hired.kind,
            instructions: hired.instructions,
          },
          managerName: manager?.name ?? null,
          approvalsRequired: overview?.settings.approvals === true,
          companyAccount:
            hired.kind === "company" ? (overview?.settings.companyAccount?.label ?? null) : null,
        }).then(
          (value) => ({ text: value.message, title: value.title }),
          (cause: unknown) => ({ error: staffErrorMessage(cause, i.couldNotStart) }),
        ),
    });
  };
}
