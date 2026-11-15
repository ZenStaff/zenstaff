// Zen Staff: Settings > General > Enterprise workflows (on the company server). Company keys go
// into this machine's vault (never shown again), admins unlock packs per person, and every use of
// a key is listed. On a laptop it only explains that keys live on the server.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_COMPANY_SERVER_URL, type ZenAccessOverview } from "@t3tools/contracts/zenToolchains";
import { AsyncResult } from "effect/reactivity";
import { KeyRoundIcon, LockIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { defineZenMessages, useZenText } from "../i18n/zenI18n";
import { callToolchains, toolchainAccess } from "./toolchainsState";
import { ZenNativeSelect } from "../ui/ZenSelect";

type Messages = {
  readonly title: string;
  readonly runnerHub: (user: string) => string;
  readonly runnerLocal: string;
  readonly notRunner: string;
  readonly serverOffer: string;
  readonly keyStore: (store: string) => string;
  readonly approved: string;
  readonly notApproved: string;
  readonly notInstalled: string;
  readonly stored: string;
  readonly missing: string;
  readonly paste: string;
  readonly save: string;
  readonly remove: string;
  readonly people: string;
  readonly nobody: string;
  readonly email: string;
  readonly confirm: string;
  readonly unlock: string;
  readonly revoke: string;
  readonly usage: string;
  readonly noUsage: string;
  readonly none: string;
  readonly company: string;
  readonly companyHint: string;
};

const text = defineZenMessages<Messages>({
  en: {
    title: "Enterprise workflows",
    runnerHub: (user) => `This computer is the company server (registered on the hub as ${user}).`,
    runnerLocal: "This computer is marked as the company server (no hub: local setting only).",
    notRunner:
      "Enterprise workflows run only on the company's always-on server. Company keys are kept there, never on this computer.",
    serverOffer: "About the always-on company server",
    keyStore: (store) => `Keys are encrypted; the vault key is in ${store}.`,
    approved: "Approved",
    notApproved: "Not approved",
    notInstalled: "Not installed",
    stored: "Saved",
    missing: "Missing",
    paste: "Paste the key",
    save: "Save",
    remove: "Remove",
    people: "Unlocked for",
    nobody: "Nobody yet",
    email: "Person's e-mail (hub account)",
    confirm: "I am a company admin",
    unlock: "Unlock",
    revoke: "Revoke",
    usage: "Recent key use",
    noUsage: "No use yet.",
    none: "No Enterprise workflows are installed.",
    company: "Company",
    companyHint:
      "This server works for several companies. Approvals and unlocks are kept for each company on its own.",
  },
  ro: {
    title: "Fluxuri Enterprise",
    runnerHub: (user) => `Acest calculator este serverul firmei (înregistrat pe hub ca ${user}).`,
    runnerLocal: "Acest calculator este marcat ca server al firmei (fără hub: doar setare locală).",
    notRunner:
      "Fluxurile Enterprise rulează doar pe serverul firmei, pornit mereu. Cheile firmei stau acolo, niciodată pe acest calculator.",
    serverOffer: "Despre serverul firmei, pornit mereu",
    keyStore: (store) => `Cheile sunt criptate; cheia seifului este în ${store}.`,
    approved: "Aprobat",
    notApproved: "Neaprobat",
    notInstalled: "Neinstalat",
    stored: "Salvată",
    missing: "Lipsește",
    paste: "Lipește cheia",
    save: "Salvează",
    remove: "Șterge",
    people: "Deblocat pentru",
    nobody: "Nimeni încă",
    email: "E-mailul persoanei (cont hub)",
    confirm: "Sunt administrator al firmei",
    unlock: "Deblochează",
    revoke: "Retrage",
    usage: "Folosirea recentă a cheilor",
    noUsage: "Nicio folosire încă.",
    none: "Nu este instalat niciun flux Enterprise.",
    company: "Firma",
    companyHint:
      "Acest server lucrează pentru mai multe firme. Aprobările și deblocările se țin pentru fiecare firmă în parte.",
  },
});

export function ZenEnterpriseAccessSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const t = useZenText(text);
  // Hub v9: one server for several companies; the screen works on one of them at a time.
  const [chosenCompany, setChosenCompany] = useState<string | null>(null);
  const scope = chosenCompany === null ? {} : { companyId: chosenCompany };
  const atom = toolchainAccess({ environmentId, input: scope });
  const result = useAtomValue(atom);
  const [error, setError] = useState<string | null>(null);
  if (!AsyncResult.isSuccess(result)) return null;
  const overview = result.value;
  const companies = overview.companies ?? [];
  if (overview.packs.length === 0 && !overview.runner.isRunner) return null;
  const run = async (call: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    const outcome = await call();
    if (!outcome.ok) setError(outcome.error ?? "");
    appAtomRegistry.refresh(atom);
  };
  return (
    <SettingsSection id="zen-enterprise" title={t.title}>
      <SettingsRow
        title={
          <span className="flex items-center gap-1.5">
            {overview.runner.isRunner ? null : <LockIcon className="size-3.5" />}
            {overview.runner.isRunner
              ? overview.runner.source === "hub"
                ? t.runnerHub(overview.runner.hubUser ?? "?")
                : t.runnerLocal
              : t.notRunner}
          </span>
        }
        description={
          overview.runner.isRunner ? (
            t.keyStore(
              overview.keyStore === "keychain"
                ? "the system keychain"
                : "a file readable only by this account",
            )
          ) : (
            <a className="underline" href={ZEN_COMPANY_SERVER_URL} target="_blank" rel="noreferrer">
              {t.serverOffer}
            </a>
          )
        }
      />
      {companies.length > 1 ? (
        <SettingsRow title={t.company} description={t.companyHint}>
          <ZenNativeSelect
            aria-label={t.company}
            data-testid="enterprise-company"
            className="mt-2 h-8 rounded-lg border border-input bg-background px-2 text-sm"
            value={overview.companyId ?? companies[0]!.id}
            onChange={(event) => setChosenCompany(event.target.value)}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </ZenNativeSelect>
        </SettingsRow>
      ) : null}
      {overview.packs.length === 0 ? <SettingsRow title={t.none} /> : null}
      {overview.packs.map((pack) => (
        <PackRow
          key={pack.workflowId}
          pack={pack}
          runner={overview.runner.isRunner}
          onSave={(secretId, value) =>
            void run(() =>
              callToolchains("setSecret", environmentId, {
                workflowId: pack.workflowId,
                secretId,
                value,
              }),
            )
          }
          onRemove={(secretId) =>
            void run(() =>
              callToolchains("removeSecret", environmentId, {
                workflowId: pack.workflowId,
                secretId,
              }),
            )
          }
          onGrant={(user, adminConfirmed) =>
            void run(() =>
              callToolchains("grant", environmentId, {
                packId: pack.workflowId,
                user,
                adminConfirmed,
                ...scope,
              }),
            )
          }
          onRevoke={(user) =>
            void run(() =>
              callToolchains("revoke", environmentId, {
                packId: pack.workflowId,
                user,
                ...scope,
              }),
            )
          }
        />
      ))}
      {error ? (
        <p role="alert" className="px-4 py-2 text-destructive-foreground text-sm">
          {error}
        </p>
      ) : null}
      {overview.runner.isRunner ? (
        <SettingsRow
          title={t.usage}
          description={
            overview.usage.length === 0
              ? t.noUsage
              : overview.usage
                  .slice(0, 8)
                  .map(
                    (use) =>
                      `${new Date(use.at).toLocaleString()} · ${use.workflowId} · ${use.user} · ${use.secretId} (${use.kind})`,
                  )
                  .join("\n")
          }
          className="whitespace-pre-line"
        />
      ) : null}
    </SettingsSection>
  );
}

