// Zen Staff chat-first hiring: a role that usually works for a company, hired in Personal. Instead
// of an orange warning box, the setup chat offers the person's companies and "Companie nouă" as
// buttons under the chat. Choosing one hires the role there (its own folder, a new setup chat) and
// removes the paused Personal draft; "Rămâne personal" just says so in the chat.
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID, type ZenCompany } from "@t3tools/contracts/zenCompanies";
import type { IntakeThreadView } from "@t3tools/contracts/zenIntake";
import type { StaffOverview, StaffRoleTemplate } from "@t3tools/contracts/zenStaff";
import { Building2Icon, PlusIcon, UserIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toastManager } from "../../components/ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  companyCreate,
  useCompanyIndex,
  useSelectedCompanyStore,
} from "../companies/companiesState";
import { useZenText } from "../i18n/zenI18n";
import { staffErrorMessage, useStaffCall, useStaffCatalog } from "../staff/staffClient";
import { useHireRole } from "../staff/useHireRole";
import { intakeText } from "./intake.i18n";

export function HireCompanyChoice(props: {
  readonly environmentId: EnvironmentId;
  readonly state: IntakeThreadView;
  /** Sends a message into this chat, like the composer. */
  readonly send: (text: string) => Promise<boolean>;
}) {
  const t = useZenText(intakeText);
  const { state } = props;
  const index = useCompanyIndex();
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  const catalog = useStaffCatalog<{ readonly roles: ReadonlyArray<StaffRoleTemplate> }>(
    props.environmentId,
  );
  const call = useStaffCall(props.environmentId, ZEN_PERSONAL_COMPANY_ID);
  const hireRole = useHireRole(props.environmentId);
  const create = useAtomCommand(companyCreate, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const role = catalog?.roles.find((item) => item.id === state.templateId) ?? null;
  if (
    state.companyChoice !== true ||
    dismissed ||
    state.proposalState === "approved" ||
    role === null
  ) {
    return null;
  }
  const companies = index.companies.filter((company) => !company.isDefault);

  const moveTo = async (company: ZenCompany) => {
    const overview = await call<StaffOverview>("overview", { companyId: company.id }).catch(
      () => null,
    );
    const failure = await hireRole({
      role,
      companyId: company.id,
      companyName: company.name,
      overview,
    });
    if (failure !== null) {
      toastManager.add({ type: "error", title: t.couldNotStart, description: failure });
      return;
    }
    setSelected(company.id);
    if (state.agentId) {
      await call("agent.delete", {
        companyId: ZEN_PERSONAL_COMPANY_ID,
        agentId: state.agentId,
      }).catch(() => undefined);
    }
  };

  const choose = async (company: ZenCompany) => {
    setBusy(true);
    await moveTo(company).catch((cause: unknown) => {
      toastManager.add({
        type: "error",
        title: t.couldNotStart,
        description: staffErrorMessage(cause, t.couldNotStart),
      });
    });
    setBusy(false);
  };

  const createAndChoose = async () => {
    if (name.trim() === "") return;
    setBusy(true);
    const created = await create({
      environmentId: props.environmentId,
      input: { name: name.trim() },
    });
    if (created._tag === "Failure") {
      setBusy(false);
      toastManager.add({ type: "error", title: t.companyCreateFailed });
      return;
    }
    setBusy(false);
    await choose(created.value);
  };

  const keepPersonal = async () => {
    setDismissed(true);
    const sent = await props.send(t.keepPersonalMessage);
    if (!sent) toastManager.add({ type: "error", title: t.sendFailed });
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm"
      data-zen-hire-company-choice
    >
      <p className="font-medium">{t.companyChoiceTitle}</p>
      <div className="flex flex-wrap gap-1.5">
        {companies.map((company) => (
          <Button
            key={company.id}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void choose(company)}
            data-zen-hire-company={company.id}
          >
            <Building2Icon aria-hidden />
            {company.name}
          </Button>
        ))}
        {naming ? null : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setNaming(true)}>
            <PlusIcon aria-hidden />
            {t.newCompany}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void keepPersonal()}>
          <UserIcon aria-hidden />
          {t.keepPersonal}
        </Button>
      </div>
      {naming ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createAndChoose();
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.newCompanyPlaceholder}
            aria-label={t.newCompany}
            className="max-w-72"
          />
          <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
            {t.createCompany}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
