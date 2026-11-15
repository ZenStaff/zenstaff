// Zen Staff: the AI account an AI employee works with, under its name on the org chart. A company
// agent shows the company's account (with a warning on a personal subscription); a personal agent
// shows the account this device confirmed. ZEN.md, "AI account".
import type { StaffAgent } from "@t3tools/contracts/zenStaff";
import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAiAccounts } from "../aiAccount/AiAccountPanel";
import { aiAccountText } from "../aiAccount/aiAccount.i18n";
import {
  aiAccountSignature,
  aiAccountTitle,
  companyAccountCheck,
} from "../aiAccount/aiAccountModel";
import { useConfirmedAiAccounts } from "../aiAccount/aiAccountStore";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { useStaffOverview } from "./staffClient";

function Line(props: { readonly warn?: boolean; readonly text: string }) {
  const Icon = props.warn ? TriangleAlertIcon : KeyRoundIcon;
  return (
    <span
      className={
        props.warn
          ? "flex min-w-0 items-center gap-1 text-warning-foreground text-xs"
          : "flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
      }
      data-zen-no-translate
      data-staff-agent-account
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{props.text}</span>
    </span>
  );
}

export function StaffAgentAccountLine(props: { readonly agent: StaffAgent }) {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : (
    <AgentAccount agent={props.agent} environmentId={environmentId} />
  );
}

function AgentAccount(props: {
  readonly agent: StaffAgent;
  readonly environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
}) {
  const t = useZenText(aiAccountText);
  const locale = useZenLocale();
  const { accounts } = useAiAccounts(props.environmentId);
  const confirmed = useConfirmedAiAccounts();
  const overview = useStaffOverview(props.environmentId, props.agent.companyId, locale).data;
  if (props.agent.kind === "company") {
    const company = overview?.settings.companyAccount ?? null;
    if (company === null) return <Line warn text={t.agentNoCompanyAccount} />;
    const account =
      accounts.find((entry) => entry.instanceId === company.providerInstanceId) ?? null;
    const check = companyAccountCheck(account, overview?.settings.blockPersonalAccounts === true);
    const name = account?.state === "signed-in" ? aiAccountTitle(account) : company.label;
    return <Line warn={check !== "ok"} text={t.agentAccount(name || company.providerInstanceId)} />;
  }
  const inUse = accounts.find(
    (entry) => entry.state === "signed-in" && confirmed.has(aiAccountSignature(entry)),
  );
  return inUse ? (
    <Line text={t.agentAccount(aiAccountTitle(inUse))} />
  ) : (
    <Line warn text={t.agentUnconfirmed} />
  );
}
