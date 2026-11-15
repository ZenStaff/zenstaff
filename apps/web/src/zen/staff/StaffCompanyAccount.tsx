// Zen Staff AI staff > Settings: the company's AI account, with the app's own controls (no native
// selects) and Office wording. Shows which account each assistant on this computer is signed in to,
// warns about a personal subscription and, when the admin blocks personal accounts, refuses to
// save one. ZEN.md, "AI account".
import type { StaffCompanyAccount, StaffCompanyAccountKind } from "@t3tools/contracts/zenStaff";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { useAiAccounts } from "../aiAccount/AiAccountPanel";
import { aiAccountText } from "../aiAccount/aiAccount.i18n";
import { aiAccountTitle, companyAccountCheck } from "../aiAccount/aiAccountModel";
import { useZenText } from "../i18n/zenI18n";
import { staffAccountText } from "./staffAccount.i18n";
import { attempt, Field, Section, useProviderChoices, type StaffContext } from "./staffShared";

const KINDS: ReadonlyArray<StaffCompanyAccountKind> = ["team-seat", "enterprise-seat", "api-key"];
const NONE = "__none__";

export function StaffCompanyAccountSection(props: { readonly context: StaffContext }) {
  const t = useZenText(staffAccountText);
  const a = useZenText(aiAccountText);
  const { context } = props;
  const current = context.overview.settings;
  const providers = useProviderChoices(context.environmentId);
  const { accounts } = useAiAccounts(context.environmentId);
  const [account, setAccount] = useState<StaffCompanyAccount | null>(current.companyAccount);
  const blockPersonal = current.blockPersonalAccounts === true;
  const save = (settings: Record<string, unknown>) =>
    void attempt(() => context.call("settings.save", { settings }), t.saved).then(() =>
      context.refresh(),
    );

  if (context.companyId === "personal") {
    return (
      <Section title={t.title} intro={t.intro}>
        <p className="text-muted-foreground text-sm">{t.personalCompany}</p>
      </Section>
    );
  }

  const chosen = account
    ? (accounts.find((entry) => entry.instanceId === account.providerInstanceId) ?? null)
    : null;
  const check = account ? companyAccountCheck(chosen, blockPersonal) : "missing";
  const models = providers.find((provider) => provider.id === account?.providerInstanceId)?.models;
  const providerLabel = (id: string) => {
    const provider = providers.find((entry) => entry.id === id);
    const signedIn = accounts.find((entry) => entry.instanceId === id);
    const details =
      signedIn?.state === "signed-in"
        ? [signedIn.email, signedIn.plan ? `(${signedIn.plan})` : null].filter(Boolean).join(" ")
        : "";
    const who = details ? ` · ${details}` : "";
    return `${provider?.name ?? id}${who}`;
  };

  return (
    <Section title={t.title} intro={t.intro}>
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4" data-staff-account>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.kindLabel}>
            <Select
              value={account?.kind ?? NONE}
              onValueChange={(value) =>
                setAccount(
                  value === NONE || value === null
                    ? null
                    : {
                        kind: value as StaffCompanyAccountKind,
                        providerInstanceId: account?.providerInstanceId ?? providers[0]?.id ?? "",
                        model: account?.model ?? "claude-haiku-5-5",
                        label: account?.label ?? "",
                      },
                )
              }
            >
              <SelectTrigger aria-label={t.kindLabel} data-staff-account-kind>
                <SelectValue>{account ? t.kind[account.kind] : t.kindNone}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                <SelectItem value={NONE}>{t.kindNone}</SelectItem>
                {KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t.kind[kind]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
          {account ? (
            <Field label={t.assistant}>
              <Select
                value={account.providerInstanceId}
                onValueChange={(value) =>
                  value ? setAccount({ ...account, providerInstanceId: String(value) }) : undefined
                }
              >
                <SelectTrigger aria-label={t.assistant} data-staff-account-instance>
                  <SelectValue>
                    {account.providerInstanceId
                      ? providerLabel(account.providerInstanceId)
                      : t.noAssistant}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {providerLabel(provider.id)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          ) : null}
          {account ? (
            <Field label={t.model}>
              {models && models.length > 0 ? (
                <Select
                  value={account.model}
                  onValueChange={(value) =>
                    value ? setAccount({ ...account, model: String(value) }) : undefined
                  }
                >
                  <SelectTrigger aria-label={t.model}>
                    <SelectValue>{account.model}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {[...new Set([account.model, ...models])].map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : (
                <Input
                  value={account.model}
                  onChange={(event) => setAccount({ ...account, model: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          {account ? (
            <Field label={t.label}>
              <Input
                value={account.label}
                placeholder={t.labelPlaceholder}
                onChange={(event) => setAccount({ ...account, label: event.target.value })}
              />
            </Field>
          ) : null}
        </div>
        {account && chosen ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-zen-no-translate>
            {chosen.state === "signed-in" ? t.signedInAs(aiAccountTitle(chosen)) : t.notSignedIn}
            {chosen.state === "signed-in" && chosen.kind !== "unknown" ? (
              <Badge variant={chosen.kind === "personal" ? "warning" : "info"} size="sm">
                {a.kind[chosen.kind]}
              </Badge>
            ) : null}
          </p>
        ) : null}
        {check === "warn-personal" || check === "blocked-personal" ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm"
            role="alert"
            data-staff-account-personal={check}
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>{check === "blocked-personal" ? a.blockedPersonal : a.personalWarning}</span>
          </div>
        ) : null}
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={blockPersonal}
            onCheckedChange={(checked) => save({ blockPersonalAccounts: checked })}
            data-staff-block-personal
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t.blockPersonal}</span>
            <span className="text-muted-foreground text-xs">{t.blockPersonalHelp}</span>
          </span>
        </label>
        <div>
          <Button
            disabled={check === "blocked-personal"}
            onClick={() => save({ companyAccount: account })}
            data-staff-account-save
          >
            {t.save}
          </Button>
        </div>
      </div>
    </Section>
  );
}
