// Zen Staff: "Fă din acest calculator serverul firmei" asks first (review 0.2.3, P0-6): the AI
// account (warning on a personal subscription), connections with none shared by default, the
// trust model and an explicit "I understand". The server records it (serverConsent.ts).
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenConnectorsOverview } from "@t3tools/contracts/zenConnectors";
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Radio, RadioGroup } from "../../components/ui/radio-group";
import { toastManager } from "../../components/ui/toast";
import { useAiAccounts } from "../aiAccount/AiAccountPanel";
import { aiAccountTitle } from "../aiAccount/aiAccountModel";
import { useConnectorsQuery } from "../connectors/connectorsClient";
import { useZenText } from "../i18n/zenI18n";
import { hubPermissionMessage } from "./hubErrors";
import type { HubCall } from "./hubClient";
import { serverSetupText } from "./serverSetup.i18n";
import { companyServerText } from "./companyServer.i18n";
import { PROVIDER_CONSOLE } from "./companyAiRule";
import { ZenNativeSelect } from "../ui/ZenSelect";
import {
  initialServerChoice,
  serverAccountOptions,
  serverChoiceReady,
  serverConfirmPayload,
  serverSeatAccount,
  serverSetupConnectors,
  type ServerSetupChoice,
} from "./serverSetup.logic";

