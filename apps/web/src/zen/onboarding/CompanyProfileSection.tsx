// Zen Staff: "Company profile" in company settings: the onboarding interview's status, the profile
// file, and a button that opens the interview to change any answer.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenCompany } from "@t3tools/contracts/zenCompanies";
import { SparklesIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useZenText } from "../i18n/zenI18n";
import { onboardingText } from "./onboarding.i18n";
import { useOnboardingDialog, useOnboardingStatus } from "./onboardingClient";

export function CompanyProfileSection(props: {
  readonly environmentId: EnvironmentId;
  readonly company: ZenCompany;
}) {
  const t = useZenText(onboardingText);
  const status = useOnboardingStatus(props.environmentId);
  const open = useOnboardingDialog((store) => store.open);
  const state = status?.states[props.company.id]?.status ?? "not-started";
  const label =
    state === "done"
      ? t.statusDone
      : state === "in-progress"
        ? t.statusInProgress
        : state === "skipped"
          ? t.statusSkipped
          : t.statusNotStarted;
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4" data-zen-company-profile>
      <h3 className="font-medium">{t.sectionTitle}</h3>
      <p className="text-muted-foreground text-sm">{t.sectionIntro}</p>
      <p className="text-sm">{label}</p>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => open(props.company.id, "settings")}
      >
        <SparklesIcon />
        {state === "done"
          ? t.editProfile
          : state === "not-started"
            ? t.openInterview
            : t.resumeInterview}
      </Button>
    </section>
  );
}