function PackRow(props: {
  readonly pack: ZenAccessOverview["packs"][number];
  readonly runner: boolean;
  readonly onSave: (secretId: string, value: string) => void;
  readonly onRemove: (secretId: string) => void;
  readonly onGrant: (user: string, adminConfirmed: boolean) => void;
  readonly onRevoke: (user: string) => void;
}) {
  const t = useZenText(text);
  const { pack } = props;
  const [values, setValues] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <SettingsRow
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          {pack.name}
          <Badge variant={pack.approved ? "success" : "warning"} size="sm">
            {pack.approved ? t.approved : t.notApproved}
          </Badge>
          {pack.installed ? null : (
            <Badge variant="outline" size="sm">
              {t.notInstalled}
            </Badge>
          )}
        </span>
      }
      description={`${t.people}: ${pack.grants.length === 0 ? t.nobody : pack.grants.map((grant) => grant.user).join(", ")}`}
    >
      {props.runner ? (
        <div className="flex flex-col gap-3 pt-2">
          {pack.access.secrets.map((secret) => (
            <div key={secret.id} className="flex flex-wrap items-center gap-2 text-sm">
              <KeyRoundIcon className="size-3.5 text-muted-foreground" />
              <span className="min-w-40">{secret.label}</span>
              <Badge variant={secret.stored ? "success" : "warning"} size="sm">
                {secret.stored ? t.stored : t.missing}
              </Badge>
              <Input
                type="password"
                autoComplete="off"
                className="w-56"
                placeholder={t.paste}
                aria-label={`${secret.label}: ${t.paste}`}
                value={values[secret.id] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [secret.id]: event.target.value }))
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!(values[secret.id] ?? "").trim()}
                onClick={() => {
                  props.onSave(secret.id, values[secret.id] ?? "");
                  setValues((current) => ({ ...current, [secret.id]: "" }));
                }}
              >
                {t.save}
              </Button>
              {secret.stored ? (
                <Button size="sm" variant="ghost" onClick={() => props.onRemove(secret.id)}>
                  <Trash2Icon />
                  {t.remove}
                </Button>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <UserPlusIcon className="size-3.5 text-muted-foreground" />
            <Input
              className="w-64"
              type="email"
              placeholder={t.email}
              aria-label={t.email}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Label>
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              {t.confirm}
            </Label>
            <Button
              size="sm"
              variant="outline"
              disabled={!email.includes("@") || !confirmed}
              onClick={() => {
                props.onGrant(email, confirmed);
                setEmail("");
              }}
            >
              {t.unlock}
            </Button>
          </div>
          {pack.grants.map((grant) => (
            <div key={grant.user} className="flex items-center gap-2 text-muted-foreground text-xs">
              {grant.user} · {grant.grantedBy} · {new Date(grant.at).toLocaleDateString()}
              <Button size="xs" variant="ghost" onClick={() => props.onRevoke(grant.user)}>
                {t.revoke}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}