export function ServerSetupDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly companyName: string;
  /** "enable": the machine becomes the server; "confirm": it already is (older setup or a change). */
  readonly mode: "enable" | "confirm";
  readonly hasStoredKey: boolean;
  /** Company members: with colleagues the server runs only on a company API key. */
  readonly memberCount: number;
  readonly call: HubCall;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const t = useZenText(serverSetupText);
  const { accounts } = useAiAccounts(props.environmentId);
  const seat = serverSeatAccount(accounts);
  const overview = useConnectorsQuery<ZenConnectorsOverview>(props.environmentId, "overview");
  const connectors = serverSetupConnectors(overview.data?.connections ?? []);
  const k = useZenText(companyServerText);
  const options = serverAccountOptions(seat, props.memberCount);
  const [choice, setChoice] = useState<ServerSetupChoice>(() =>
    initialServerChoice(seat, props.memberCount),
  );
  const [busy, setBusy] = useState(false);
  const ready = serverChoiceReady(choice, props.hasStoredKey, props.memberCount) && !busy;

  const submit = () => {
    const confirm = serverConfirmPayload({
      choice,
      seat,
      connectors,
      apiKeyDefaultName: t.apiKeyDefaultName,
    });
    if (confirm === null) return;
    setBusy(true);
    const request =
      props.mode === "enable"
        ? props.call("runner.set", { companyId: props.companyId, enabled: true, confirm })
        : props.call("runner.consent.set", { companyId: props.companyId, confirm });
    void request.then(
      () => {
        setBusy(false);
        toastManager.add({ type: "success", title: t.done });
        props.onDone();
      },
      (cause: unknown) => {
        setBusy(false);
        toastManager.add({
          type: "error",
          title: t.couldNotSave,
          description: hubPermissionMessage(cause),
        });
      },
    );
  };

  const toggle = (name: string, on: boolean) =>
    setChoice((current) => {
      const shared = new Set(current.shared);
      if (on) shared.add(name);
      else shared.delete(name);
      return { ...current, shared };
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-xl" data-testid="server-setup-dialog">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "enable"
              ? t.title(props.companyName)
              : t.confirmTitle(props.companyName)}
          </DialogTitle>
          <DialogDescription>{t.intro}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2" data-testid="server-setup-account">
              <h3 className="font-medium text-sm">{t.accountTitle}</h3>
              <p className="text-muted-foreground text-xs">{t.accountHint}</p>
              <RadioGroup
                value={choice.account ?? ""}
                onValueChange={(value) =>
                  setChoice((current) => ({
                    ...current,
                    account: value === "seat" || value === "api-key" ? value : null,
                  }))
                }
              >
                {seat !== null && options.includes("seat") ? (
                  <label className="flex items-start gap-2 text-sm">
                    <Radio value="seat" className="mt-0.5" data-testid="server-setup-seat" />
                    <span className="flex flex-col gap-1">
                      <span>{t.seat(aiAccountTitle(seat))}</span>
                      {seat.kind === "personal" ? (
                        <span
                          className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/8 p-2 text-destructive-foreground text-xs"
                          data-testid="server-setup-personal-warning"
                        >
                          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                          {t.personalWarning}
                        </span>
                      ) : null}
                      <span
                        className="text-muted-foreground text-xs"
                        data-testid="server-setup-solo"
                      >
                        {k.modeSoloWarning}
                      </span>
                    </span>
                  </label>
                ) : seat !== null ? (
                  <p className="text-muted-foreground text-sm" data-testid="server-setup-key-only">
                    {k.keyOnlyForTeam}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">{t.noSeat}</p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <Radio value="api-key" className="mt-0.5" data-testid="server-setup-api-key" />
                  <span className="flex flex-col gap-1">
                    <span>{t.apiKey}</span>
                    <span className="text-muted-foreground text-xs">{t.apiKeyHint}</span>
                  </span>
                </label>
              </RadioGroup>
              {choice.account === "api-key" ? (
                <div className="flex flex-wrap items-center gap-2 ps-6 text-xs">
                  <ZenNativeSelect
                    aria-label={k.provider}
                    value={choice.provider}
                    onChange={(event) =>
                      setChoice((current) => ({
                        ...current,
                        provider: event.target.value === "codex" ? "codex" : "claude",
                      }))
                    }
                  >
                    <option value="claude">{k.providerName.claude}</option>
                    <option value="codex">{k.providerName.codex}</option>
                  </ZenNativeSelect>
                  <a
                    className="underline underline-offset-2"
                    href={PROVIDER_CONSOLE[choice.provider]}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {k.consoleLink}
                  </a>
                  <span className="text-muted-foreground">{k.capNote}</span>
                </div>
              ) : null}
              {choice.account === "api-key" ? (
                <div className="flex flex-col gap-2 ps-6 sm:flex-row">
                  <Input
                    aria-label={t.apiKeyName}
                    placeholder={t.apiKeyDefaultName}
                    value={choice.apiKeyName}
                    onChange={(event) =>
                      setChoice((current) => ({ ...current, apiKeyName: event.target.value }))
                    }
                  />
                  <Input
                    aria-label={t.apiKey}
                    type="password"
                    autoComplete="off"
                    placeholder={props.hasStoredKey ? t.apiKeyStored : t.apiKeyPlaceholder}
                    value={choice.apiKey}
                    onChange={(event) =>
                      setChoice((current) => ({ ...current, apiKey: event.target.value }))
                    }
                  />
                </div>
              ) : null}
              {choice.account === null ? (
                <p className="text-warning-foreground text-xs" data-testid="server-setup-choose">
                  {t.chooseAccount}
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2" data-testid="server-setup-connectors">
              <h3 className="font-medium text-sm">{t.connectorsTitle}</h3>
              <p className="text-muted-foreground text-xs">{t.connectorsHint}</p>
              {overview.data === null ? (
                <p className="text-muted-foreground text-sm">{t.connectorsLoading}</p>
              ) : connectors.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t.connectorsNone}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border/60 rounded-lg border">
                  {connectors.map((connector) => (
                    <li key={connector.name}>
                      <label className="flex items-center gap-2 px-3 py-2 text-sm">
                        <Checkbox
                          checked={choice.shared.has(connector.name)}
                          onCheckedChange={(checked) => toggle(connector.name, checked === true)}
                          data-testid={`server-setup-connector-${connector.name}`}
                        />
                        <span className="flex-1">{connector.label}</span>
                        <span className="text-muted-foreground text-xs">
                          {connector.origin === "account"
                            ? t.personalConnection
                            : t.localConnection}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-3 text-sm">
              <h3 className="flex items-center gap-1.5 font-medium">
                <ShieldCheckIcon className="size-4" />
                {t.trustTitle}
              </h3>
              <p>{t.trustAuto}</p>
              <p>{t.trustApprove}</p>
            </section>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={choice.acknowledged}
                onCheckedChange={(checked) =>
                  setChoice((current) => ({ ...current, acknowledged: checked === true }))
                }
                className="mt-0.5"
                data-testid="server-setup-acknowledge"
              />
              <span>{t.acknowledge}</span>
            </label>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            {t.cancel}
          </Button>
          <Button disabled={!ready} onClick={submit} data-testid="server-setup-submit">
            {busy ? t.saving : props.mode === "enable" ? t.confirm : t.save}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
