// Zen Staff: opens the onboarding interview on first launch and for each new company (once), and
// whenever a Zen page asks for it (company settings). Mounted with the sidebar items.
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useActiveCompanyId, useCompanyIndex } from "../companies/companiesState";
import { useHubQuery } from "../hub/hubClient";
import { interviewBelongsToSomeoneElse } from "./firstRunModel";
import { OnboardingDialog } from "./OnboardingDialog";
import { useOnboardingDialog, useOnboardingStatus } from "./onboardingClient";

// Offered once per app session, so closing it ("Later") does not bring it back on the next poll.
const offered = new Set<string>();

function Gate({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const status = useOnboardingStatus(environmentId);
  // The first-run setup (/welcome) comes first; the interview waits until it is done.
  const onWelcome = useLocation({ select: (location) => location.pathname === "/welcome" });
  const index = useCompanyIndex();
  const active = useActiveCompanyId(index);
  const dialog = useOnboardingDialog();
  const { data: hub, error: hubError } = useHubQuery<ZenHubStatus>(environmentId, "status");
  // The hub's answer decides whose interview it is; without a hub (error) nothing waits for it.
  const hubKnown = hub !== null || hubError !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the global interview dialog when the machine reports a first run or a new company.
  useEffect(() => {
    if (status === null || dialog.companyId !== null || !index.ready || onWelcome || !hubKnown)
      return;
    const fresh = status.newCompanies.find((company) => !offered.has(company.id));
    if (fresh !== undefined) {
      offered.add(fresh.id);
      if (!interviewBelongsToSomeoneElse(hub, fresh.id, "new-company"))
        dialog.open(fresh.id, "new-company");
      return;
    }
    if (status.firstRun && !offered.has("first-run")) {
      offered.add("first-run");
      const target = active ?? ZEN_PERSONAL_COMPANY_ID;
      if (!interviewBelongsToSomeoneElse(hub, target, "first-run"))
        dialog.open(target, "first-run");
    }
  }, [status, dialog, index.ready, active, onWelcome, hub, hubKnown]);
  if (dialog.companyId === null) return null;
  return (
    <OnboardingDialog
      key={dialog.companyId}
      environmentId={environmentId}
      companyId={dialog.companyId}
      onClose={dialog.close}
    />
  );
}

export function ZenOnboardingGate() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : <Gate environmentId={environmentId} />;
}
